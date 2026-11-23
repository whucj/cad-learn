import 'dart:io';

import 'package:collector/config.dart';
import 'package:collector/schedule.dart';
import 'package:test/test.dart';
import 'package:yaml/yaml.dart';

// 2026-11-22 是周日，2026-11-23 是周一
DateTime utc(int day, int hour, [int minute = 30]) => DateTime.utc(2026, 11, day, hour, minute);

Decision run(ScheduleConfig cfg, {String event = 'schedule', String? cron, required DateTime now, DateTime? lastRun}) =>
    decide(cfg: cfg, event: event, cron: cron, now: now, lastRun: lastRun);

void main() {
  const x4 = ScheduleConfig();
  const daily = ScheduleConfig(every: Every.daily, hourUtc: 23);
  const weekly = ScheduleConfig(every: Every.weekly, hourUtc: 23, weekday: DateTime.sunday);
  const manual = ScheduleConfig(every: Every.manual);

  test('non-schedule events always run; manual mode skips cron', () {
    expect(run(manual, event: 'workflow_dispatch', now: utc(23, 10)).run, isTrue);
    expect(run(daily, event: 'push', now: utc(23, 10), lastRun: utc(23, 9)).run, isTrue);
    expect(run(manual, cron: '30 23 * * *', now: utc(23, 23), lastRun: utc(1, 0)).run, isFalse);
  });

  test('first run always runs', () {
    expect(run(weekly, cron: '30 4 * * *', now: utc(23, 4)).run, isTrue);
  });

  test('4x-daily runs every slot but skips duplicate triggers', () {
    expect(run(x4, cron: '30 4 * * *', now: utc(23, 4, 35), lastRun: utc(22, 23, 40)).run, isTrue);
    // 上一次被延迟到 00:50 才结束，下一个 04:30 时段仍应运行
    expect(run(x4, cron: '30 4 * * *', now: utc(23, 4, 31), lastRun: utc(23, 0, 50)).run, isTrue);
    expect(run(x4, cron: '30 4 * * *', now: utc(23, 4, 40), lastRun: utc(23, 4, 35)).run, isFalse);
  });

  test('daily runs only in its slot, even when GitHub delays the trigger past midnight', () {
    expect(run(daily, cron: '30 12 * * *', now: utc(23, 12), lastRun: utc(22, 23, 40)).run, isFalse);
    expect(run(daily, cron: '30 23 * * *', now: utc(23, 23, 35), lastRun: utc(22, 23, 40)).run, isTrue);
    // 23:30 的触发延迟到次日 00:20
    expect(run(daily, cron: '30 23 * * *', now: utc(24, 0, 20), lastRun: utc(22, 23, 40)).run, isTrue);
  });

  test('daily catches up after a missed trigger', () {
    // 上次是 21 日 23:40，22 日 23:30 的触发丢失；23 日 12:30 补跑
    final d = run(daily, cron: '30 12 * * *', now: utc(23, 12), lastRun: utc(21, 23, 40));
    expect(d.run, isTrue);
    expect(d.reason, contains('补跑'));
  });

  test('weekly runs on its weekday only, using the scheduled date for delayed triggers', () {
    final last = utc(15, 23, 40); // 上周日
    expect(run(weekly, cron: '30 23 * * *', now: utc(22, 23, 35), lastRun: last).run, isTrue); // 周日
    expect(run(weekly, cron: '30 23 * * *', now: utc(21, 23, 35), lastRun: utc(14, 23, 40)).run, isFalse); // 周六
    expect(run(weekly, cron: '30 23 * * *', now: utc(23, 0, 15), lastRun: last).run, isTrue); // 周日的触发延迟到周一凌晨
    expect(run(weekly, cron: '30 12 * * *', now: utc(22, 12), lastRun: last).run, isFalse); // 周日但不是该时段
  });

  test('2x-daily uses the chosen slot and the opposite one', () {
    const cfg = ScheduleConfig(every: Every.x2, hourUtc: 23);
    expect(cfg.slots, [12, 23]);
    expect(run(cfg, cron: '30 12 * * *', now: utc(23, 12), lastRun: utc(22, 23, 40)).run, isTrue);
    expect(run(cfg, cron: '30 4 * * *', now: utc(23, 4), lastRun: utc(22, 23, 40)).run, isFalse);
  });

  test('unknown cron runs conservatively', () {
    expect(run(daily, cron: '0 7 * * *', now: utc(23, 7), lastRun: utc(23, 1)).run, isTrue);
  });

  group('config', () {
    test('parses schedule and scales default max_per_run', () {
      final c = Config.parse('schedule: { every: weekly, hour_utc: 4, weekday: Monday }\nsources: []');
      expect(c.schedule.every, Every.weekly);
      expect(c.schedule.hourUtc, 4);
      expect(c.schedule.weekday, DateTime.monday);
      expect(c.ai.maxPerRun, 300);
      expect(c.schedule.toJson(), {'every': 'weekly', 'label': '每周 1 次（周一）', 'slotsUtc': [4], 'weekday': 1});
    });

    test('explicit max_per_run wins; missing schedule means 4x-daily', () {
      final c = Config.parse('ai: { max_per_run: 7 }\nsources: []');
      expect(c.schedule.every, Every.x4);
      expect(c.ai.maxPerRun, 7);
    });

    test('rejects invalid values', () {
      expect(() => Config.parse('schedule: { every: hourly }\nsources: []'), throwsFormatException);
      expect(() => Config.parse('schedule: { every: daily, hour_utc: 8 }\nsources: []'), throwsFormatException);
      expect(() => Config.parse('schedule: { every: weekly, weekday: xyz }\nsources: []'), throwsFormatException);
    });

    test('repo config.yaml schedule is valid', () {
      expect(Config.load('../config.yaml').schedule.every, isNotNull);
    });

    test('workflow cron slots match slotHours', () {
      final yml = loadYaml(File('../.github/workflows/collect.yml').readAsStringSync()) as Map;
      final crons = [for (final c in (yml['on'] as Map)['schedule'] as List) (c as Map)['cron'] as String];
      expect(crons.map((c) => int.parse(c.split(' ')[1])).toList(), slotHours);
      expect(crons.every((c) => c.startsWith('30 ')), isTrue);
    });
  });
}
