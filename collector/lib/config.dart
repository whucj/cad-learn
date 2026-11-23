import 'dart:io';

import 'package:yaml/yaml.dart';

import 'digest.dart';
import 'schedule.dart';

class SourceConfig {
  SourceConfig({required this.name, required this.url, required this.topic, this.split});
  final String name;
  final String url;
  final String topic;

  /// 合集类订阅源的拆分规则（可选）
  final SplitRule? split;

  bool get isArxiv => Uri.parse(url).host.endsWith('arxiv.org');
}

class Prices {
  Prices({required this.cacheHit, required this.cacheMiss, required this.output});
  final double cacheHit;
  final double cacheMiss;
  final double output;
}

class AiConfig {
  AiConfig({
    required this.model,
    required this.baseUrl,
    required this.monthlyBudgetUsd,
    required this.maxPerRun,
    required this.maxAgeDays,
    required this.maxInputChars,
    required this.offpeak,
  });

  final String model;
  final String baseUrl;
  final double monthlyBudgetUsd;
  final int maxPerRun;
  final int maxAgeDays;
  final int maxInputChars;
  final Prices offpeak;
}

class Config {
  Config({
    required this.interests,
    required this.tags,
    required this.ai,
    required this.sources,
    this.schedule = const ScheduleConfig(),
  });

  /// 更新周期
  final ScheduleConfig schedule;

  final String interests;
  final List<String> tags;
  final AiConfig ai;
  final List<SourceConfig> sources;

  static const topics = {'geometry', 'rendering', 'general'};

  static Config load(String path) => parse(File(path).readAsStringSync());

  static Config parse(String yamlText) {
    final y = loadYaml(yamlText) as YamlMap;
    final ai = (y['ai'] as YamlMap?) ?? YamlMap();
    final price = (ai['price_offpeak'] as YamlMap?) ?? YamlMap();

    final sources = <SourceConfig>[];
    for (final s in (y['sources'] as YamlList? ?? YamlList())) {
      final m = s as YamlMap;
      final name = m['name']?.toString();
      final topic = m['topic']?.toString() ?? 'general';
      if (name == null) throw FormatException('订阅源缺少 name：$m');
      if (!topics.contains(topic)) throw FormatException('「$name」的 topic 必须是 $topics 之一');
      final String url;
      if (m['arxiv'] != null) {
        url = arxivQueryUrl(m['arxiv'].toString());
      } else if (m['url'] != null) {
        url = m['url'].toString();
      } else {
        throw FormatException('「$name」需要 url 或 arxiv');
      }
      SplitRule? split;
      if (m['split'] != null) {
        final sp = m['split'];
        if (sp is! YamlMap || sp['item'] == null || sp['link'] == null) {
          throw FormatException('「$name」的 split 需要 item 和 link 两个选择器');
        }
        split = SplitRule(item: '${sp['item']}', link: '${sp['link']}', summary: sp['summary']?.toString());
      }
      sources.add(SourceConfig(name: name, url: url, topic: topic, split: split));
    }

    double d(Object? v, double def) => v == null ? def : (v as num).toDouble();
    int i(Object? v, int def) => v == null ? def : (v as num).toInt();

    final schedule = ScheduleConfig.parse(y['schedule'] as Map?);
    return Config(
      schedule: schedule,
      interests: (y['interests'] ?? '').toString().trim(),
      tags: [for (final t in (y['tags'] as YamlList? ?? YamlList())) t.toString()],
      ai: AiConfig(
        model: (ai['model'] ?? 'deepseek-flash').toString(),
        baseUrl: (ai['base_url'] ?? 'https://api.deepseek.com').toString(),
        monthlyBudgetUsd: d(ai['monthly_budget_usd'], 4.5),
        // 未设置时随更新周期放大（每周一次就每次多处理一些），见 ScheduleConfig.defaultMaxPerRun
        maxPerRun: i(ai['max_per_run'], schedule.defaultMaxPerRun),
        maxAgeDays: i(ai['max_age_days'], 30),
        maxInputChars: i(ai['max_input_chars'], 6000),
        offpeak: Prices(
          cacheHit: d(price['input_cache_hit'], 0.003),
          cacheMiss: d(price['input_cache_miss'], 0.15),
          output: d(price['output'], 0.6),
        ),
      ),
      sources: sources,
    );
  }
}

/// arXiv API：按提交时间倒序（rss.arxiv.org 只含当天公告，周末为空，所以不用）
String arxivQueryUrl(String query) =>
    'https://export.arxiv.org/api/query?search_query=${Uri.encodeQueryComponent(query)}'
    '&sortBy=submittedDate&sortOrder=descending&max_results=30';
