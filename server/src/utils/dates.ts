/**
 * Food dates are calendar dates, not instants. They are stored as UTC midnight
 * of the calendar day and compared as whole days, so time zones and DST never
 * shift an item's expected expiry by a day.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDateKey(value: string): Date | null {
  const match = DATE_KEY.exec(value);
  if (!match) return null;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  // Reject rollovers such as 2026-02-30.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date;
}

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Whole days from `from` to `to` (both calendar dates). */
export function diffDays(to: Date, from: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The user's current calendar date in their time zone, as UTC midnight. */
export function todayIn(timeZone: string, now: Date): Date {
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parseDateKey(key)!;
}
