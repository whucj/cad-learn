import 'package:html/parser.dart' as html_parser;

import 'feed_parser.dart';

/// 合集类订阅源（如 Graphics Programming Weekly 每期约 10 篇精选）的拆分规则。
/// 都是 CSS 选择器，相对于每期正文 HTML。
class SplitRule {
  const SplitRule({required this.item, required this.link, this.summary});

  /// 每篇文章的容器，如 `.post_container`
  final String item;

  /// 容器内的标题链接（取 href 和文字），如 `h2 a`
  final String link;

  /// 容器内的简介（可选），如 `.post_content`
  final String? summary;
}

/// 把每一期拆成一篇篇独立的文章。期数按新到旧处理，最多返回 [maxItems] 篇；
/// 同一链接只保留一次（最新那期）。拆出的文章用所在期的发布时间，via 指向该期。
List<FeedItem> expandDigest(List<FeedItem> issues, SplitRule rule, {int maxItems = 40}) {
  final sorted = [...issues]
    ..sort((a, b) => (b.publishedAt ?? DateTime(0)).compareTo(a.publishedAt ?? DateTime(0)));
  final out = <FeedItem>[];
  final seen = <String>{};

  for (final issue in sorted) {
    final html = issue.contentHtml;
    if (html == null || html.isEmpty) continue;
    final doc = html_parser.parseFragment(html);
    for (final box in doc.querySelectorAll(rule.item)) {
      final a = box.querySelector(rule.link);
      if (a == null) continue;
      final url = cleanItemUrl(a.attributes['href'] ?? '', baseUrl: issue.url);
      final title = cleanTitle(a.text);
      if (url == null || title.isEmpty || !seen.add(url)) continue;

      final summaryEl = rule.summary == null ? null : box.querySelector(rule.summary!);
      String? snippet;
      if (summaryEl != null) {
        final bullets = summaryEl
            .querySelectorAll('li')
            .map((li) => li.text.replaceAll(RegExp(r'\s+'), ' ').trim())
            .where((t) => t.isNotEmpty)
            .toList();
        snippet = bullets.isNotEmpty
            ? bullets.map((b) => '• $b').join('\n')
            : summaryEl.text.replaceAll(RegExp(r'\s+'), ' ').trim();
        if (snippet.length > 600) snippet = '${snippet.substring(0, 600)}…';
        if (snippet.isEmpty) snippet = null;
      }

      out.add(FeedItem(
        url: url,
        title: title,
        publishedAt: issue.publishedAt,
        summary: snippet,
        contentHtml: summaryEl?.innerHtml,
        via: Via(title: issue.title, url: issue.url),
      ));
      if (out.length >= maxItems) return out;
    }
  }
  return out;
}
