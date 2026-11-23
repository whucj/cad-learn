// GitHub Actions 每次触发先运行本脚本，按 config.yaml 的 schedule 判断是否真正采集。
// 用法：dart run bin/should_run.dart [--root <仓库根目录>]
// 环境变量：EVENT_NAME（github.event_name）、SCHEDULE（github.event.schedule，即触发的 cron）
import 'dart:convert';
import 'dart:io';

import 'package:collector/config.dart';
import 'package:collector/schedule.dart';
import 'package:path/path.dart' as p;

void main(List<String> args) {
  final rootIdx = args.indexOf('--root');
  final root = rootIdx >= 0 && rootIdx + 1 < args.length ? args[rootIdx + 1] : '..';
  final env = Platform.environment;

  final config = Config.load(p.join(root, 'config.yaml'));
  DateTime? lastRun;
  final status = File(p.join(root, 'data', 'status.json'));
  if (status.existsSync()) {
    final j = jsonDecode(status.readAsStringSync()) as Map;
    lastRun = DateTime.tryParse('${j['generatedAt']}');
  }

  final d = decide(
    cfg: config.schedule,
    event: env['EVENT_NAME'] ?? 'workflow_dispatch',
    cron: env['SCHEDULE'],
    now: DateTime.now().toUtc(),
    lastRun: lastRun,
  );

  stdout.writeln('${d.run ? '运行' : '跳过'}：${d.reason}');
  final out = env['GITHUB_OUTPUT'];
  if (out != null) File(out).writeAsStringSync('run=${d.run}\n', mode: FileMode.append);
  final summary = env['GITHUB_STEP_SUMMARY'];
  if (summary != null) {
    File(summary).writeAsStringSync('${d.run ? '▶ 运行' : '⏭ 跳过'}：${d.reason}\n\n', mode: FileMode.append);
  }
}
