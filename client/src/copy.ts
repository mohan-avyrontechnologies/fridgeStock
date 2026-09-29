/**
 * Every user-facing word about expiry comes from here.
 *
 * Food-safety boundary (BRD §10.3, FRD §15): the app estimates when food is
 * expected to expire so people can plan cooking. It never says or implies food
 * is fit to eat. Use "expected expiry"; never "safe", "fresh until" or
 * "good until". test/foodSafetyCopy.test.ts in the server fails the build if
 * that wording appears anywhere in the source.
 */
import type { Urgency } from './api/types';

export const urgencyCopy: Record<Urgency, { label: string; hint: string }> = {
  NOT_URGENT: { label: 'Not urgent', hint: 'More than 3 days to expected expiry' },
  USE_SOON: { label: 'Use soon', hint: '1–3 days to expected expiry' },
  DUE_TODAY: { label: 'Expected expiry today', hint: 'Expected to expire today' },
  PAST_EXPECTED_EXPIRY: { label: 'Past expected expiry', hint: 'The expected expiry date has passed' },
};

/** Short label for summary tiles where space is tight. */
export const urgencyShortLabel: Record<Urgency, string> = {
  NOT_URGENT: 'Not urgent',
  USE_SOON: 'Use soon',
  DUE_TODAY: 'Today',
  PAST_EXPECTED_EXPIRY: 'Past',
};

export const estimateNote =
  'Expected expiry is an estimate from the lifespan you entered, to help plan your cooking. It can’t tell you whether food is fit to eat. Always check the food itself.';

export const estimateNoteShort = 'Dates are estimates for planning, not a food-safety check.';

export const pastExpectedExpiryNote =
  'This item is past its expected expiry. Check its condition before deciding whether to use it or throw it away.';

export function remainingText(remainingDays: number): string {
  if (remainingDays === 0) return 'Expected expiry today';
  if (remainingDays === 1) return 'Expected expiry tomorrow';
  if (remainingDays > 1) return `Expected expiry in ${remainingDays} days`;
  const ago = -remainingDays;
  return `Expected expiry was ${ago === 1 ? 'yesterday' : `${ago} days ago`}`;
}

/** Short relative day for compact rows: "today", "tomorrow", "in 3 days", "2 days ago". */
export function relativeDay(remainingDays: number): string {
  if (remainingDays === 0) return 'today';
  if (remainingDays === 1) return 'tomorrow';
  if (remainingDays > 1) return `in ${remainingDays} days`;
  return remainingDays === -1 ? 'yesterday' : `${-remainingDays} days ago`;
}

export const actionCopy = {
  USED: { label: 'Used it all', past: 'Marked as used' },
  PARTIALLY_USED: { label: 'Used some', past: 'Recorded partial use' },
  WASTED: { label: 'Threw it away', past: 'Marked as wasted' },
  REMOVED: { label: 'Remove from list', past: 'Removed' },
} as const;

export const historyActionLabel = {
  USED: 'Used',
  PARTIALLY_USED: 'Partly used',
  WASTED: 'Wasted',
  REMOVED: 'Removed',
} as const;
