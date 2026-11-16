/**
 * Minimal five-field cron support shared by the scheduler API and the console.
 * The parser intentionally rejects anything it cannot evaluate, so a saved
 * schedule never silently stops running because of an unsupported extension.
 */

export interface CronFields {
  source: string;
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  daysOfMonthAll: boolean;
  daysOfWeekAll: boolean;
}

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const ALIASES: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

function namedValue(token: string, names: string[]): number | undefined {
  const index = names.indexOf(token.toUpperCase());
  if (index < 0) return undefined;
  // Month names are 1-based in cron; weekday names are 0-based.
  return names === MONTH_NAMES ? index + 1 : index;
}

function parseNumber(token: string, names?: string[]): number | undefined {
  if (/^\d{1,4}$/.test(token)) return Number(token);
  return names ? namedValue(token, names) : undefined;
}

function parseField(spec: string, min: number, max: number, names?: string[]): { values: Set<number>; all: boolean } | null {
  const values = new Set<number>();
  let all = false;
  for (const part of spec.split(',')) {
    if (!part) return null;
    const [rangePart, stepPart, extra] = part.split('/');
    if (extra !== undefined) return null;
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d{1,3}$/.test(stepPart)) return null;
      step = Number(stepPart);
      if (step < 1) return null;
    }
    let start: number;
    let end: number;
    if (rangePart === '*') {
      start = min;
      end = max;
      if (step === 1) all = true;
    } else {
      const [startPart, endPart, rangeExtra] = rangePart.split('-');
      if (rangeExtra !== undefined) return null;
      const parsedStart = parseNumber(startPart, names);
      if (parsedStart === undefined) return null;
      start = parsedStart;
      if (endPart === undefined) {
        end = stepPart === undefined ? parsedStart : max;
      } else {
        const parsedEnd = parseNumber(endPart, names);
        if (parsedEnd === undefined) return null;
        end = parsedEnd;
      }
    }
    if (start < min || start > max || end < min || end > max || start > end) return null;
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values.size ? { values, all } : null;
}

export function parseCron(expression: string): CronFields | null {
  const trimmed = expression.trim();
  const normalized = ALIASES[trimmed.toLowerCase()] ?? trimmed;
  const fields = normalized.split(/\s+/);
  if (fields.length !== 5) return null;
  const minute = parseField(fields[0], 0, 59);
  const hour = parseField(fields[1], 0, 23);
  const dayOfMonth = parseField(fields[2], 1, 31);
  const month = parseField(fields[3], 1, 12, MONTH_NAMES);
  const dayOfWeekRaw = parseField(fields[4], 0, 7, DAY_NAMES);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeekRaw) return null;
  const daysOfWeek = new Set([...dayOfWeekRaw.values].map((value) => value === 7 ? 0 : value));
  return {
    source: normalized,
    minutes: minute.values,
    hours: hour.values,
    daysOfMonth: dayOfMonth.values,
    months: month.values,
    daysOfWeek,
    daysOfMonthAll: dayOfMonth.all,
    daysOfWeekAll: dayOfWeekRaw.all,
  };
}

export function cronMatches(cron: CronFields, at: Date, timeZone: string): boolean {
  const parts = localDateParts(at.getTime(), timeZone);
  if (!parts) return false;
  if (!cron.minutes.has(parts.minute) || !cron.hours.has(parts.hour) || !cron.months.has(parts.month)) return false;
  const dayOfWeek = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const dom = cron.daysOfMonth.has(parts.day);
  const dow = cron.daysOfWeek.has(dayOfWeek);
  if (cron.daysOfMonthAll && cron.daysOfWeekAll) return true;
  if (cron.daysOfMonthAll) return dow;
  if (cron.daysOfWeekAll) return dom;
  return dom || dow;
}

interface LocalParts { year: number; month: number; day: number; hour: number; minute: number }

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function localDateParts(at: number, timeZone: string): LocalParts | null {
  if (!Number.isFinite(at)) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(at));
    const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
    const result = { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute') };
    return Object.values(result).every(Number.isFinite) ? result : null;
  } catch {
    return null;
  }
}

function offsetAt(at: number, timeZone: string): number {
  const parts = localDateParts(at, timeZone);
  if (!parts) return 0;
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(at / 60_000) * 60_000;
}

function localToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = target - offsetAt(guess, timeZone);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

/**
 * Returns the first matching minute strictly after `fromMs`, or null when the
 * expression has no occurrence within `maxDays`.
 */
export function nextCronOccurrence(expression: string | CronFields, fromMs: number, timeZone: string, maxDays = 366): number | null {
  const cron = typeof expression === 'string' ? parseCron(expression) : expression;
  if (!cron || !Number.isFinite(fromMs) || !isValidTimeZone(timeZone)) return null;
  const start = Math.floor(fromMs / 60_000) * 60_000 + 60_000;
  const hours = [...cron.hours].sort((a, b) => a - b);
  const minutes = [...cron.minutes].sort((a, b) => a - b);
  for (let dayOffset = 0; dayOffset <= maxDays; dayOffset += 1) {
    const probe = localDateParts(start + dayOffset * 86_400_000, timeZone);
    if (!probe) return null;
    if (!cron.months.has(probe.month)) continue;
    const dayOfWeek = new Date(Date.UTC(probe.year, probe.month - 1, probe.day)).getUTCDay();
    const dom = cron.daysOfMonth.has(probe.day);
    const dow = cron.daysOfWeek.has(dayOfWeek);
    const dayMatches = cron.daysOfMonthAll && cron.daysOfWeekAll ? true
      : cron.daysOfMonthAll ? dow
        : cron.daysOfWeekAll ? dom
          : dom || dow;
    if (!dayMatches) continue;
    for (const hour of hours) {
      for (const minute of minutes) {
        const candidate = localToUtc(probe.year, probe.month, probe.day, hour, minute, timeZone);
        if (candidate < start) continue;
        const check = localDateParts(candidate, timeZone);
        if (check && check.year === probe.year && check.month === probe.month && check.day === probe.day &&
            check.hour === hour && check.minute === minute) return candidate;
      }
    }
  }
  return null;
}

export function nextCronOccurrenceIso(expression: string, fromMs: number, timeZone: string): string | null {
  const next = nextCronOccurrence(expression, fromMs, timeZone);
  return next === null ? null : new Date(next).toISOString();
}
