/**
 * Calendar-date utilities shared by client and server.
 *
 * Every food date is a "YYYY-MM-DD" string, never a timestamp. All arithmetic
 * converts a date to UTC midnight first, so daylight-saving changes and the
 * host machine's time zone can never shift a day.
 */

/** A calendar date in "YYYY-MM-DD" form. */
export type DateString = string;

const DAY_MS = 86_400_000;
const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** UTC-midnight milliseconds for a date string, or NaN if it isn't a real date. */
function toUtcMidnight(date: string): number {
  const match = PATTERN.exec(date);
  if (!match) return NaN;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(y, m - 1, d);
  const check = new Date(ms);
  // Reject rollovers such as 2026-02-30 → 2026-03-02.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return NaN;
  return ms;
}

function mustParse(date: string): number {
  const ms = toUtcMidnight(date);
  if (Number.isNaN(ms)) throw new RangeError(`Not a valid "YYYY-MM-DD" date: ${date}`);
  return ms;
}

function fromUtcMidnight(ms: number): DateString {
  return new Date(ms).toISOString().slice(0, 10);
}

/** True if the value is a real calendar date written as "YYYY-MM-DD". */
export function isValidDate(value: unknown): value is DateString {
  return typeof value === 'string' && !Number.isNaN(toUtcMidnight(value));
}

/** Today's calendar date in an IANA time zone (e.g. "Asia/Kolkata"). */
export function todayInTz(timeZone: string, now: Date = new Date()): DateString {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The hour (0–23) it is now in the given IANA time zone. */
export function hourInTz(timeZone: string, now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(now)
    .find((p) => p.type === 'hour')!.value;
  return Number(hour);
}

/** The date `days` days after `date` (negative goes back). */
export function addDays(date: DateString, days: number): DateString {
  return fromUtcMidnight(mustParse(date) + days * DAY_MS);
}

/** Whole days from `from` to `to`: positive when `to` is later. */
export function diffDays(from: DateString, to: DateString): number {
  return Math.round((mustParse(to) - mustParse(from)) / DAY_MS);
}

/** A friendly label such as "Thu, 1 Oct". Locale-independent on purpose. */
export function formatDisplay(date: DateString): string {
  const d = new Date(mustParse(date));
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
