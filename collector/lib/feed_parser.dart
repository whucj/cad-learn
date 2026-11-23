import 'package:html/parser.dart' as html_parser;
import 'package:xml/xml.dart';

/// feed 中解析出的一条内容（尚未关联 sourceId）
class FeedItem {
  FeedItem({
    required this.url,
    required this.title,
    this.author,
    this.publishedAt,
    this.summary,
    this.contentHtml,
  });

  final String url;
  final String title;
  final String? author;
  final DateTime? publishedAt;
  final String? summary;
  final String? contentHtml;
}

class FeedParseException implements Exception {
  FeedParseException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// 解析 RSS 2.0 / RSS 1.0 (RDF) / Atom。
/// [baseUrl] 为订阅源地址，用于补全相对链接；无法得到 http(s) 链接的条目会被丢弃。
class FeedParser {
  static List<FeedItem> parse(String xmlText, {String? baseUrl}) {
    final XmlDocument doc;
    try {
      doc = XmlDocument.parse(xmlText);
    } on XmlException catch (e) {
      throw FeedParseException('不是有效的 XML：${e.message}');
    }
    final root = doc.rootElement;
    switch (root.name.local) {
      case 'feed':
        return root.childElements
            .where((e) => e.name.local == 'entry')
            .map((e) => _atomEntry(e, baseUrl))
            .nonNulls
            .toList();
      case 'rss':
        final channel = _child(root, 'channel');
        if (channel == null) throw FeedParseException('RSS 缺少 channel');
        return channel.childElements
            .where((e) => e.name.local == 'item')
            .map((e) => _rssItem(e, baseUrl))
            .nonNulls
            .toList();
      case 'RDF':
        return root.childElements
            .where((e) => e.name.local == 'item')
            .map((e) => _rssItem(e, baseUrl))
            .nonNulls
            .toList();
      default:
        throw FeedParseException('不支持的 feed 格式：<${root.name.qualified}>');
    }
  }

  static FeedItem? _rssItem(XmlElement item, String? baseUrl) {
    final raw = _text(item, 'link') ?? _permalinkGuid(item);
    final title = _text(item, 'title');
    final link = raw == null ? null : cleanItemUrl(raw, baseUrl: baseUrl);
    if (link == null || title == null) return null;
    final description = _text(item, 'description');
    final encoded = _text(item, 'encoded'); // content:encoded
    return FeedItem(
      url: link,
      title: cleanTitle(title),
      author: _text(item, 'creator') ?? _text(item, 'author'),
      publishedAt: parseDate(_text(item, 'pubDate') ?? _text(item, 'date')),
      summary: description == null ? null : htmlToPlain(description, maxLength: 300),
      contentHtml: encoded ?? description,
    );
  }

  static FeedItem? _atomEntry(XmlElement entry, String? baseUrl) {
    final links = entry.childElements.where((e) => e.name.local == 'link').toList();
    String? href;
    for (final l in links) {
      if ((l.getAttribute('rel') ?? 'alternate') == 'alternate') {
        href = l.getAttribute('href');
        break;
      }
    }
    href ??= links.isEmpty ? null : links.first.getAttribute('href');
    final title = _text(entry, 'title');
    final link = href == null ? null : cleanItemUrl(href, baseUrl: baseUrl);
    if (link == null || title == null) return null;
    final summary = _text(entry, 'summary');
    final content = _text(entry, 'content');
    final author = _child(entry, 'author');
    return FeedItem(
      url: link,
      title: cleanTitle(title),
      author: author == null ? null : _text(author, 'name'),
      publishedAt: parseDate(_text(entry, 'published') ?? _text(entry, 'updated')),
      summary: htmlToPlain(summary ?? content ?? '', maxLength: 300),
      contentHtml: content ?? summary,
    );
  }

  static String? _permalinkGuid(XmlElement item) {
    final guid = _child(item, 'guid');
    if (guid == null) return null;
    final text = guid.innerText.trim();
    return text.startsWith('http') ? text : null;
  }

  static XmlElement? _child(XmlElement parent, String local) {
    for (final e in parent.childElements) {
      if (e.name.local == local) return e;
    }
    return null;
  }

  static String? _text(XmlElement parent, String local) {
    final e = _child(parent, local);
    if (e == null) return null;
    final t = e.innerText.trim();
    return t.isEmpty ? null : t;
  }
}

/// 条目链接：补全相对链接（相对于订阅源地址）→ 只接受 http(s) → 规范化。
/// 返回 null 表示不安全或无效（如 javascript:、data:、mailto:），该条目应丢弃。
/// 网页会把这个链接直接用作“阅读原文”的 href，所以这里是第一道安全关口。
String? cleanItemUrl(String raw, {String? baseUrl}) {
  final ref = Uri.tryParse(raw.trim());
  if (ref == null) return null;
  final base = baseUrl == null ? null : Uri.tryParse(baseUrl);
  final Uri abs;
  try {
    abs = ref.hasScheme || base == null ? ref : base.resolveUri(ref);
  } on FormatException {
    return null;
  }
  if ((abs.scheme != 'http' && abs.scheme != 'https') || abs.host.isEmpty) return null;
  return normalizeUrl(abs.toString());
}

/// 去掉常见追踪参数和锚点，用于按 URL 去重。
String normalizeUrl(String url) {
  final uri = Uri.tryParse(url.trim());
  if (uri == null) return url.trim();
  final params = Map.of(uri.queryParameters)
    ..removeWhere((k, _) => k.startsWith('utm_') || k == 'ref' || k == 'source');
  // 注意：replace(queryParameters: null) 会保留原 query，所以空参数时显式传 query: ''
  final cleaned =
      params.isEmpty ? uri.replace(query: '', fragment: '') : uri.replace(queryParameters: params, fragment: '');
  return cleaned
      .toString()
      .replaceAll(RegExp(r'[?#]+$'), '')
      // arXiv 论文的 v1/v2 视为同一篇；统一 https
      .replaceFirstMapped(RegExp(r'^https?://arxiv\.org/(abs|pdf)/([\d.]+)v\d+$'),
          (m) => 'https://arxiv.org/abs/${m[2]}');
}

String cleanTitle(String title) => title.replaceAll(RegExp(r'\s+'), ' ').trim();

/// HTML 片段转纯文本（列表预览用）
String htmlToPlain(String html, {int? maxLength}) {
  final text = (html_parser.parseFragment(html).text ?? '').replaceAll(RegExp(r'\s+'), ' ').trim();
  if (maxLength != null && text.length > maxLength) {
    return '${text.substring(0, maxLength)}…';
  }
  return text;
}

const _months = {
  'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
  'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
};

const _zones = {
  'gmt': 0, 'ut': 0, 'utc': 0, 'z': 0,
  'est': -5, 'edt': -4, 'cst': -6, 'cdt': -5, 'mst': -7, 'mdt': -6, 'pst': -8, 'pdt': -7,
};

final _rfc822 = RegExp(
  r'(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[A-Za-z]+)?',
);

/// 解析 RFC 822（RSS）或 ISO 8601（Atom）日期，统一返回 UTC。
DateTime? parseDate(String? s) {
  if (s == null || s.isEmpty) return null;
  final iso = DateTime.tryParse(s.trim());
  if (iso != null) return iso.toUtc();

  final m = _rfc822.firstMatch(s);
  if (m == null) return null;
  final month = _months[m.group(2)!.toLowerCase()];
  if (month == null) return null;
  var year = int.parse(m.group(3)!);
  if (year < 100) year += 2000;
  final dt = DateTime.utc(
    year, month, int.parse(m.group(1)!),
    int.parse(m.group(4)!), int.parse(m.group(5)!), int.parse(m.group(6) ?? '0'),
  );
  final zone = m.group(7);
  var offset = Duration.zero;
  if (zone != null) {
    if (zone.startsWith('+') || zone.startsWith('-')) {
      final sign = zone.startsWith('-') ? -1 : 1;
      offset = Duration(
        hours: sign * int.parse(zone.substring(1, 3)),
        minutes: sign * int.parse(zone.substring(3, 5)),
      );
    } else {
      offset = Duration(hours: _zones[zone.toLowerCase()] ?? 0);
    }
  }
  return dt.subtract(offset);
}
