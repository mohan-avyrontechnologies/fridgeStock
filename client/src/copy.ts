/**
 * Every user-facing word about expiry lives in this file. No other client
 * file may contain expiry wording (server/test/foodSafetyCopy.test.ts checks).
 *
 * Food-safety boundary (BRD §10.3, FRD §15): the app estimates when food is
 * expected to expire so people can plan cooking. It never claims food is fit
 * to eat. Use "expected expiry" wording only; the banned phrase list is in
 * server/test/foodSafetyCopy.test.ts.
 */
import {
  REFERENCE_SOURCE,
  type ReminderMode,
  type ReminderType,
  type StorageLocation,
  type Urgency,
} from '@cook-first/shared';

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
    points: [
      'Log food with a lifespan in days',
      'See everything ordered by expected expiry',
      'Get reminders as items get close',
    ],
  },
  dashboard: {
    sortedHint: 'Sorted by expected expiry, soonest first.',
    emptyInventory: 'Your fridge is empty. Add your first item.',
    nothingUrgent: 'Nothing urgent right now.',
    insightsLink: 'See what you used and wasted',
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
    priceHint: 'Optional. What it cost in total. Used only for the money figures on Insights.',
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
/** Actions happen at once and offer "Undo" instead of asking for confirmation. */
export const undoCopy = {
  label: 'Undo',
  restored: (name: string) => `Restored: ${name}`,
  failed: 'Couldn’t undo that. It may be too late.',
  cancel: 'Cancel',
};

export const storageLabel: Record<StorageLocation, string> = {
  FRIDGE: 'Fridge',
  FREEZER: 'Freezer',
  PANTRY: 'Pantry',
};

/** Suggested lifespans come from a clearly identified reference list, and are always editable. */
export const referenceCopy = {
  suggested: (days: number) => `Suggested ${days} ${days === 1 ? 'day' : 'days'}`,
  hint: `Suggested lifespans are typical planning estimates from the ${REFERENCE_SOURCE}. Change the number if yours differs.`,
  notUsuallyKept: (where: string) => `Not usually kept in the ${where.toLowerCase()}. Enter your own lifespan.`,
  learned: (days: number, basedOn: number) =>
    `You usually set ${days} ${days === 1 ? 'day' : 'days'} for this (from your last ${basedOn}). Change it if you like.`,
};

export const favouriteCopy = {
  title: 'Favourites',
  hint: 'Tap one to add it again today.',
  save: '☆ Save as favourite',
  saved: '★ Favourite',
  savedToast: (name: string) => `Saved ${name} as a favourite`,
  removedToast: (name: string) => `Removed ${name} from favourites`,
  addedToast: (name: string) => `Added ${name}`,
};

/** Phase 2: marking an item as opened (can only shorten the expected expiry). */
export const openCopy = {
  button: 'Opened',
  title: (name: string) => `Opened ${name}`,
  openedOn: 'Opened on',
  daysLabel: 'Days it lasts once opened',
  hint: 'The expected expiry becomes the opened date plus these days, if that is sooner.',
  referenceHint: (days: number) => `Typical once opened: ${days} ${days === 1 ? 'day' : 'days'} (${REFERENCE_SOURCE}).`,
  toast: (name: string, date: string) => `Marked ${name} as opened. Expected expiry ${date}`,
  undo: 'Mark as not opened',
  undone: (name: string) => `${name} is no longer marked as opened`,
};

/** Phase 2: moving between fridge, freezer and pantry. */
export const moveCopy = {
  button: 'Move',
  title: (name: string) => `Move ${name}`,
  where: 'Move to',
  daysLabel: (where: string) => `Days it lasts in the ${where.toLowerCase()}, from today`,
  toast: (name: string, where: string, date: string) =>
    `Moved ${name} to the ${where.toLowerCase()}. Expected expiry ${date}`,
};

export const bulkCopy = {
  title: 'Bulk add',
  subtitle: 'Add a whole shopping haul at once',
  link: 'Adding a whole shop? Use bulk add',
  addRow: 'Add another row',
  removeRow: 'Remove row',
  save: (n: number) => `Add ${n} ${n === 1 ? 'item' : 'items'}`,
  added: (n: number) => `Added ${n} ${n === 1 ? 'item' : 'items'}`,
  rowLabel: (n: number) => `Item ${n}`,
};

export const historyActionLabel = {
  USED: 'Used',
  PARTIALLY_USED: 'Partly used',
  WASTED: 'Wasted',
  REMOVED: 'Removed',
} as const;

/** Phase 3: push reminders on this device (Settings). */
export const pushSettingsCopy = {
  title: 'Push reminders',
  intro: 'Get reminders on this device, even when Cook First is closed.',
  turnOn: 'Turn on reminders',
  turnOff: 'Turn off on this device',
  on: 'Reminders are on for this device.',
  onToast: 'Reminders are on for this device',
  offToast: 'Reminders are off for this device',
  blocked: 'Notifications are blocked for this site. Allow them in your browser’s site settings, then try again.',
  dismissed: 'Reminders weren’t turned on. Tap the button again whenever you’re ready.',
  failed: 'Couldn’t turn on reminders. Try again.',
  unsupported: 'This browser can’t show push reminders. You’ll still see every reminder under the bell.',
  iosHomeScreen:
    'On iPhone, reminders need the app on your Home Screen first. Tap Share, then “Add to Home Screen”, and open Cook First from there.',
  notConfigured: 'Push reminders aren’t set up on this server yet. You’ll still see every reminder under the bell.',
  inAppNote: 'Every reminder also appears under the bell, even if a push doesn’t arrive.',
  modeTitle: 'How they arrive',
  modes: {
    DIGEST: { title: 'One daily summary', detail: 'Your Cook First list in one message' },
    EACH_ITEM: { title: 'One per item', detail: 'A separate message for each reminder' },
  } satisfies Record<ReminderMode, { title: string; detail: string }>,
  timeLabel: 'Time',
  hour: (hour: number) => `${String(hour).padStart(2, '0')}:00`,
  saveFailed: 'Couldn’t save that. Try again.',
};

/** Phase 4: leftovers. */
export const leftoverCopy = {
  label: 'These are leftovers',
  hint: (max: number) => `Leftovers get a short lifespan: at most ${max} days, unless frozen.`,
  tag: 'Leftovers',
  save: 'Save leftovers',
  name: (meal: string) => `Leftover ${meal}`.slice(0, 60),
};

/** Phase 4: AI features. */
export const aiCopy = {
  left: (used: number, limit: number) => `${Math.max(limit - used, 0)} of ${limit} AI suggestions left today`,
  note: 'These are AI suggestions built from your Cook First list. Always check your food before cooking with it.',
  busy: 'Thinking…',
};

export const recipeCopy = {
  title: 'Recipe ideas',
  intro: 'Ideas that use your most urgent food first.',
  button: 'Suggest recipes',
  again: 'Suggest again',
  minutes: (n: number) => `About ${n} min`,
  uses: 'Uses',
  none: 'No ideas this time. Try again in a moment.',
};

export const shoppingCopy = {
  title: 'Shopping',
  subtitle: 'See what’s already at home before you buy it',
  nameLabel: 'Item',
  namePlaceholder: 'e.g. Milk',
  quantityLabel: 'How many (optional)',
  unitLabel: 'Unit (optional)',
  noUnit: '—',
  add: 'Add to list',
  empty: 'Your shopping list is empty.',
  toBuy: 'To buy',
  bought: 'Bought',
  atHome: (name: string, quantity: string, date: string) =>
    `Already at home: ${name} (${quantity}), expected expiry ${date}`,
  addedWithWarning: (name: string) => `Added ${name}. You already have some at home.`,
  added: (name: string) => `Added ${name}`,
  tick: (name: string) => `Bought ${name}`,
  remove: (name: string) => `Remove ${name}`,
  clear: 'Clear bought items',
  loadError: 'Couldn’t load your shopping list.',
};

export const planCopy = {
  title: 'Meal plan',
  subtitle: 'This week, using what needs cooking first',
  today: 'Today',
  tomorrow: 'Tomorrow',
  nothing: 'Nothing planned',
  add: 'Plan a meal',
  edit: 'Edit',
  clear: 'Clear',
  mealLabel: 'Meal',
  mealPlaceholder: 'e.g. Chicken curry',
  foodsLabel: 'Uses (optional)',
  foodsHint: 'Your food, most urgent first.',
  save: 'Save',
  cancel: 'Cancel',
  gone: 'no longer at home',
  suggest: 'Suggest meals for empty days',
  draftTitle: 'Suggested meals',
  draftHint: 'Nothing is added until you choose to.',
  addDraft: 'Add these to my plan',
  discard: 'Discard',
  added: 'Added to your plan',
  full: 'Every day this week already has a meal.',
  loadError: 'Couldn’t load your meal plan.',
};

/** Phase 5: insights. Talks about habits and money, never about whether food can be eaten. */
export const insightsCopy = {
  subtitle: 'What you used and wasted',
  loadError: 'Couldn’t load your insights. Try again.',
  emptyTitle: 'Nothing to show yet',
  emptyBody: 'Mark food as used or wasted and your weekly picture appears here.',
  seeHistory: 'See History',
  used: 'Used',
  wasted: 'Wasted',
  thisWeek: 'This week',
  rate: (percent: number) => `${percent}% of the food you finished this week was wasted.`,
  nothingFinishedThisWeek: 'Nothing was used or wasted this week yet.',
  lastWeek: (used: number, wasted: number) => `Last week: ${used} used, ${wasted} wasted.`,
  moneyTitle: 'Money',
  savedThisWeek: 'Used this week',
  lostThisWeek: 'Wasted this week',
  savedMonth: 'Used, last 30 days',
  lostMonth: 'Wasted, last 30 days',
  moneyNote: 'Only food you added a price for is counted, and a partly used item counts for the part you used.',
  weeksTitle: 'Last 8 weeks',
  chartLabel: 'Items used and wasted in each of the last 8 weeks',
  topWastedTitle: 'Wasted most, last 30 days',
  times: (n: number) => (n === 1 ? '1 time' : `${n} times`),
  tipsTitle: 'Tips',
  currencyTitle: 'Currency',
  currencyHint: 'Used to show prices. Nothing is converted.',
} as const;

/** Phase 6: appearance (kept on this device). */
export const appearanceCopy = {
  title: 'Appearance',
  hint: 'Kept on this device. System follows your phone or computer.',
  options: { system: 'System', light: 'Light', dark: 'Dark' },
} as const;

/** Phase 6: your data (Settings). */
export const dataCopy = {
  title: 'Your data',
  exportHint: 'Download everything the app holds about you as one file.',
  exportButton: 'Download my data',
  exporting: 'Preparing…',
  exportDone: 'Your data was downloaded',
  exportError: 'Couldn’t prepare your data. Try again.',
  deleteHint: 'Permanently deletes your account, your food, your history and your lists. This can’t be undone.',
  deleteOpen: 'Delete my account',
  passwordLabel: 'Enter your password to confirm',
  deleteConfirm: 'Delete everything',
  deleting: 'Deleting…',
  cancel: 'Cancel',
  deleted: 'Your account was deleted',
  deleteError: 'Couldn’t delete your account. Try again.',
} as const;

/** Phase 6: shared households. */
export const householdCopy = {
  title: 'Household',
  subtitle: 'Share food with others',
  loadError: 'Couldn’t load your household. Try again.',
  membersTitle: 'People',
  you: 'You',
  alone: 'It’s just you. Invite someone to share your food, shopping list and meal plan.',
  shared:
    'Everyone here sees the same food, shopping list, meal plan, history and insights. Favourites, reminder settings and currency stay your own.',
  inviteTitle: 'Invite someone',
  inviteHint: 'Make a code and send it to them yourself. It works once, for a week.',
  inviteButton: 'Make an invite code',
  newInvite: 'Your invite code',
  copy: 'Copy code',
  copied: 'Code copied',
  copyFailed: 'Couldn’t copy. Select the code and copy it yourself.',
  expires: (date: string) => `Works once, until ${date}`,
  cancelInvite: 'Cancel',
  inviteCancelled: 'Invite cancelled',
  openInvites: 'Open invites',
  joinTitle: 'Join a household',
  joinHint: 'Enter the code someone gave you. Your food, shopping list and meal plan will be shared with them.',
  codeLabel: 'Invite code',
  joinButton: 'Join',
  joining: 'Joining…',
  joined: 'You joined the household',
  leaveTitle: 'Leave this household',
  leaveHint: 'The food, shopping items and meal plans you added go with you. Everything else stays with the others.',
  leaveButton: 'Leave household',
  leaveConfirm: 'Leave',
  leaving: 'Leaving…',
  left: 'You left the household',
  cancel: 'Cancel',
  activityTitle: 'Activity',
  activityEmpty: 'Nothing has happened yet.',
  loadMore: 'Load more',
  actionError: 'Couldn’t do that. Try again.',
  activity: {
    FOOD_ADDED: (who: string, food: string) => `${who} added ${food}`,
    USED: (who: string, food: string) => `${who} used ${food}`,
    PARTIALLY_USED: (who: string, food: string) => `${who} used some ${food}`,
    WASTED: (who: string, food: string) => `${who} wasted ${food}`,
    REMOVED: (who: string, food: string) => `${who} removed ${food}`,
    MEMBER_JOINED: (who: string) => `${who} joined the household`,
    MEMBER_LEFT: (who: string) => `${who} left the household`,
    PHOTO_CHECKED: (who: string, food: string) => `${who} checked ${food} with a photo`,
  },
} as const;

/** Phase 6: barcode and receipt scanning. */
export const scanCopy = {
  open: 'Scan a barcode',
  title: 'Scan a barcode',
  close: 'Close',
  useCamera: 'Use the camera',
  cameraLabel: 'Camera view for scanning a barcode',
  pointCamera: 'Hold the barcode steady inside the picture.',
  cameraFailed: 'The camera isn’t available. Type the number under the barcode instead.',
  numberLabel: 'Or type the number under the barcode',
  numberHint: 'Eight to fourteen digits. Spaces and dashes are fine.',
  lookUp: 'Look up',
  looking: 'Looking…',
  notFound: 'That barcode isn’t in the product list. Type the name instead.',
  lookupError: 'The product look-up isn’t available right now. Type the name instead.',
  found: (name: string) => `Found: ${name}. Check the details, then choose how long it lasts.`,
} as const;

export const receiptCopy = {
  title: 'Scan a receipt',
  hint: 'Take a photo of your receipt and the food on it is filled in below. You check every line before anything is saved.',
  button: 'Scan a receipt',
  reading: 'Reading your receipt…',
  none: 'No food lines were found on that receipt. Try a clearer photo.',
  found: (count: number) => `Found ${count} ${count === 1 ? 'item' : 'items'}. Check each one before saving.`,
  error: 'Couldn’t read that photo. Try again.',
  checkNote:
    'Read from a photo, so check each line. The app is only guessing how long each item lasts: fill in any that are blank.',
  dateSet: 'The added date was set from the receipt.',
} as const;

/** Phase 7: Photo Check. It only ever points out visible problems; there is no "looks fine" text. */
export const photoCopy = {
  region: 'Photo Check',
  addButton: 'Identify from a photo',
  checkButton: 'Check with photo',
  inputLabel: 'Food photo',
  reading: 'Looking at your photo…',
  error: 'Couldn’t check that photo. Try again.',
  checked: 'Photo checked',
  unsure: 'I couldn’t tell what this is from the photo. Type the name instead.',
  looksLike: (name: string) => `Looks like ${name}. Check the details, then choose how long it lasts.`,
  signsRegion: 'Visible signs noticed',
  signs: (descriptions: string[]) =>
    `Visible signs noticed: ${descriptions.join('; ')}. A photo can’t show everything, so check the item yourself before using it.`,
  waste: 'Mark as wasted',
  useToday: 'Use today',
  confirmUseToday: (name: string) => `Make ${name} due today? Its expected expiry will change to today.`,
  confirm: 'Yes, use today',
  cancel: 'Cancel',
  dismiss: 'Dismiss',
  dueToday: (name: string) => `${name} is now due today`,
} as const;
