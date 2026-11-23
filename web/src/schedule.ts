import type { ScheduleInfo } from './types';

/**
 * 根据采集器写入 status.json 的更新周期，估算下一次更新时间（GitHub 定时触发常有几十分钟延迟）。
 * 运行时刻为各 UTC 时段的 xx:30；weekly 还要求 UTC 日期是指定星期（1=周一 … 7=周日）。
 */
export function nextRun(s: ScheduleInfo, now: Date = new Date()): Date | null {
  if (s.every === 'manual' || s.slotsUtc.length === 0) return null;
  let best: Date | null = null;
  for (let d = 0; d <= 8; d++) {
    for (const h of s.slotsUtc) {
      const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, h, 30));
      if (t <= now) continue;
      if (s.every === 'weekly' && isoWeekday(t) !== s.weekday) continue;
      if (!best || t < best) best = t;
    }
  }
  return best;
}

/** 运行时段换算成本地时间，如 "07:30、19:30" */
export function localSlots(s: ScheduleInfo): string {
  return [...s.slotsUtc]
    .map((h) => new Date(Date.UTC(2026, 0, 1, h, 30)))
    .sort((a, b) => minutesOfDay(a) - minutesOfDay(b))
    .map((d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`)
    .join('、');
}

export function formatNext(t: Date, now: Date = new Date()): string {
  const day = Math.round((startOfDay(t) - startOfDay(now)) / 86_400_000);
  const dayLabel = day === 0 ? '今天' : day === 1 ? '明天' : day === 2 ? '后天' : `${t.getMonth() + 1}月${t.getDate()}日`;
  return `${dayLabel} ${pad(t.getHours())}:${pad(t.getMinutes())} 左右`;
}

function isoWeekday(t: Date): number {
  return t.getUTCDay() === 0 ? 7 : t.getUTCDay();
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
