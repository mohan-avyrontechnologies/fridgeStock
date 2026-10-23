import { addDays, diffDays, isValidDate, type DateString } from './dates.js';
import type { ExpirySource, FoodCategory, PrintedDateType, StorageLocation } from './enums.js';
import { CATEGORY_DEFAULTS, categoryFromText, findReference, type ReferenceFood } from './foodReference.js';
import type { LearnedLifespan } from './api.js';
import { estimateCopy } from './estimateCopy.js';

/**
 * Automatic expected-expiry estimation. Nobody types a lifespan: the date comes from the pack, the
 * household's own history, or the catalog. The AI may only identify a product and read a date printed on
 * the pack (see parsePrintedDate); it never supplies a number of days. Every figure here comes from the
 * catalog (foodReference.ts), the category defaults, the household's usage history or FALLBACK_LIFESPAN_DAYS.
 *
 * It estimates an *expected expiry* for planning. It says nothing about whether food is fit to eat.
 */

/** The lifespan used when nothing else is known. Short on purpose, and always shown as "Rough estimate". */
export const FALLBACK_LIFESPAN_DAYS = 3;

/** A printed date more than this many days in the future is treated as a misread. */
export const PRINTED_DATE_MAX_AHEAD_DAYS = 730;
/** A printed date more than this many days in the past is treated as stale or a misread. */
export const PRINTED_DATE_MAX_PAST_DAYS = 30;

/** The longest lifespan an item can have, in days. */
export const MAX_LIFESPAN_DAYS = 365;

/** Where each source is shown to people: a short label for cards. USER is set by an edit, not estimated. */
export const EXPIRY_SOURCE_LABELS: Record<ExpirySource, string> = {
  PRINTED_DATE: 'Printed date',
  LEARNED: 'Your usual',
  CATALOG: 'Catalog',
  CATEGORY_DEFAULT: 'Category',
  FALLBACK: 'Rough estimate',
  USER: 'You set this',
};

export interface EstimateInput {
  /** The identified product. Used to find its catalog entry and your history for it. */
  product: { name: string };
  /** The catalog entry for the product, or null for none. Left out: looked up by name. */
  catalogMatch?: ReferenceFood | null;
  /** The food's category, from the catalog entry, a photo check's label or the caller. */
  category?: FoodCategory | string | null;
  storage: StorageLocation;
  addedDate: DateString;
  /** A date read from the pack (already turned into a calendar date by parsePrintedDate). */
  printedDate?: DateString | null;
  printedDateType?: PrintedDateType | null;
  /** The household's learned lifespans, as listed by the server. */
  usageHistory?: readonly LearnedLifespan[];
  openedDate?: DateString | null;
  /** Today in the user's time zone; the printed date's range check is made against it. Defaults to the added date. */
  today?: DateString;
}

export interface ExpiryEstimate {
  expiryDate: DateString;
  source: Exclude<ExpirySource, 'USER'>;
  /** One short sentence, in "expected expiry" wording. */
  explanation: string;
}

/** True if a printed date can be used: a real date, at most two years ahead and not more than 30 days past. */
export function isUsablePrintedDate(printedDate: unknown, today: DateString): printedDate is DateString {
  if (!isValidDate(printedDate) || !isValidDate(today)) return false;
  const away = diffDays(today, printedDate);
  return away <= PRINTED_DATE_MAX_AHEAD_DAYS && away >= -PRINTED_DATE_MAX_PAST_DAYS;
}

interface Candidate extends ExpiryEstimate {
  /** Lower number = earlier in the priority order, used to settle a tie. */
  rank: number;
}

/**
 * Works out the expected expiry. The sources, in priority order:
 *   1. PRINTED_DATE: the date read from the pack (ignored if out of range, see isUsablePrintedDate).
 *   2. LEARNED: the household's learned lifespan for this food and location, but only when it is shorter
 *      than the catalog's (or the category default's) figure, or when there is no such figure.
 *   3. CATALOG: the catalog lifespan for the product in this location (and, once opened, its opened lifespan).
 *   4. CATEGORY_DEFAULT: the category's default, for a product the catalog has no figure of its own for.
 *   5. FALLBACK: FALLBACK_LIFESPAN_DAYS, only when none of the above applies.
 * When more than one of sources 1–4 applies, the earliest resulting date wins; a tie goes to the source
 * higher in the list. FALLBACK never competes: it would always win, being short.
 */
export function estimateExpiry(input: EstimateInput): ExpiryEstimate {
  const { product, storage, addedDate, openedDate = null, usageHistory = [] } = input;
  const today = input.today ?? addedDate;
  const catalog = input.catalogMatch === undefined ? findReference(product.name) : input.catalogMatch;
  const category =
    (catalog?.category ??
      (typeof input.category === 'string' ? (categoryFromText(input.category) ?? input.category) : input.category)) ||
    null;
  const candidates: Candidate[] = [];

  // 1. The printed date.
  if (input.printedDate && isUsablePrintedDate(input.printedDate, today)) {
    const type = input.printedDateType ?? 'UNKNOWN';
    candidates.push({
      rank: 1,
      expiryDate: input.printedDate,
      source: 'PRINTED_DATE',
      explanation: estimateCopy.printed(type),
    });
  }

  // The reference figure the learned lifespan is measured against, and the catalog or category candidate.
  const catalogDays = catalog?.lifespanDays[storage] ?? null;
  const categoryKey = category && category in CATEGORY_DEFAULTS ? (category as FoodCategory) : null;
  const categoryDays = categoryKey ? CATEGORY_DEFAULTS[categoryKey][storage] : null;
  const referenceDays = catalogDays ?? categoryDays;

  // 2. What this household usually gets, only when it is shorter than the reference figure.
  const wanted = product.name.trim().toLowerCase();
  const learned = usageHistory.find((l) => l.name.trim().toLowerCase() === wanted && l.storage === storage);
  if (learned && (referenceDays === null || learned.days < referenceDays)) {
    candidates.push({
      rank: 2,
      expiryDate: addDays(addedDate, learned.days),
      source: 'LEARNED',
      explanation: estimateCopy.learned(product.name, learned.days, storage),
    });
  }

  // 3. The catalog, including its shorter lifespan once opened.
  if (catalogDays !== null) {
    let expiryDate = addDays(addedDate, catalogDays);
    let explanation = estimateCopy.catalog(product.name, catalogDays, storage);
    if (openedDate && catalog?.openedDays != null) {
      const afterOpening = addDays(openedDate, catalog.openedDays);
      if (afterOpening < expiryDate) {
        expiryDate = afterOpening;
        explanation = estimateCopy.catalogOpened(product.name, catalog.openedDays);
      }
    }
    candidates.push({ rank: 3, expiryDate, source: 'CATALOG', explanation });
  } else if (categoryDays !== null) {
    // 4. The category default.
    candidates.push({
      rank: 4,
      expiryDate: addDays(addedDate, categoryDays),
      source: 'CATEGORY_DEFAULT',
      explanation: estimateCopy.category(categoryDays, storage),
    });
  }

  if (candidates.length === 0) {
    return {
      expiryDate: addDays(addedDate, FALLBACK_LIFESPAN_DAYS),
      source: 'FALLBACK',
      explanation: estimateCopy.fallback(FALLBACK_LIFESPAN_DAYS),
    };
  }

  // Never beyond the longest lifespan an item can have.
  candidates.sort((a, b) => (a.expiryDate < b.expiryDate ? -1 : a.expiryDate > b.expiryDate ? 1 : a.rank - b.rank));
  const { rank: _rank, ...estimate } = candidates[0]!;
  const longest = addDays(addedDate, MAX_LIFESPAN_DAYS);
  return estimate.expiryDate > longest ? { ...estimate, expiryDate: longest } : estimate;
}

/**
 * Re-estimates an item after it was moved, opened or flagged by Photo Check. The result is never later
 * than the expected expiry the item already has: automatic recalculation can only shorten it.
 * Returns null when nothing changes (the new estimate is the same or later).
 */
export function recalculateExpiry(current: DateString, input: EstimateInput): ExpiryEstimate | null {
  const next = estimateExpiry(input);
  return next.expiryDate < current ? next : null;
}

/** The lifespan in days from the added date to an expected expiry (what the server stores next to it). */
export function lifespanFor(addedDate: DateString, expiryDate: DateString): number {
  return Math.min(Math.max(diffDays(addedDate, expiryDate), 0), MAX_LIFESPAN_DAYS);
}

/** The text a card shows for where its expected expiry came from. */
export function expirySourceLabel(source: ExpirySource): string {
  return EXPIRY_SOURCE_LABELS[source];
}

// ───────────────────────── Reading a printed date ─────────────────────────

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

type DayMonthOrder = 'DMY' | 'MDY';

/** Whether a locale writes the day before the month ("en-GB": DMY) or after it ("en-US": MDY); null when unknown. */
export function dayMonthOrder(locale: string | null | undefined): DayMonthOrder | null {
  if (!locale) return null;
  try {
    const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(
      new Date(Date.UTC(2001, 10, 22)),
    );
    const types = parts.map((p) => p.type);
    const day = types.indexOf('day');
    const month = types.indexOf('month');
    if (day < 0 || month < 0) return null;
    return day < month ? 'DMY' : 'MDY';
  } catch {
    return null;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

function build(year: number, month: number, day: number): DateString | null {
  const text = `${year}-${pad(month)}-${pad(day)}`;
  return isValidDate(text) ? text : null;
}

function fullYear(text: string): number {
  const n = Number(text);
  return text.length <= 2 ? 2000 + n : n;
}

function lastDayOfMonth(year: number, month: number): DateString | null {
  return month >= 1 && month <= 12 ? build(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate()) : null;
}

/**
 * Turns the text of a date read off a pack ("12/11/26", "5 NOV 2026", "2026-11-05", "11/2026") into a
 * calendar date, or null if it can't be read as one.
 *
 * Day/month order for an all-number date follows the locale (en-GB: day first, en-US: month first). A
 * reading that isn't a real date is dropped, so "13/05" is day first in any locale. If the locale gives no
 * order and both readings are real dates, the date is still ambiguous and the earlier one is used. A month
 * and year with no day means the last day of that month.
 */
export function parsePrintedDate(text: string | null | undefined, locale?: string | null): DateString | null {
  const raw = (text ?? '').trim().toLowerCase();
  if (!raw) return null;

  // 2026-11-05 or 2026/11/05 (year first is day-unambiguous: month, then day).
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));

  // 5 nov 2026, 05-NOV-26, nov 5 2026, 5nov26, november 5, 2026
  const named = /^(\d{1,2})[\s./-]*([a-z]{3,9})\.?[\s,./-]*(\d{2}|\d{4})$/.exec(raw);
  if (named) {
    const month = monthNumber(named[2]!);
    return month ? build(fullYear(named[3]!), month, Number(named[1])) : null;
  }
  const namedMonthFirst = /^([a-z]{3,9})\.?[\s./-]*(\d{1,2})(?:st|nd|rd|th)?[\s,./-]+(\d{2}|\d{4})$/.exec(raw);
  if (namedMonthFirst) {
    const month = monthNumber(namedMonthFirst[1]!);
    return month ? build(fullYear(namedMonthFirst[3]!), month, Number(namedMonthFirst[2])) : null;
  }
  // nov 2026 / nov 26: the whole month.
  const namedMonthYear = /^([a-z]{3,9})\.?[\s./-]*(\d{2}|\d{4})$/.exec(raw);
  if (namedMonthYear) {
    const month = monthNumber(namedMonthYear[1]!);
    return month ? lastDayOfMonth(fullYear(namedMonthYear[2]!), month) : null;
  }

  // 11/2026: month and year only.
  m = /^(\d{1,2})[./-](\d{4})$/.exec(raw);
  if (m) return lastDayOfMonth(Number(m[2]), Number(m[1]));

  // 12/11/26, 12.11.2026, 12-11-26: two numbers then a year, in locale order.
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(raw);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const year = fullYear(m[3]!);
    const dayFirst = build(year, b, a);
    const monthFirst = build(year, a, b);
    if (dayFirst && monthFirst && dayFirst !== monthFirst) {
      const order = dayMonthOrder(locale);
      if (order === 'DMY') return dayFirst;
      if (order === 'MDY') return monthFirst;
      // Still ambiguous: take the earlier reading.
      return dayFirst < monthFirst ? dayFirst : monthFirst;
    }
    return dayFirst ?? monthFirst;
  }
  return null;
}

const MONTH_FULL_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** 1–12 for a month written as its first three letters or its full English name ("sept" works too), else null. */
function monthNumber(word: string): number | null {
  const index = MONTH_NAMES.indexOf(word.slice(0, 3));
  if (index < 0) return null;
  return word.length === 3 || MONTH_FULL_NAMES[index]!.startsWith(word) ? index + 1 : null;
}
