import { describe, expect, it } from 'vitest';
import { cronMatches, nextCronOccurrence, parseCron } from './schedules';

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
