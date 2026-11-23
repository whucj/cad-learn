import { beforeAll, describe, expect, it } from 'vitest';
import { formatNext, localSlots, nextRun } from './schedule';
import type { ScheduleInfo } from './types';

beforeAll(() => {
  process.env.TZ = 'Asia/Shanghai'; // UTC+8，固定时区便于断言
});

const at = (iso: string) => new Date(iso);
const daily: ScheduleInfo = { every: 'daily', label: '每天 1 次', slotsUtc: [23] };
const weekly: ScheduleInfo = { every: 'weekly', label: '每周 1 次（周日）', slotsUtc: [23], weekday: 7 };
const x4: ScheduleInfo = { every: '4x-daily', label: '每天 4 次', slotsUtc: [4, 12, 18, 23] };

describe('nextRun', () => {
  it('daily: later today or tomorrow', () => {
    expect(nextRun(daily, at('2026-11-23T10:00:00Z'))?.toISOString()).toBe('2026-11-23T23:30:00.000Z');
    expect(nextRun(daily, at('2026-11-23T23:45:00Z'))?.toISOString()).toBe('2026-11-24T23:30:00.000Z');
  });

  it('weekly: next matching UTC weekday', () => {
    // 2026-11-23 是周一 → 下一个周日 11-29
    expect(nextRun(weekly, at('2026-11-23T10:00:00Z'))?.toISOString()).toBe('2026-11-29T23:30:00.000Z');
    // 周日 23:00 → 当天 23:30
    expect(nextRun(weekly, at('2026-11-22T23:00:00Z'))?.toISOString()).toBe('2026-11-22T23:30:00.000Z');
  });

  it('4x-daily: nearest slot', () => {
    expect(nextRun(x4, at('2026-11-23T05:00:00Z'))?.toISOString()).toBe('2026-11-23T12:30:00.000Z');
  });

  it('manual: none', () => {
    expect(nextRun({ every: 'manual', label: '仅手动', slotsUtc: [] })).toBeNull();
  });
});

describe('display', () => {
  it('converts slots to local time, sorted', () => {
    expect(localSlots({ every: '2x-daily', label: '', slotsUtc: [12, 23] })).toBe('07:30、20:30');
  });

  it('formats relative day', () => {
    expect(formatNext(at('2026-11-23T23:30:00Z'), at('2026-11-23T10:00:00Z'))).toBe('明天 07:30 左右');
    expect(formatNext(at('2026-11-23T12:30:00Z'), at('2026-11-23T05:00:00Z'))).toBe('今天 20:30 左右');
  });
});
