import 'dart:convert';

import 'package:http/http.dart' as http;

import 'config.dart';
import 'store.dart';

/// 不应继续调用的错误（Key 无效、余额不足等），本次运行停止所有 AI 调用
class SummarizerFatal implements Exception {
  SummarizerFatal(this.message);
  final String message;
  @override
  String toString() => message;
}

class SummaryResponse {
  SummaryResponse(this.result, this.hitTokens, this.missTokens, this.outputTokens);
  final AiResult result;
  final int hitTokens;
  final int missTokens;
  final int outputTokens;
}

/// DeepSeek 高峰时段：周一至周五 UTC 01:00–04:00、06:00–10:00（中国法定节假日除外，这里不处理，按高峰算偏保守）
bool isPeak(DateTime t) {
  final u = t.toUtc();
  if (u.weekday > DateTime.friday) return false;
  return (u.hour >= 1 && u.hour < 4) || (u.hour >= 6 && u.hour < 10);
}

double estimateCost(Prices offpeak, {required int hit, required int miss, required int output, required bool peak}) {
  final base = (hit * offpeak.cacheHit + miss * offpeak.cacheMiss + output * offpeak.output) / 1e6;
  return peak ? base * 2 : base;
}

class Summarizer {
  Summarizer({required this.config, required this.apiKey, http.Client? client})
      : _client = client ?? http.Client();

  final Config config;
  final String apiKey;
  final http.Client _client;

  /// 固定不变的系统提示放在最前面，便于命中 DeepSeek 的上下文缓存（缓存命中的输入价格低很多）
  late final String systemPrompt = '''
你是计算机图形学与 CAD 几何内核方向的学习助手。用户会给你一篇文章（论文摘要、博客或软件发布说明），请用中文输出 json。

用户的学习兴趣：
${config.interests}

输出格式（只输出这一个 json 对象）：
{
  "summary": "3–5 句中文摘要：解决什么问题、核心方法/改动、结论或意义。专有名词保留英文，如 B-Rep、BVH。",
  "points": ["最多 4 条要点，每条一句话"],
  "tags": ["从推荐标签中选 1–5 个；确实没有合适的才新建，新标签要简短、不含空格"],
  "relevance": 3,
  "level": "入门"
}

字段说明：
- relevance：与用户兴趣的相关度，1–5 的整数。5=正中核心主题且有学习价值；3=相关但偏外围；1=基本无关。
- level：阅读门槛，只能是 "入门"、"进阶"、"专业" 之一。
- 软件发布说明：summary 概括最重要的新功能/修复，points 列出与几何建模或渲染相关的变化。

推荐标签：${config.tags.join('、')}
''';

  Future<SummaryResponse> summarize({
    required String title,
    required String source,
    required String url,
    required String text,
  }) async {
    final body = jsonEncode({
      'model': config.ai.model,
      'messages': [
        {'role': 'system', 'content': systemPrompt},
        {'role': 'user', 'content': '标题：$title\n来源：$source\n链接：$url\n\n正文：\n$text'},
      ],
      'response_format': {'type': 'json_object'},
      'thinking': {'type': 'disabled'}, // 摘要不需要思考模式，关掉更快更省
      'max_tokens': 1200,
      'temperature': 0.3,
    });

    for (var attempt = 0;; attempt++) {
      final http.Response resp;
      try {
        resp = await _client
            .post(
              Uri.parse('${config.ai.baseUrl}/chat/completions'),
              headers: {'Authorization': 'Bearer $apiKey', 'Content-Type': 'application/json'},
              body: body,
            )
            .timeout(const Duration(seconds: 90));
      } catch (e) {
        if (attempt < 1) continue;
        rethrow;
      }

      if (resp.statusCode == 401 || resp.statusCode == 402 || resp.statusCode == 403) {
        throw SummarizerFatal('DeepSeek 返回 ${resp.statusCode}（Key 无效或余额不足）：${_short(resp.body)}');
      }
      if ((resp.statusCode == 429 || resp.statusCode >= 500) && attempt < 2) {
        await Future<void>.delayed(Duration(seconds: 5 * (attempt + 1)));
        continue;
      }
      if (resp.statusCode != 200) {
        throw Exception('DeepSeek HTTP ${resp.statusCode}：${_short(resp.body)}');
      }

      final j = jsonDecode(utf8.decode(resp.bodyBytes)) as Map<String, Object?>;
      final usage = (j['usage'] as Map?)?.cast<String, Object?>() ?? const {};
      int n(String k) => (usage[k] as num?)?.toInt() ?? 0;
      final hit = n('prompt_cache_hit_tokens');
      // 字段缺失时把全部输入按“未命中缓存”计价（偏保守）
      final miss = usage.containsKey('prompt_cache_miss_tokens') ? n('prompt_cache_miss_tokens') : n('prompt_tokens') - hit;
      final out = n('completion_tokens');

      final content = (((j['choices'] as List).first as Map)['message'] as Map)['content'] as String? ?? '';
      final parsed = parseAiJson(content, knownTags: config.tags);
      if (parsed == null) {
        // JSON 模式下无法解析时 DeepSeek 会返回空白内容；重试一次
        if (attempt < 1) continue;
        throw Exception('AI 输出无法解析为 JSON');
      }
      return SummaryResponse(parsed, hit, miss, out);
    }
  }

  void close() => _client.close();
}

String _short(String s) => s.length > 200 ? '${s.substring(0, 200)}…' : s;

/// 解析并清洗 AI 输出；不合格返回 null
AiResult? parseAiJson(String content, {List<String> knownTags = const []}) {
  var s = content.trim();
  if (s.startsWith('```')) {
    s = s.replaceFirst(RegExp(r'^```(?:json)?\s*'), '').replaceFirst(RegExp(r'\s*```$'), '');
  }
  if (s.isEmpty) return null;
  final Object? j;
  try {
    j = jsonDecode(s);
  } on FormatException {
    return null;
  }
  if (j is! Map) return null;
  final summary = j['summary']?.toString().trim() ?? '';
  if (summary.isEmpty) return null;

  List<String> strList(Object? v, int max) => v is List
      ? [for (final x in v) x.toString().trim()].where((x) => x.isNotEmpty).take(max).toList()
      : const [];

  final rel = j['relevance'];
  final relevance = (rel is num ? rel.round() : int.tryParse('$rel') ?? 3).clamp(1, 5);
  final level = j['level']?.toString();

  return AiResult(
    summary: summary,
    points: strList(j['points'], 4),
    tags: strList(j['tags'], 5).map((t) => t.replaceAll(RegExp(r'\s+'), '')).toSet().toList(),
    relevance: relevance,
    level: const {'入门', '进阶', '专业'}.contains(level) ? level : null,
  );
}
