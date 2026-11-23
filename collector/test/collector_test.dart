import 'dart:convert';
import 'dart:io';

import 'package:collector/collector.dart';
import 'package:collector/config.dart';
import 'package:collector/feed_parser.dart';
import 'package:collector/store.dart';
import 'package:collector/summarizer.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

const _rss = '''<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Blog</title>
<item>
  <title>  Ray Tracing   Gems </title>
  <link>https://example.com/rt?utm_source=rss#top</link>
  <dc:creator>Alice</dc:creator>
  <pubDate>Tue, 18 Nov 2026 10:30:00 +0800</pubDate>
  <description><![CDATA[<p>Short <b>intro</b></p>]]></description>
</item>
<item><title>No link</title></item>
</channel></rss>''';

const _atom = '''<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <updated>2026-11-01T12:00:00Z</updated>
    <link rel="alternate" type="text/html" href="https://arxiv.org/abs/2611.00001v2"/>
    <link rel="related" href="https://arxiv.org/pdf/2611.00001v2"/>
    <title>Robust
      NURBS Intersection</title>
    <summary>We present a robust method for NURBS surface intersection.</summary>
    <author><name>Bob</name></author>
  </entry>
</feed>''';

const _configYaml = '''
interests: 几何内核与实时渲染
tags: [NURBS, 光线追踪]
ai:
  monthly_budget_usd: 1.0
  max_per_run: 10
  max_age_days: 3650
sources:
  - { name: Blog, topic: rendering, url: "https://example.com/feed" }
  - { name: arXiv NURBS, topic: geometry, arxiv: 'abs:NURBS OR abs:"B-rep"' }
''';

String _deepseekReply(Map<String, Object?> content, {Map<String, Object?>? usage}) => jsonEncode({
      'choices': [
        {
          'message': {'role': 'assistant', 'content': jsonEncode(content)},
          'finish_reason': 'stop',
        }
      ],
      'usage': usage ??
          {'prompt_tokens': 3000, 'prompt_cache_hit_tokens': 1000, 'prompt_cache_miss_tokens': 2000, 'completion_tokens': 400},
    });

void main() {
  group('FeedParser', () {
    test('RSS 2.0', () {
      final i = FeedParser.parse(_rss).single;
      expect(i.title, 'Ray Tracing Gems');
      expect(i.url, 'https://example.com/rt');
      expect(i.author, 'Alice');
      expect(i.publishedAt, DateTime.utc(2026, 11, 18, 2, 30));
      expect(i.summary, 'Short intro');
    });

    test('Atom + arXiv URL normalization', () {
      final i = FeedParser.parse(_atom).single;
      expect(i.url, 'https://arxiv.org/abs/2611.00001');
      expect(i.title, 'Robust NURBS Intersection');
      expect(i.author, 'Bob');
    });

    test('tolerates junk before the XML (broken WordPress feeds)', () {
      final i = FeedParser.parse('<script>\nMathJax = {};\n</script>\n\n$_rss').single;
      expect(i.title, 'Ray Tracing Gems');
    });

    test('rejects non-feed', () {
      expect(() => FeedParser.parse('<html/>'), throwsA(isA<FeedParseException>()));
      expect(() => FeedParser.parse('not xml'), throwsA(isA<FeedParseException>()));
    });

    test('drops unsafe links and resolves relative ones', () {
      const rss = '''<rss><channel>
        <item><title>xss</title><link>javascript:alert(document.domain)</link></item>
        <item><title>xss2</title><link> JavaScript:alert(1)</link></item>
        <item><title>data</title><link>data:text/html,hi</link></item>
        <item><title>mail</title><link>mailto:a@b.c</link></item>
        <item><title>rel</title><link>/posts/bvh?utm_source=rss</link></item>
        <item><title>proto</title><link>//cdn.example.org/a</link></item>
        <item><title>ok</title><link>https://example.com/ok</link></item>
      </channel></rss>''';
      final items = FeedParser.parse(rss, baseUrl: 'https://blog.example.com/feed.xml');
      expect(items.map((i) => i.title), ['rel', 'proto', 'ok']);
      expect(items.map((i) => i.url), [
        'https://blog.example.com/posts/bvh',
        'https://cdn.example.org/a',
        'https://example.com/ok',
      ]);
      // 没有 baseUrl 时相对链接、协议相对链接都无法补全，丢弃
      expect(FeedParser.parse(rss).map((i) => i.title), ['ok']);

      const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>a</title>'
          '<link href="javascript:void(0)"/></entry><entry><title>b</title><link href="b.html"/></entry></feed>';
      expect(FeedParser.parse(atom, baseUrl: 'https://x.org/blog/atom.xml').single.url, 'https://x.org/blog/b.html');
    });

    test('normalizeUrl / parseDate', () {
      expect(normalizeUrl('https://example.com/a?utm_medium=x&id=3'), 'https://example.com/a?id=3');
      expect(parseDate('Mon, 17 Nov 2026 08:00:00 PST'), DateTime.utc(2026, 11, 17, 16));
      expect(parseDate('garbage'), isNull);
    });
  });

  group('Config', () {
    test('parses sources and builds arXiv URL', () {
      final c = Config.parse(_configYaml);
      expect(c.sources, hasLength(2));
      expect(c.sources[1].isArxiv, isTrue);
      expect(c.sources[1].url, contains('search_query=abs%3ANURBS+OR+abs%3A%22B-rep%22'));
      expect(c.ai.model, 'deepseek-flash');
      expect(c.ai.monthlyBudgetUsd, 1.0);
    });

    test('repo config.yaml is valid', () {
      final c = Config.load('../config.yaml');
      expect(c.sources.length, greaterThan(10));
      expect(c.tags, contains('NURBS'));
    });

    test('rejects bad topic', () {
      expect(() => Config.parse('sources:\n  - {name: X, topic: foo, url: "https://x"}'), throwsFormatException);
    });
  });

  group('AI helpers', () {
    test('parseAiJson cleans output', () {
      final r = parseAiJson('```json\n{"summary":"摘要","points":["a","b","c","d","e"],'
          '"tags":["光线 追踪","光线追踪"],"relevance":9,"level":"高级"}\n```')!;
      expect(r.summary, '摘要');
      expect(r.points, hasLength(4));
      expect(r.tags, ['光线追踪']);
      expect(r.relevance, 5);
      expect(r.level, isNull);
      expect(parseAiJson('   '), isNull);
      expect(parseAiJson('{"points":[]}'), isNull);
    });

    test('isPeak follows DeepSeek windows', () {
      expect(isPeak(DateTime.utc(2026, 11, 23, 2)), isTrue); // 周一 02:00
      expect(isPeak(DateTime.utc(2026, 11, 23, 5)), isFalse);
      expect(isPeak(DateTime.utc(2026, 11, 23, 9, 59)), isTrue);
      expect(isPeak(DateTime.utc(2026, 11, 22, 2)), isFalse); // 周日
    });

    test('estimateCost', () {
      final p = Prices(cacheHit: 0.003, cacheMiss: 0.15, output: 0.6);
      final off = estimateCost(p, hit: 1000, miss: 2000, output: 400, peak: false);
      expect(off, closeTo((1000 * 0.003 + 2000 * 0.15 + 400 * 0.6) / 1e6, 1e-12));
      expect(estimateCost(p, hit: 1000, miss: 2000, output: 400, peak: true), closeTo(off * 2, 1e-12));
    });
  });

  test('releaseTitle prefixes repo name when missing', () {
    const occt = 'https://github.com/Open-Cascade-SAS/OCCT/releases.atom';
    expect(releaseTitle(occt, 'V8_0_2'), 'OCCT V8_0_2');
    expect(releaseTitle('https://github.com/CGAL/cgal/releases.atom', 'CGAL 6.2.1'), 'CGAL 6.2.1');
    expect(releaseTitle('https://github.com/gfx-rs/wgpu/releases.atom', 'wgpu-v30.0.2'), 'wgpu-v30.0.2');
    expect(releaseTitle('https://example.com/feed', 'V1'), 'V1');
  });

  group('Collector', () {
    late Directory tmp;
    setUp(() => tmp = Directory.systemTemp.createTempSync('collector_test'));
    tearDown(() => tmp.deleteSync(recursive: true));

    Future<String> fakeFetch(String url) async {
      if (url == 'https://example.com/feed') return _rss;
      if (url.contains('arxiv.org/api')) return _atom;
      if (url == 'https://example.com/rt') {
        return '<html><body><nav>menu</nav><article><p>${List.filled(40, 'BVH traversal details.').join(' ')}</p></article></body></html>';
      }
      throw Exception('unexpected $url');
    }

    test('fetch, dedupe, summarize, persist; second run adds nothing', () async {
      final config = Config.parse(_configYaml);
      final requests = <Map<String, Object?>>[];
      final client = MockClient((req) async {
        requests.add(jsonDecode(req.body) as Map<String, Object?>);
        expect(req.headers['Authorization'], 'Bearer test-key');
        return http.Response(
          _deepseekReply({'summary': '中文摘要', 'points': ['要点'], 'tags': ['NURBS'], 'relevance': 4, 'level': '进阶'}),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });
      final clock = DateTime.utc(2026, 11, 23, 12); // 非高峰
      var store = Store(tmp.path)..load();
      final report = await Collector(
        config: config,
        store: store,
        summarizer: Summarizer(config: config, apiKey: 'test-key', client: client),
        fetch: fakeFetch,
        log: (_) {},
        clock: () => clock,
      ).run();
      store.save(sourceStatus: report.sourceStatus, now: clock);

      expect(report.added, 2);
      expect(report.summarized, 2);
      expect(requests.first['model'], 'deepseek-flash');
      expect(requests.first['thinking'], {'type': 'disabled'});
      expect(requests.first['response_format'], {'type': 'json_object'});
      final userMsgs = requests.map((r) => ((r['messages'] as List)[1] as Map)['content'] as String).toList();
      // 博客：feed 摘要太短 → 抓原网页正文（不含导航）
      expect(userMsgs.firstWhere((m) => m.contains('Ray Tracing')), allOf(contains('BVH traversal'), isNot(contains('menu'))));
      // arXiv：直接用摘要，不抓网页
      expect(userMsgs.firstWhere((m) => m.contains('NURBS Intersection')), contains('robust method'));

      final latest = jsonDecode(File('${tmp.path}/latest.json').readAsStringSync()) as Map;
      final articles = latest['articles'] as List;
      expect(articles, hasLength(2));
      expect((articles.first as Map)['ai']['summary'], '中文摘要');
      expect((articles.first as Map).containsKey('feedHtml'), isFalse);
      final usage = jsonDecode(File('${tmp.path}/usage.json').readAsStringSync()) as Map;
      expect(usage['months']['2026-11']['calls'], 2);
      final status = jsonDecode(File('${tmp.path}/status.json').readAsStringSync()) as Map;
      expect((status['sources'] as List).every((s) => (s as Map)['ok'] == true), isTrue);

      // 第二次运行：全部已存在
      store = Store(tmp.path)..load();
      final again = await Collector(config: config, store: store, summarizer: null, fetch: fakeFetch, log: (_) {}).run();
      expect(again.added, 0);
    });

    test('stops at monthly budget and on fatal API error', () async {
      final config = Config.parse(_configYaml);
      final clock = DateTime.utc(2026, 11, 23, 12);

      // 预算已用完
      var store = Store(tmp.path)..load();
      store.usageFor(clock).costUsd = 1.0;
      var calls = 0;
      var report = await Collector(
        config: config,
        store: store,
        summarizer: Summarizer(
            config: config,
            apiKey: 'k',
            client: MockClient((_) async {
              calls++;
              return http.Response('{}', 200);
            })),
        fetch: fakeFetch,
        log: (_) {},
        clock: () => clock,
      ).run();
      expect(calls, 0);
      expect(report.aiStopReason, contains('预算'));

      // 余额不足 402：只调用一次就停止
      store = Store(tmp.path)..load();
      calls = 0;
      report = await Collector(
        config: config,
        store: store,
        summarizer: Summarizer(
            config: config,
            apiKey: 'k',
            client: MockClient((_) async {
              calls++;
              return http.Response('{"error":{"message":"Insufficient Balance"}}', 402);
            })),
        fetch: fakeFetch,
        log: (_) {},
        clock: () => clock,
      ).run();
      expect(calls, 1);
      expect(report.aiStopReason, contains('402'));
    });
  });
}
