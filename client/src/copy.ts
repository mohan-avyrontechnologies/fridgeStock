/**
 * Every user-facing word about expiry lives in this file. No other client
 * file may contain expiry wording (server/test/foodSafetyCopy.test.ts checks).
 *
 * Food-safety boundary (BRD §10.3, FRD §15): the app estimates when food is
 * expected to expire so people can plan cooking. It never claims food is fit
 * to eat. Use "expected expiry" wording only; the banned phrase list is in
 * server/test/foodSafetyCopy.test.ts.
 */
import type { ReminderType, Urgency } from './api/types';

/** Required on Add Food and Cook First (and shown elsewhere). Do not reword. */
export const estimateNote = 'Expected expiry is an estimate to help you plan. Always check your food before eating it.';

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

/** Card line: "Expected expiry Tue, Sep 29 · today". */
export const cardExpiryLine = (date: string, remainingDays: number) =>
  `Expected expiry ${date} · ${relativeDay(remainingDays)}`;

export const expectedExpiryLabel = 'Expected expiry';

export const screenCopy = {
  auth: {
    intro: 'Log what’s in your fridge and see what to cook before it reaches its expected expiry.',
    headline: 'Know what to cook before it’s forgotten.',
    points: ['Log food with a lifespan in days', 'See everything ordered by expected expiry', 'Get reminders as items get close'],
  },
  dashboard: {
    sortedHint: 'Sorted by expected expiry, soonest first.',
    emptyBody: 'Add the perishables in your fridge and we’ll order them by expected expiry.',
  },
  cookFirst: {
    subtitle: 'What to use first, soonest expected expiry at the top',
    intro: (count: number) =>
      `${count} ${count === 1 ? 'item is' : 'items are'} at or near expected expiry. Tap “Update” once you’ve cooked with something.`,
    emptyTitle: 'Nothing needs attention right now',
    emptyBody: (total: number) =>
      total > 0
        ? `None of your ${total} items are within 3 days of their expected expiry.`
        : 'Add food to see what to cook first.',
  },
  form: {
    previewLabel: 'Expected expiry (estimate)',
    previewEmpty: 'Enter a lifespan to see it',
    lifespanHint: 'Your own estimate, counted from the added date.',
  },
  detail: {
    savedToast: 'Saved. Expected expiry updated.',
  },
  reminders: {
    emptyBody:
      'You’ll get a reminder here when an item is getting close to its expected expiry, on the day, and if it passes.',
  },
  settings: {
    aboutTitle: 'About expected expiry',
  },
};

/** Labels for the three reminder types (feed and settings). */
export const reminderTypeLabel: Record<ReminderType, string> = {
  APPROACHING_EXPIRY: urgencyCopy.USE_SOON.label,
  DUE: urgencyCopy.DUE_TODAY.label,
  OVERDUE: urgencyCopy.PAST_EXPECTED_EXPIRY.label,
};

export const reminderPreferenceCopy: Record<
  'approachingExpiry' | 'due' | 'overdue',
  { title: string; detail: string }
> = {
  approachingExpiry: { title: 'Getting close', detail: 'When an item is 3 days or less from its expected expiry' },
  due: { title: 'On the day', detail: 'When an item reaches its expected expiry' },
  overdue: { title: 'Once it’s past', detail: 'The day after an item’s expected expiry' },
};

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
