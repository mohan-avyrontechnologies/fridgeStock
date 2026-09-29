import { diffDays, type DateString, type Urgency } from '@cook-first/shared';
import { DEFAULT_THRESHOLDS, URGENCY_RANK, type UrgencyThresholds } from '../config/urgency.js';

/**
 * Deterministic priority engine (TDD §6). A pure function: no database, no
 * Express, no clock. The same items and the same `today` always give the same
 * order. Future AI features must consume this output, never reorder it.
 */
export interface PrioritisableItem {
  id: string;
  status: string;
  addedDate: DateString;
  expiryDate: DateString;
}

export type Prioritised<T> = T & { remainingDays: number; urgency: Urgency };

const CLOSED_STATUSES = new Set(['USED', 'WASTED', 'REMOVED']);

export function classifyUrgency(remainingDays: number, thresholds: UrgencyThresholds = DEFAULT_THRESHOLDS): Urgency {
  if (remainingDays < 0) return 'PAST_EXPECTED_EXPIRY';
  if (remainingDays === 0) return 'DUE_TODAY';
  if (remainingDays <= thresholds.useSoonDays) return 'USE_SOON';
  return 'NOT_URGENT';
}

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Expected expiry, then added date, then id. "YYYY-MM-DD" strings sort chronologically. */
export function compareByPriority(a: PrioritisableItem, b: PrioritisableItem): number {
  return compareStrings(a.expiryDate, b.expiryDate) || compareStrings(a.addedDate, b.addedDate) || compareStrings(a.id, b.id);
}

export function prioritise<T extends PrioritisableItem>(
  items: T[],
  today: DateString,
  thresholds: UrgencyThresholds = DEFAULT_THRESHOLDS,
): Prioritised<T>[] {
  return items
    .filter((item) => !CLOSED_STATUSES.has(item.status))
    .sort(compareByPriority)
    .map((item) => {
      const remainingDays = diffDays(today, item.expiryDate);
      return { ...item, remainingDays, urgency: classifyUrgency(remainingDays, thresholds) };
    });
}

export function cookFirst<T extends { urgency: Urgency | null }>(
  prioritised: T[],
  thresholds: UrgencyThresholds = DEFAULT_THRESHOLDS,
): T[] {
  const minimum = URGENCY_RANK[thresholds.cookFirstMinimum];
  return prioritised.filter((item) => item.urgency !== null && URGENCY_RANK[item.urgency] >= minimum);
}

export function summarise(prioritised: { urgency: Urgency | null }[]): Record<Urgency, number> {
  const summary: Record<Urgency, number> = { NOT_URGENT: 0, USE_SOON: 0, DUE_TODAY: 0, PAST_EXPECTED_EXPIRY: 0 };
  for (const item of prioritised) if (item.urgency) summary[item.urgency] += 1;
  return summary;
}
