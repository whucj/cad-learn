import 'config.dart';
import 'extractor.dart';
import 'feed_parser.dart';
import 'net.dart';
import 'store.dart';
import 'summarizer.dart';

typedef Log = void Function(String msg);

/// GitHub Releases 的标题常常只有版本号（如 "V8_0_2"），列表和导出文件名里分不清项目，
/// 标题中没有仓库名时加上前缀："OCCT V8_0_2"。
String releaseTitle(String feedUrl, String title) {
  final m = RegExp(r'^https://github\.com/[^/]+/([^/]+)/(?:releases|tags)\.atom$').firstMatch(feedUrl);
  if (m == null) return title;
  final repo = m.group(1)!;
  return title.toLowerCase().contains(repo.toLowerCase()) ? title : '$repo $title';
}

class RunReport {
  int added = 0;
  int summarized = 0;
  int summaryFailed = 0;
  double costUsd = 0;
  String? aiStopReason;
  final List<Map<String, Object?>> sourceStatus = [];
}

class Collector {
  Collector({
    required this.config,
    required this.store,
    this.summarizer,
    this.fetch = fetchText,
    this.log = print,
    DateTime Function()? clock,
  }) : clock = clock ?? DateTime.now;

  final Config config;
  final Store store;

  /// 为 null 时只抓取不摘要（没有配置 API Key）
  final Summarizer? summarizer;
  final Future<String> Function(String url) fetch;
  final Log log;
  final DateTime Function() clock;

  static const maxItemsPerSource = 40;

  Future<RunReport> run() async {
    final report = RunReport();
    final fresh = await _fetchAll(report);
    log('抓取完成：新增 ${report.added} 篇');
    if (summarizer == null) {
      report.aiStopReason = '未设置 DEEPSEEK_API_KEY，跳过 AI 摘要';
    } else {
      await _summarize(report, fresh);
    }
    if (report.aiStopReason != null) log(report.aiStopReason!);
    log('AI 摘要：成功 ${report.summarized}，失败 ${report.summaryFailed}，本次估算 \$${report.costUsd.toStringAsFixed(4)}');
    return report;
  }

  Future<Map<String, StoredArticle>> _fetchAll(RunReport report) async {
    final fresh = <String, StoredArticle>{};
    final queue = config.sources.where((s) => !s.isArxiv).toList();
    final arxiv = config.sources.where((s) => s.isArxiv).toList();
    final status = <String, Map<String, Object?>>{};

    Future<void> one(SourceConfig s) async {
      final now = clock().toUtc();
      try {
        final items = FeedParser.parse(await fetch(s.url))
          ..sort((a, b) => (b.publishedAt ?? DateTime(0)).compareTo(a.publishedAt ?? DateTime(0)));
        var added = 0;
        for (final i in items.take(maxItemsPerSource)) {
          final id = StoredArticle.idFor(i.url);
          if (store.contains(id) || fresh.containsKey(id)) continue;
          final a = StoredArticle(
            id: id,
            url: i.url,
            title: releaseTitle(s.url, i.title),
            source: s.name,
            topic: s.topic,
            fetched: now,
            author: i.author,
            published: i.publishedAt,
            snippet: i.summary,
            feedHtml: i.contentHtml,
          );
          fresh[id] = a;
          store.add(a);
          added++;
        }
        report.added += added;
        status[s.name] = {'name': s.name, 'topic': s.topic, 'ok': true, 'items': items.length, 'added': added};
        log('  OK   ${s.name}: ${items.length} 条，新增 $added');
      } catch (e) {
        status[s.name] = {'name': s.name, 'topic': s.topic, 'ok': false, 'error': e.toString()};
        log('  FAIL ${s.name}: $e');
      }
    }

    Future<void> worker() async {
      while (queue.isNotEmpty) {
        await one(queue.removeLast());
      }
    }

    // arXiv API 要求请求间隔约 3 秒
    Future<void> arxivWorker() async {
      for (var i = 0; i < arxiv.length; i++) {
        if (i > 0) await Future<void>.delayed(const Duration(seconds: 3));
        await one(arxiv[i]);
      }
    }

    await Future.wait([...List.generate(4, (_) => worker()), arxivWorker()]);
    // 状态按配置顺序输出
    report.sourceStatus.addAll([for (final s in config.sources) status[s.name]!]);
    return fresh;
  }

  Future<void> _summarize(RunReport report, Map<String, StoredArticle> fresh) async {
    final ai = config.ai;
    final now = clock().toUtc();
    final cutoff = now.subtract(Duration(days: ai.maxAgeDays));

    // 候选：没有摘要、最近 N 天、失败次数 < 2；新的优先
    final candidates = store.all
        .where((a) => a.ai == null && a.aiTries < 2 && a.sortTime.isAfter(cutoff))
        .toList()
      ..sort((a, b) => b.sortTime.compareTo(a.sortTime));

    final usage = store.usageFor(now);
    for (final a in candidates.take(ai.maxPerRun)) {
      if (usage.costUsd >= ai.monthlyBudgetUsd) {
        report.aiStopReason = '本月估算花费 \$${usage.costUsd.toStringAsFixed(2)} 已达预算 \$${ai.monthlyBudgetUsd}，停止摘要';
        return;
      }
      try {
        final text = await textForAi(
          url: a.url,
          // 旧文章的 feed 正文没存盘，只能用摘录或抓原网页
          feedHtml: fresh[a.id]?.feedHtml ?? a.snippet,
          maxChars: ai.maxInputChars,
          fetch: fetch,
        );
        final r = await summarizer!.summarize(title: a.title, source: a.source, url: a.url, text: text);
        final cost = estimateCost(ai.offpeak, hit: r.hitTokens, miss: r.missTokens, output: r.outputTokens, peak: isPeak(clock()));
        a.ai = r.result;
        usage
          ..calls += 1
          ..cacheHitTokens += r.hitTokens
          ..cacheMissTokens += r.missTokens
          ..outputTokens += r.outputTokens
          ..costUsd += cost;
        report
          ..summarized += 1
          ..costUsd += cost;
      } on SummarizerFatal catch (e) {
        report.aiStopReason = e.message;
        return;
      } catch (e) {
        a.aiTries += 1;
        report.summaryFailed += 1;
        log('  AI 失败 ${a.title}: $e');
      }
    }
  }
}
