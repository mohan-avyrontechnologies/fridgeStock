import {
  DEFAULT_THRESHOLDS,
  URGENCY,
  URGENCY_RANK,
  type Urgency,
  type UrgencyThresholds,
} from '../config/urgency.js';
import { diffDays } from '../utils/dates.js';

/**
 * Deterministic priority engine (TDD §6). Pure: no I/O, no clock, so the same
 * input always produces the same order. Future AI features must consume this
 * output, never reorder it.
 */
export interface PrioritisableItem {
  id: string;
  status: string;
  addedDate: Date;
  expiryDate: Date;
}

export type Prioritised<T> = T & { remainingDays: number; urgency: Urgency };

const CLOSED_STATUSES = new Set(['USED', 'WASTED', 'REMOVED']);

export function classifyUrgency(
  remainingDays: number,
  thresholds: UrgencyThresholds = DEFAULT_THRESHOLDS,
): Urgency {
  if (remainingDays < 0) return URGENCY.PAST_EXPECTED_EXPIRY;
  if (remainingDays === 0) return URGENCY.DUE_TODAY;
  if (remainingDays <= thresholds.useSoonDays) return URGENCY.USE_SOON;
  return URGENCY.NOT_URGENT;
}

export function compareByPriority(a: PrioritisableItem, b: PrioritisableItem): number {
  return (
    a.expiryDate.getTime() - b.expiryDate.getTime() ||
    a.addedDate.getTime() - b.addedDate.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function prioritise<T extends PrioritisableItem>(
  items: T[],
  today: Date,
  thresholds: UrgencyThresholds = DEFAULT_THRESHOLDS,
): Prioritised<T>[] {
  return items
    .filter((item) => !CLOSED_STATUSES.has(item.status))
    .sort(compareByPriority)
    .map((item) => {
      const remainingDays = diffDays(item.expiryDate, today);
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
  const summary: Record<Urgency, number> = {
    NOT_URGENT: 0,
    USE_SOON: 0,
    DUE_TODAY: 0,
    PAST_EXPECTED_EXPIRY: 0,
  };
  for (const item of prioritised) if (item.urgency) summary[item.urgency] += 1;
  return summary;
}
