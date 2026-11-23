/// 更新周期。GitHub Actions 每天固定在 4 个时段触发（UTC 04:30 / 12:30 / 18:30 / 23:30，
/// 都避开 DeepSeek 高峰），每次触发先用这里的规则判断“这次该不该真正运行”。
library;

/// 可用的运行时段（UTC 小时）。必须与 .github/workflows/collect.yml 中的 cron 一致。
const slotHours = [4, 12, 18, 23];

enum Every {
  x4('4x-daily', '每天 4 次', Duration(hours: 6)),
  x2('2x-daily', '每天 2 次', Duration(hours: 12)),
  daily('daily', '每天 1 次', Duration(days: 1)),
  weekly('weekly', '每周 1 次', Duration(days: 7)),
  manual('manual', '仅手动', Duration.zero);

  const Every(this.key, this.label, this.interval);
  final String key;
  final String label;
  final Duration interval;

  static Every parse(String s) => Every.values.firstWhere(
        (e) => e.key == s,
        orElse: () => throw FormatException('schedule.every 只能是 ${Every.values.map((e) => e.key).join(' / ')}，而不是 "$s"'),
      );
}

const _weekdays = {'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6, 'sun': 7};
const _weekdayLabel = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

class ScheduleConfig {
  const ScheduleConfig({this.every = Every.x4, this.hourUtc = 23, this.weekday = DateTime.sunday});

  final Every every;

  /// daily / weekly / 2x-daily 的主时段（UTC 小时，必须是 [slotHours] 之一）
  final int hourUtc;

  /// weekly 的星期（1=周一 … 7=周日），按 UTC 日期
  final int weekday;

  /// 2x-daily 使用的两个时段：主时段 + 相隔约半天的另一个
  List<int> get slots => switch (every) {
        Every.x4 => slotHours,
        Every.x2 => ([hourUtc, _opposite[hourUtc]!]..sort()),
        Every.daily || Every.weekly => [hourUtc],
        Every.manual => const [],
      };

  static const _opposite = {4: 18, 18: 4, 12: 23, 23: 12};

  String get description => switch (every) {
        Every.weekly => '${every.label}（${_weekdayLabel[weekday]}）',
        _ => every.label,
      };

  /// 没有写 ai.max_per_run 时，每次运行的 AI 摘要上限随周期放大，避免积压
  int get defaultMaxPerRun => switch (every) {
        Every.x4 => 40,
        Every.x2 => 60,
        Every.daily => 100,
        Every.weekly => 300,
        Every.manual => 100,
      };

  static ScheduleConfig parse(Map? m) {
    if (m == null) return const ScheduleConfig();
    final every = Every.parse((m['every'] ?? '4x-daily').toString());
    final hour = (m['hour_utc'] as num?)?.toInt() ?? 23;
    if (!slotHours.contains(hour)) {
      throw FormatException('schedule.hour_utc 只能是 ${slotHours.join(' / ')}（UTC，避开 DeepSeek 高峰），而不是 $hour');
    }
    final wdText = (m['weekday'] ?? 'sun').toString().toLowerCase();
    final wd = _weekdays[wdText.length > 3 ? wdText.substring(0, 3) : wdText];
    if (wd == null) throw FormatException('schedule.weekday 应为 mon … sun，而不是 "$wdText"');
    return ScheduleConfig(every: every, hourUtc: hour, weekday: wd);
  }

  Map<String, Object?> toJson() => {
        'every': every.key,
        'label': description,
        'slotsUtc': slots,
        if (every == Every.weekly) 'weekday': weekday,
      };
}

class Decision {
  const Decision(this.run, this.reason);
  final bool run;
  final String reason;
}

/// 判断本次触发是否运行。
/// [event]：GitHub 事件名；[cron]：触发的 cron 表达式（schedule 事件才有）；
/// [lastRun]：上次成功采集时间（data/status.json），用于错过时补跑。
Decision decide({
  required ScheduleConfig cfg,
  required String event,
  required String? cron,
  required DateTime now,
  required DateTime? lastRun,
}) {
  if (event != 'schedule') return Decision(true, '手动/代码变更触发（$event），直接运行');
  if (cfg.every == Every.manual) return const Decision(false, '更新周期为“仅手动”，跳过定时触发');
  if (lastRun == null) return const Decision(true, '首次运行');

  final slot = _slotOf(cron);
  if (slot == null) return Decision(true, '无法识别触发时段（$cron），保守起见运行');

  // 错过太久（GitHub 偶尔会丢失定时触发）：任何时段都补跑
  final overdue = now.difference(lastRun) - cfg.every.interval;
  if (overdue > const Duration(hours: 6)) {
    return Decision(true, '距上次更新已超过 ${cfg.description} 周期，补跑');
  }

  if (!cfg.slots.contains(slot)) return Decision(false, '${cfg.description}：UTC $slot:30 不是运行时段');

  if (cfg.every == Every.weekly) {
    // 触发可能被延迟到第二天凌晨，按“计划触发时刻”所在日期判断星期
    final u = now.toUtc();
    final scheduledDay = u.hour < slot ? u.subtract(const Duration(days: 1)) : u;
    if (scheduledDay.weekday != cfg.weekday) return Decision(false, '${cfg.description}：今天不是更新日');
  }

  // 同一时段被重复触发（或刚手动跑过）：不到半个周期就跳过。
  // 容差放宽到半个周期，是因为 GitHub 的定时触发经常延迟几十分钟，上次结束时间不可靠。
  if (now.difference(lastRun) < cfg.every.interval ~/ 2) {
    return const Decision(false, '距上次更新时间太短，跳过');
  }
  return Decision(true, '${cfg.description}：到达更新时段 UTC $slot:30');
}

int? _slotOf(String? cron) {
  if (cron == null) return null;
  final parts = cron.trim().split(RegExp(r'\s+'));
  if (parts.length < 2) return null;
  final h = int.tryParse(parts[1]);
  return h != null && slotHours.contains(h) ? h : null;
}
