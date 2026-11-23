import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:path/path.dart' as p;

import 'feed_parser.dart' show Via;

class AiResult {
  AiResult({required this.summary, required this.points, required this.tags, required this.relevance, this.level});

  final String summary;
  final List<String> points;
  final List<String> tags;

  /// 1–5，与兴趣描述的相关度
  final int relevance;

  /// 入门 / 进阶 / 专业
  final String? level;

  Map<String, Object?> toJson() => {
        'summary': summary,
        'points': points,
        'tags': tags,
        'relevance': relevance,
        if (level != null) 'level': level,
      };

  factory AiResult.fromJson(Map<String, Object?> j) => AiResult(
        summary: j['summary'] as String? ?? '',
        points: [for (final x in (j['points'] as List? ?? const [])) x.toString()],
        tags: [for (final x in (j['tags'] as List? ?? const [])) x.toString()],
        relevance: (j['relevance'] as num?)?.toInt() ?? 0,
        level: j['level'] as String?,
      );
}

class StoredArticle {
  StoredArticle({
    required this.id,
    required this.url,
    required this.title,
    required this.source,
    required this.topic,
    required this.fetched,
    this.author,
    this.published,
    this.snippet,
    this.ai,
    this.aiTries = 0,
    this.feedHtml,
    this.via,
  });

  final String id;
  final String url;
  final String title;
  final String source;
  final String topic;
  final DateTime fetched;
  final String? author;
  final DateTime? published;

  /// feed 里的简短摘录（≤300 字），公开发布只保留这么多，不保存全文
  final String? snippet;

  AiResult? ai;
  int aiTries;

  /// 从合集中拆出时的出处（如 Graphics Programming Weekly 第 N 期）
  final Via? via;

  /// 仅本次运行内存中使用（给 AI 用），不写入 JSON
  final String? feedHtml;

  DateTime get sortTime => published ?? fetched;

  static String idFor(String url) => sha1.convert(utf8.encode(url)).toString().substring(0, 12);

  Map<String, Object?> toJson() => {
        'id': id,
        'url': url,
        'title': title,
        'source': source,
        'topic': topic,
        if (author != null) 'author': author,
        if (published != null) 'published': published!.toUtc().toIso8601String(),
        'fetched': fetched.toUtc().toIso8601String(),
        if (snippet != null && snippet!.isNotEmpty) 'snippet': snippet,
        if (via != null) 'via': via!.toJson(),
        if (ai != null) 'ai': ai!.toJson(),
        if (aiTries > 0 && ai == null) 'aiTries': aiTries,
      };

  factory StoredArticle.fromJson(Map<String, Object?> j) => StoredArticle(
        id: j['id'] as String,
        url: j['url'] as String,
        title: j['title'] as String,
        source: j['source'] as String,
        topic: j['topic'] as String,
        fetched: DateTime.parse(j['fetched'] as String),
        author: j['author'] as String?,
        published: j['published'] == null ? null : DateTime.parse(j['published'] as String),
        snippet: j['snippet'] as String?,
        ai: j['ai'] == null ? null : AiResult.fromJson((j['ai'] as Map).cast<String, Object?>()),
        aiTries: (j['aiTries'] as num?)?.toInt() ?? 0,
        via: Via.fromJson(j['via']),
      );
}

/// 月度用量统计（估算费用用于预算控制）
class MonthUsage {
  int calls = 0;
  int cacheHitTokens = 0;
  int cacheMissTokens = 0;
  int outputTokens = 0;
  double costUsd = 0;

  Map<String, Object?> toJson() => {
        'calls': calls,
        'cacheHitTokens': cacheHitTokens,
        'cacheMissTokens': cacheMissTokens,
        'outputTokens': outputTokens,
        'costUsd': double.parse(costUsd.toStringAsFixed(4)),
      };

  static MonthUsage fromJson(Map<String, Object?> j) => MonthUsage()
    ..calls = (j['calls'] as num?)?.toInt() ?? 0
    ..cacheHitTokens = (j['cacheHitTokens'] as num?)?.toInt() ?? 0
    ..cacheMissTokens = (j['cacheMissTokens'] as num?)?.toInt() ?? 0
    ..outputTokens = (j['outputTokens'] as num?)?.toInt() ?? 0
    ..costUsd = (j['costUsd'] as num?)?.toDouble() ?? 0;
}

String monthKey(DateTime t) => '${t.toUtc().year}-${t.toUtc().month.toString().padLeft(2, '0')}';

/// data/ 目录结构：
///   articles/YYYY-MM.json  按抓取月份分片的全部文章（去重依据）
///   latest.json            网页读取的最新 N 篇
///   usage.json             AI 用量与估算费用
///   status.json            各订阅源最近一次抓取状态
class Store {
  Store(this.dir);
  final String dir;

  final Map<String, List<StoredArticle>> _months = {};
  final Map<String, StoredArticle> _byId = {};
  final Map<String, MonthUsage> usage = {};

  static const latestCount = 500;

  Iterable<StoredArticle> get all => _byId.values;
  bool contains(String id) => _byId.containsKey(id);

  void load() {
    final articlesDir = Directory(p.join(dir, 'articles'));
    if (articlesDir.existsSync()) {
      for (final f in articlesDir.listSync().whereType<File>().where((f) => f.path.endsWith('.json'))) {
        final month = p.basenameWithoutExtension(f.path);
        final list = [
          for (final j in jsonDecode(f.readAsStringSync()) as List)
            StoredArticle.fromJson((j as Map).cast<String, Object?>())
        ];
        _months[month] = list;
        for (final a in list) {
          _byId[a.id] = a;
        }
      }
    }
    final u = File(p.join(dir, 'usage.json'));
    if (u.existsSync()) {
      final m = (jsonDecode(u.readAsStringSync()) as Map)['months'] as Map? ?? {};
      m.forEach((k, v) => usage[k as String] = MonthUsage.fromJson((v as Map).cast<String, Object?>()));
    }
  }

  void add(StoredArticle a) {
    if (_byId.containsKey(a.id)) return;
    _byId[a.id] = a;
    _months.putIfAbsent(monthKey(a.fetched), () => []).add(a);
  }

  MonthUsage usageFor(DateTime t) => usage.putIfAbsent(monthKey(t), MonthUsage.new);

  void save({required List<Map<String, Object?>> sourceStatus, DateTime? now, Map<String, Object?>? schedule}) {
    now ??= DateTime.now().toUtc();
    const enc = JsonEncoder.withIndent(' ');
    final articlesDir = Directory(p.join(dir, 'articles'))..createSync(recursive: true);

    _months.forEach((month, list) {
      list.sort((a, b) => b.sortTime.compareTo(a.sortTime));
      File(p.join(articlesDir.path, '$month.json'))
          .writeAsStringSync(enc.convert([for (final a in list) a.toJson()]));
    });

    final latest = _byId.values.toList()..sort((a, b) => b.sortTime.compareTo(a.sortTime));
    // latest.json 给手机加载，不缩进以减小体积
    File(p.join(dir, 'latest.json')).writeAsStringSync(jsonEncode({
      'generatedAt': now.toIso8601String(),
      'articles': [for (final a in latest.take(latestCount)) a.toJson()],
    }));

    File(p.join(dir, 'usage.json')).writeAsStringSync(enc.convert({
      'note': 'costUsd 为按配置价格估算的费用，以 DeepSeek 控制台账单为准',
      'months': {for (final e in (usage.entries.toList()..sort((a, b) => a.key.compareTo(b.key)))) e.key: e.value.toJson()},
    }));

    File(p.join(dir, 'status.json')).writeAsStringSync(enc.convert({
      'generatedAt': now.toIso8601String(),
      'schedule': ?schedule,
      'sources': sourceStatus,
    }));
  }
}
