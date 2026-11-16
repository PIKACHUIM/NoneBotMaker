import { describe, expect, it } from 'vitest';
import { buildCron, cronMatches, describeCron, nextCronOccurrence, parseCron, parseCronBuilder } from './schedules';

describe('cron parsing', () => {
  it('parses standard fields, ranges, lists and steps', () => {
    const cron = parseCron('*/15 9-17 * JAN,MAR 1-5')!;
    expect(cron.minutes).toEqual(new Set([0, 15, 30, 45]));
    expect(cron.hours).toEqual(new Set([9, 10, 11, 12, 13, 14, 15, 16, 17]));
    expect(cron.months).toEqual(new Set([1, 3]));
    expect(cron.daysOfWeek).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it('supports aliases and maps Sunday 7 to 0', () => {
    expect(parseCron('@daily')?.source).toBe('0 0 * * *');
    expect(parseCron('0 0 * * 7')?.daysOfWeek).toEqual(new Set([0]));
    expect(parseCron('0 0 * * SUN')?.daysOfWeek).toEqual(new Set([0]));
  });

  it('rejects unsupported or out-of-range expressions', () => {
    expect(parseCron('* * *')).toBeNull();
    expect(parseCron('60 * * * *')).toBeNull();
    expect(parseCron('* 24 * * *')).toBeNull();
    expect(parseCron('*/0 * * * *')).toBeNull();
    expect(parseCron('* * * * 8')).toBeNull();
    expect(parseCron('* * * * * *')).toBeNull();
  });
});

describe('cron occurrence calculation', () => {
  it('matches a UTC daily schedule', () => {
    const cron = parseCron('0 9 * * *')!;
    expect(cronMatches(cron, new Date('2026-11-16T09:00:00Z'), 'UTC')).toBe(true);
    expect(cronMatches(cron, new Date('2026-11-16T09:01:00Z'), 'UTC')).toBe(false);
  });

  it('evaluates the expression in the configured timezone', () => {
    const next = nextCronOccurrence('0 9 * * *', Date.parse('2026-11-16T00:00:00Z'), 'Asia/Shanghai');
    expect(new Date(next!).toISOString()).toBe('2026-11-16T01:00:00.000Z');
  });

  it('finds weekly occurrences', () => {
    const next = nextCronOccurrence('30 8 * * 1', Date.parse('2026-11-16T00:00:00Z'), 'UTC');
    expect(new Date(next!).toISOString()).toBe('2026-11-16T08:30:00.000Z');
  });

  it('returns null for impossible dates', () => {
    expect(nextCronOccurrence('0 0 30 2 *', Date.parse('2026-11-16T00:00:00Z'), 'UTC')).toBeNull();
  });
});

describe('friendly cron builder', () => {
  it('builds common schedules', () => {
    expect(buildCron('interval-minutes', { interval: 15 })).toBe('*/15 * * * *');
    expect(buildCron('interval-hours', { interval: 4 })).toBe('0 */4 * * *');
    expect(buildCron('daily', { hour: 9, minute: 5 })).toBe('5 9 * * *');
    expect(buildCron('weekly', { hour: 18, minute: 30, weekday: 5 })).toBe('30 18 * * 5');
    expect(buildCron('monthly', { hour: 8, minute: 0, day: 1 })).toBe('0 8 1 * *');
  });

  it('clamps invalid builder values instead of producing invalid cron', () => {
    expect(buildCron('interval-minutes', { interval: 0 })).toBe('*/1 * * * *');
    expect(buildCron('interval-minutes', { interval: 99 })).toBe('*/59 * * * *');
    expect(buildCron('daily', { hour: 25, minute: -1 })).toBe('0 23 * * *');
  });

  it('recognizes generated expressions and describes them', () => {
    expect(parseCronBuilder('*/10 * * * *')?.mode).toBe('interval-minutes');
    expect(parseCronBuilder('0 9 * * *')?.options).toMatchObject({ hour: 9, minute: 0 });
    expect(parseCronBuilder('30 18 * * 7')?.options.weekday).toBe(0);
    expect(parseCronBuilder('0 9 1 * *')?.mode).toBe('monthly');
    expect(parseCronBuilder('5 4 * * 1,3')).toBeNull();
    expect(describeCron('*/10 * * * *')).toBe('每 10 分钟');
    expect(describeCron('0 9 * * *')).toBe('每天 09:00');
    expect(describeCron('30 18 * * 1')).toBe('每周一 18:30');
    expect(describeCron('0 8 1 * *')).toBe('每月 1 日 08:00');
    expect(describeCron('5 4 * * 1,3')).toBe('5 4 * * 1,3');
  });
});
