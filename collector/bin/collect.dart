// 用法：dart run bin/collect.dart [--root <仓库根目录>]
// 环境变量 DEEPSEEK_API_KEY：不设置则只抓取不做 AI 摘要。
import 'dart:io';

import 'package:collector/collector.dart';
import 'package:collector/config.dart';
import 'package:collector/store.dart';
import 'package:collector/summarizer.dart';
import 'package:path/path.dart' as p;

Future<void> main(List<String> args) async {
  final rootIdx = args.indexOf('--root');
  final root = rootIdx >= 0 && rootIdx + 1 < args.length ? args[rootIdx + 1] : '..';

  final config = Config.load(p.join(root, 'config.yaml'));
  final store = Store(p.join(root, 'data'))..load();
  final key = Platform.environment['DEEPSEEK_API_KEY']?.trim() ?? '';
  final summarizer = key.isEmpty ? null : Summarizer(config: config, apiKey: key);

  final report = await Collector(config: config, store: store, summarizer: summarizer).run();
  store.save(sourceStatus: report.sourceStatus, schedule: config.schedule.toJson());
  summarizer?.close();

  // 写给 GitHub Actions 的提交信息
  final summaryFile = Platform.environment['GITHUB_STEP_SUMMARY'];
  final line = 'data: +${report.added} 篇，摘要 ${report.summarized} 篇，约 \$${report.costUsd.toStringAsFixed(3)}';
  stdout.writeln(line);
  if (summaryFile != null) {
    File(summaryFile).writeAsStringSync(
      '$line\n\n${report.aiStopReason ?? ''}\n',
      mode: FileMode.append,
    );
  }
}
