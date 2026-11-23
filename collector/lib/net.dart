import 'dart:convert';

import 'package:http/http.dart' as http;

class NetException implements Exception {
  NetException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// 统一的 GET：带 UA、超时，按 UTF-8 解码。
/// 遇到 429/503（限流，arXiv 常见）按 Retry-After 或递增间隔重试最多 2 次。
Future<String> fetchText(
  String url, {
  Duration timeout = const Duration(seconds: 25),
  Duration retryBase = const Duration(seconds: 10),
}) async {
  for (var attempt = 0;; attempt++) {
    final http.Response resp;
    try {
      resp = await http.get(Uri.parse(url), headers: const {
        'User-Agent': 'Mozilla/5.0 (compatible; CadLearn/0.1; personal feed reader)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/html;q=0.9, */*;q=0.8',
      }).timeout(timeout);
    } catch (e) {
      // 超时/连接失败重试一次（arXiv 偶尔响应很慢）
      if (attempt < 1) {
        await Future<void>.delayed(retryBase);
        continue;
      }
      throw NetException('网络错误：$e');
    }
    if ((resp.statusCode == 429 || resp.statusCode == 503) && attempt < 2) {
      final retryAfter = int.tryParse(resp.headers['retry-after'] ?? '');
      final wait = retryAfter != null && retryAfter <= 60 ? Duration(seconds: retryAfter) : retryBase * (attempt + 1);
      await Future<void>.delayed(wait);
      continue;
    }
    if (resp.statusCode != 200) {
      throw NetException('HTTP ${resp.statusCode}');
    }
    return utf8.decode(resp.bodyBytes, allowMalformed: true);
  }
}
