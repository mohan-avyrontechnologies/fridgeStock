/**
 * Every user-facing word about expiry lives in this file. No other client
 * file may contain expiry wording (server/test/foodSafetyCopy.test.ts checks).
 *
 * Food-safety boundary (BRD §10.3, FRD §15): the app estimates when food is
 * expected to expire so people can plan cooking. It never claims food is fit
 * to eat. Use "expected expiry" wording only; the banned phrase list is in
 * server/test/foodSafetyCopy.test.ts.
 */
import type { ReminderType, Urgency } from '@cook-first/shared';

/** Required on Add Food and Cook First (and shown elsewhere). Do not reword. */
export const estimateNote = 'Expected expiry is an estimate to help you plan. Always check your food before eating it.';

/**
 * Every urgency state has a text label as well as a colour; the interface
 * never shows colour alone. The day threshold lives only on the server
 * (server/src/config/urgency.ts), so no wording here mentions a number.
 */
export const urgencyCopy: Record<Urgency, { label: string; hint: string }> = {
  NOT_URGENT: { label: 'Not urgent', hint: 'Plenty of time before its expected expiry' },
  APPROACHING_EXPIRY: { label: 'Use soon', hint: 'Getting close to its expected expiry' },
  DUE: { label: 'Expected expiry today', hint: 'Its expected expiry is today' },
  OVERDUE: { label: 'Past expected expiry', hint: 'The expected expiry date has passed' },
};

/** Short label for summary tiles where space is tight. */
export const urgencyShortLabel: Record<Urgency, string> = {
  NOT_URGENT: 'Not urgent',
  APPROACHING_EXPIRY: 'Use soon',
  DUE: 'Today',
  OVERDUE: 'Past',
};

export const pastExpectedExpiryNote =
  'This item is past its expected expiry. Check its condition before deciding whether to use it or throw it away.';

/** "5 days left", "1 day left", "Expected expiry today", "1 day past expected expiry", "4 days past expected expiry". */
export function remainingText(remainingDays: number): string {
  if (remainingDays > 1) return `${remainingDays} days left`;
  if (remainingDays === 1) return '1 day left';
  if (remainingDays === 0) return 'Expected expiry today';
  if (remainingDays === -1) return '1 day past expected expiry';
  return `${-remainingDays} days past expected expiry`;
}

/** Card line: "Expected expiry Tue, 29 Sep". */
export const cardExpiryLine = (date: string) => `Expected expiry ${date}`;

export const expectedExpiryLabel = 'Expected expiry';

export const screenCopy = {
  auth: {
    intro: 'Log what’s in your fridge and see what to cook before it reaches its expected expiry.',
    headline: 'Know what to cook before it’s forgotten.',
    points: ['Log food with a lifespan in days', 'See everything ordered by expected expiry', 'Get reminders as items get close'],
  },
  dashboard: {
    sortedHint: 'Sorted by expected expiry, soonest first.',
    emptyInventory: 'Your fridge is empty. Add your first item.',
    nothingUrgent: 'Nothing urgent right now.',
    seeAll: 'See all',
    loadError: 'Couldn’t load your food.',
  },
  cookFirst: {
    subtitle: 'What to use first, soonest expected expiry at the top',
    intro: (count: number) =>
      `${count} ${count === 1 ? 'item is' : 'items are'} at or near expected expiry. Tap “Used” or “Wasted” once you’ve dealt with something.`,
    empty: 'Nothing needs attention right now.',
    loadError: 'Couldn’t load Cook First.',
  },
  form: {
    /** "Expected expiry: Thu, 1 Oct (2 days left)". */
    preview: (date: string, remainingDays: number) =>
      `Expected expiry: ${date} (${remainingDays === 0 ? 'today' : remainingText(remainingDays)})`,
    previewEmpty: 'Expected expiry: enter a lifespan to see it',
    lifespanHint: 'Your own estimate, counted from the added date. 0 means it expires the same day.',
    addNote: 'Add note',
  },
  detail: {
    savedToast: 'Saved. Expected expiry updated.',
    closedNote: 'This item is closed and can’t be changed.',
  },
  reminders: {
    emptyBody:
      'You’ll get a reminder here when an item is getting close to its expected expiry, on the day, and if it passes.',
    loadError: 'Couldn’t load your reminders.',
  },
  settings: {
    aboutTitle: 'About expected expiry',
    preferencesError: 'Couldn’t load your reminder settings.',
  },
  history: {
    loadMore: 'Load more',
    loadError: 'Couldn’t load your history.',
  },
};

/** Labels for the three reminder types (feed and settings). */
export const reminderTypeLabel: Record<ReminderType, string> = {
  APPROACHING_EXPIRY: urgencyCopy.APPROACHING_EXPIRY.label,
  DUE: urgencyCopy.DUE.label,
  OVERDUE: urgencyCopy.OVERDUE.label,
};

export const reminderPreferenceCopy: Record<
  'approachingExpiry' | 'due' | 'overdue',
  { title: string; detail: string }
> = {
  approachingExpiry: { title: 'Getting close', detail: 'When an item becomes “Use soon”' },
  due: { title: 'On the day', detail: 'When an item reaches its expected expiry' },
  overdue: { title: 'Once it’s past', detail: 'The day after an item’s expected expiry' },
};

export const actionCopy = {
  USED: { label: 'Used all', past: 'Marked as used' },
  PARTIALLY_USED: { label: 'Used some', past: 'Recorded partial use' },
  WASTED: { label: 'Wasted', past: 'Marked as wasted' },
  REMOVED: { label: 'Remove', past: 'Removed' },
} as const;

/** The one small confirmation shown before an item is closed. */
export const confirmCopy = {
  USED: (name: string) => ({ title: `Mark ${name} as used?`, confirm: 'Yes, used all' }),
  WASTED: (name: string) => ({ title: `Mark ${name} as wasted?`, confirm: 'Yes, wasted' }),
  REMOVED: (name: string) => ({ title: `Remove ${name} from your list?`, confirm: 'Yes, remove' }),
  detail: 'This closes the item. It stays in your history.',
  cancel: 'Cancel',
};

export const historyActionLabel = {
  USED: 'Used',
  PARTIALLY_USED: 'Partly used',
  WASTED: 'Wasted',
  REMOVED: 'Removed',
} as const;
