import 'package:html/dom.dart';
import 'package:html/parser.dart' as html_parser;

import 'feed_parser.dart';
import 'net.dart';

/// 简化版 Readability：从完整网页中取出正文纯文本（只用于喂给 AI，不对外发布）。
String? extractMainText(String pageHtml) {
  final doc = html_parser.parse(pageHtml);
  const junk = [
    'script', 'style', 'noscript', 'iframe', 'form', 'nav', 'header', 'footer',
    'aside', 'svg', 'button', '[role=navigation]', '[aria-hidden=true]',
    '.sidebar', '.comments', '#comments', '.share', '.related', '.advertisement',
  ];
  for (final sel in junk) {
    for (final e in doc.querySelectorAll(sel)) {
      e.remove();
    }
  }
  final main = doc.querySelector('article') ??
      doc.querySelector('[role=main]') ??
      doc.querySelector('main') ??
      _densestBlock(doc);
  if (main == null) return null;
  final text = _blockText(main);
  return text.length < 200 ? null : text;
}

Element? _densestBlock(Document doc) {
  Element? best;
  var bestScore = 0;
  for (final e in doc.querySelectorAll('div, section, td')) {
    var score = 0;
    for (final p in e.children.where((c) => c.localName == 'p' || c.localName == 'pre')) {
      score += p.text.trim().length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/// 保留段落换行的纯文本
String _blockText(Element root) {
  final buf = StringBuffer();
  for (final e in root.querySelectorAll('h1, h2, h3, h4, p, li, pre, blockquote')) {
    // 跳过嵌套（如 li 里的 p），避免重复
    if (e.parent != null && _hasBlockAncestor(e, root)) continue;
    final t = e.text.replaceAll(RegExp(r'[ \t]+'), ' ').trim();
    if (t.isNotEmpty) buf.writeln(t);
  }
  final text = buf.toString().trim();
  return text.isNotEmpty ? text : root.text.replaceAll(RegExp(r'\s+'), ' ').trim();
}

bool _hasBlockAncestor(Element e, Element root) {
  const blocks = {'p', 'li', 'pre', 'blockquote'};
  var p = e.parent;
  while (p != null && p != root) {
    if (blocks.contains(p.localName)) return true;
    p = p.parent;
  }
  return false;
}

/// 为 AI 准备正文：feed 自带的足够长就直接用；arXiv 用摘要；否则抓原网页。
Future<String> textForAi({
  required String url,
  required String? feedHtml,
  required int maxChars,
  Future<String> Function(String url)? fetch,
}) async {
  final feedText = htmlToPlain(feedHtml ?? '');
  String text;
  if (feedText.length >= 800 || url.contains('arxiv.org/abs/')) {
    text = feedText;
  } else {
    try {
      text = extractMainText(await (fetch ?? fetchText)(url)) ?? feedText;
    } catch (_) {
      text = feedText;
    }
  }
  return text.length > maxChars ? text.substring(0, maxChars) : text;
}
