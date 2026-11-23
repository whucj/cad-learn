import 'dart:convert';
import 'dart:io';

import 'package:collector/collector.dart';
import 'package:collector/config.dart';
import 'package:collector/digest.dart';
import 'package:collector/extractor.dart';
import 'package:collector/feed_parser.dart';
import 'package:collector/store.dart';
import 'package:collector/summarizer.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

/// 结构仿照 Graphics Programming Weekly 的真实 HTML（2026-11 第 463 期）
String _post(String href, String title, List<String> bullets) => '''
<p>
<div class="post_container">
    <div class="post_header">
		<hr>
		<h2> <a href="$href" target="_blank" id="$title">$title</a></h2>
    </div>
    <div class="post_content">
     <ul>
${bullets.map((b) => '<li>$b</li>').join('\n')}
</ul>
    </div>
    <div class="post_image"><img src="https://www.jendrikillner.com/img/x.png"/></div>
    <div class="post_footer_right">
        <a href="https://web.archive.org/web/2026/$href">wayback-archive</a>
    </div>
</div></p>''';

String _issue(int n, String date, String body) => '''
<item>
  <title>Graphics Programming weekly - Issue $n - $date</title>
  <link>https://www.jendrikillner.com/post/graphics-programming-weekly-issue-$n/</link>
  <pubDate>$date</pubDate>
  <description><![CDATA[$body
<hr />
<p>Thanks to <a href="https://www.reedbeta.com">Nathan Reed</a> for support of this series.</p>]]></description>
</item>''';

final _feed = '''<?xml version="1.0"?><rss version="2.0"><channel><title>GPW</title>
${_issue(462, 'Sun, 08 Nov 2026 04:00:00 +0000', [
      _post('https://example.com/older-only', 'Older Only', ['old bullet']),
      _post('https://www.jacktollenaar.top/articles/split-rc.html', 'Split Radiance Cascades (old)', ['dup']),
    ].join())}
${_issue(463, 'Sun, 15 Nov 2026 04:00:00 +0000', [
      _post('https://dl.acm.org/doi/10.1145/3842562', 'Stealthy Blue Noise', [
        'presents a way to generate blue-noise samples',
        'applies the method to stippling &amp; spherical surfaces',
      ]),
      _post('https://www.youtube.com/watch?v=mHIJVclRZ18', '[video] The Hidden Assumptions in Every Volume Renderer', ['explains exponential attenuation']),
      _post('https://www.jacktollenaar.top/articles/split-rc.html', 'Split Radiance Cascades', ['adapts radiance cascades for 3D GI']),
      _post('javascript:alert(1)', 'Evil', ['x']),
      _post('/post/local-page/', 'Relative Link', ['y']),
      _post('https://arxiv.org/abs/2611.17185v1', 'Neural Render Proxies', ['neural proxies']),
    ].join())}
</channel></rss>''';

const _rule = SplitRule(item: '.post_container', link: 'h2 a', summary: '.post_content');

void main() {
  group('expandDigest', () {
    final issues = FeedParser.parse(_feed, baseUrl: 'https://www.jendrikillner.com/post/index.xml');

    test('splits issues into articles, newest issue first, dedupes and drops unsafe links', () {
      final items = expandDigest(issues, _rule);
      expect(items.map((i) => i.title), [
        'Stealthy Blue Noise',
        '[video] The Hidden Assumptions in Every Volume Renderer',
        'Split Radiance Cascades',
        'Relative Link',
        'Neural Render Proxies',
        'Older Only',
      ]);
      final blue = items.first;
      expect(blue.url, 'https://dl.acm.org/doi/10.1145/3842562');
      expect(blue.publishedAt, DateTime.utc(2026, 11, 15, 4));
      expect(blue.summary, '• presents a way to generate blue-noise samples\n• applies the method to stippling & spherical surfaces');
      expect(blue.via!.title, 'Graphics Programming weekly - Issue 463 - Sun, 15 Nov 2026 04:00:00 +0000');
      expect(blue.via!.url, 'https://www.jendrikillner.com/post/graphics-programming-weekly-issue-463/');
      // 相对链接按该期地址补全；arXiv 版本号去掉；wayback 存档链接不会被当成文章
      expect(items[3].url, 'https://www.jendrikillner.com/post/local-page/');
      expect(items[4].url, 'https://arxiv.org/abs/2611.17185');
      expect(items.any((i) => i.url.contains('web.archive.org')), isFalse);
      // 致谢段落不在 .post_container 里，不会被拆出
      expect(items.any((i) => i.url.contains('reedbeta')), isFalse);
    });

    test('respects maxItems', () {
      expect(expandDigest(issues, _rule, maxItems: 2), hasLength(2));
    });

    test('without summary selector there is no snippet', () {
      final items = expandDigest(issues, const SplitRule(item: '.post_container', link: 'h2 a'));
      expect(items.first.summary, isNull);
    });
  });

  group('Config split', () {
    test('parses split rule', () {
      final c = Config.parse('''
sources:
  - name: GPW
    topic: rendering
    url: "https://www.jendrikillner.com/post/index.xml"
    split: { item: ".post_container", link: "h2 a", summary: ".post_content" }
''');
      expect(c.sources.single.split!.item, '.post_container');
      expect(c.sources.single.split!.summary, '.post_content');
    });

    test('rejects incomplete split rule', () {
      expect(
        () => Config.parse('sources:\n  - {name: X, topic: general, url: "https://x", split: {item: ".a"}}'),
        throwsFormatException,
      );
    });

    test('repo config uses split for Graphics Programming Weekly', () {
      final c = Config.load('../config.yaml');
      expect(c.sources.firstWhere((s) => s.name == 'Graphics Programming Weekly').split, isNotNull);
    });
  });

  test('textForAi keeps the feed summary ahead of page text and skips video pages', () async {
    final fetched = <String>[];
    Future<String> fetch(String url) async {
      fetched.add(url);
      return '<html><body><article><p>${List.filled(30, 'Full article body text.').join(' ')}</p></article></body></html>';
    }

    final text = await textForAi(url: 'https://blog.example.com/a', feedHtml: '<ul><li>editor bullet</li></ul>', maxChars: 6000, fetch: fetch);
    expect(text, startsWith('订阅源简介：\neditor bullet\n\n原文正文：\nFull article body'));

    final video = await textForAi(url: 'https://www.youtube.com/watch?v=x', feedHtml: '<li>video bullet</li>', maxChars: 6000, fetch: fetch);
    expect(video, 'video bullet');
    expect(fetched, ['https://blog.example.com/a']);
  });

  test('collector stores split articles with via and gives AI the issue context', () async {
    final tmp = Directory.systemTemp.createTempSync('digest_test');
    addTearDown(() => tmp.deleteSync(recursive: true));
    final config = Config.parse('''
interests: 渲染
ai: { max_age_days: 3650 }
sources:
  - name: Graphics Programming Weekly
    topic: rendering
    url: "https://www.jendrikillner.com/post/index.xml"
    split: { item: ".post_container", link: "h2 a", summary: ".post_content" }
''');
    final fetched = <String>[];
    final userMessages = <String>[];
    final client = MockClient((req) async {
      final body = jsonDecode(req.body) as Map;
      userMessages.add(((body['messages'] as List)[1] as Map)['content'] as String);
      return http.Response(
        jsonEncode({
          'choices': [
            {'message': {'content': jsonEncode({'summary': '摘要', 'points': [], 'tags': [], 'relevance': 4})}}
          ],
          'usage': {'prompt_tokens': 100, 'completion_tokens': 20},
        }),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    final store = Store(tmp.path)..load();
    final report = await Collector(
      config: config,
      store: store,
      summarizer: Summarizer(config: config, apiKey: 'k', client: client),
      fetch: (url) async {
        fetched.add(url);
        if (url.endsWith('index.xml')) return _feed;
        throw Exception('page fetch blocked in test');
      },
      log: (_) {},
      clock: () => DateTime.utc(2026, 11, 23, 12),
    ).run();
    store.save(sourceStatus: report.sourceStatus);

    expect(report.added, 6);
    expect(report.summarized, 6);
    expect(fetched.any((u) => u.contains('youtube.com')), isFalse);
    final blueMsg = userMessages.firstWhere((m) => m.contains('Stealthy Blue Noise'));
    expect(blueMsg, contains('收录于：Graphics Programming weekly - Issue 463'));
    expect(blueMsg, contains('presents a way to generate blue-noise samples'));

    final latest = jsonDecode(File('${tmp.path}/latest.json').readAsStringSync()) as Map;
    final blue = (latest['articles'] as List).cast<Map>().firstWhere((a) => a['title'] == 'Stealthy Blue Noise');
    expect(blue['source'], 'Graphics Programming Weekly');
    expect(blue['via']['url'], 'https://www.jendrikillner.com/post/graphics-programming-weekly-issue-463/');
    expect(blue['snippet'], startsWith('• presents'));
  });
}
