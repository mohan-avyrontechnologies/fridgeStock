import { diffDays, type DateString, type FoodStatus, type Urgency, type UrgencySummary } from '@cook-first/shared';
import { APPROACHING_EXPIRY_DAYS } from '../config/urgency.js';

/**
 * Deterministic priority engine (TDD §6). A pure function: no database, no
 * Express, no clock. The same items and the same `today` always give the same
 * result. Urgency is calculated here on every read and never stored.
 */
export interface PrioritisableItem {
  id: string;
  status: FoodStatus;
  addedDate: DateString;
  expiryDate: DateString;
}

export type Prioritised<T> = T & { remainingDays: number; urgency: Urgency };

export interface Prioritisation<T> {
  /** Every ACTIVE item, most urgent first. */
  items: Prioritised<T>[];
  /** The items that are APPROACHING_EXPIRY, DUE or OVERDUE, in the same order. */
  cookFirst: Prioritised<T>[];
  /** How many items are in each urgency state, plus the total. */
  summary: UrgencySummary;
}

const COOK_FIRST = new Set<Urgency>(['APPROACHING_EXPIRY', 'DUE', 'OVERDUE']);

/** remainingDays = expiry date − today. */
export function classifyUrgency(remainingDays: number): Urgency {
  if (remainingDays < 0) return 'OVERDUE';
  if (remainingDays === 0) return 'DUE';
  if (remainingDays <= APPROACHING_EXPIRY_DAYS) return 'APPROACHING_EXPIRY';
  return 'NOT_URGENT';
}

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Expiry date, then added date, then id (as strings). "YYYY-MM-DD" strings sort chronologically. */
export function compareByPriority(a: PrioritisableItem, b: PrioritisableItem): number {
  return compareStrings(a.expiryDate, b.expiryDate) || compareStrings(a.addedDate, b.addedDate) || compareStrings(a.id, b.id);
}

export function prioritise<T extends PrioritisableItem>(items: readonly T[], today: DateString): Prioritisation<T> {
  const sorted = items
    .filter((item) => item.status === 'ACTIVE')
    .map((item) => {
      const remainingDays = diffDays(today, item.expiryDate);
      return { ...item, remainingDays, urgency: classifyUrgency(remainingDays) };
    })
    .sort(compareByPriority);

  const summary: UrgencySummary = { NOT_URGENT: 0, APPROACHING_EXPIRY: 0, DUE: 0, OVERDUE: 0, total: sorted.length };
  for (const item of sorted) summary[item.urgency] += 1;

  return { items: sorted, cookFirst: sorted.filter((item) => COOK_FIRST.has(item.urgency)), summary };
}
