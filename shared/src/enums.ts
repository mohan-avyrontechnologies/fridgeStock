/** Enumerations shared by client and server. Each is a const array plus its union type. */

/** Derived from remaining days every time items are read; never stored. */
export const URGENCIES = ['NOT_URGENT', 'APPROACHING_EXPIRY', 'DUE', 'OVERDUE'] as const;
export type Urgency = (typeof URGENCIES)[number];

/** Units a food item's quantity can be measured in. */
export const UNITS = ['pcs', 'g', 'kg', 'ml', 'l', 'pack', 'bunch'] as const;
export type Unit = (typeof UNITS)[number];

/** Where an item is kept. Each has its own typical lifespans (see foodReference.ts). */
export const STORAGE_LOCATIONS = ['FRIDGE', 'FREEZER', 'PANTRY'] as const;
export type StorageLocation = (typeof STORAGE_LOCATIONS)[number];

/** Stored lifecycle status of a food item. A partly used item stays ACTIVE. */
export const FOOD_STATUSES = ['ACTIVE', 'USED', 'WASTED', 'REMOVED'] as const;
export type FoodStatus = (typeof FOOD_STATUSES)[number];

/** Actions recorded as usage records. */
export const USAGE_ACTIONS = ['USED', 'PARTIALLY_USED', 'WASTED', 'REMOVED'] as const;
export type UsageAction = (typeof USAGE_ACTIONS)[number];

/** Currencies a user can show prices in (display only; no conversion). */
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** What a photo check can point out. There is deliberately no value for "looks fine": the AI may only report problems. */
export const WARNING_SIGN_TYPES = [
  'MOULD',
  'DISCOLOURATION',
  'WILTING',
  'SLIME',
  'BRUISING',
  'DAMAGED_PACKAGING',
  'SWOLLEN_PACKAGING',
  'OTHER',
] as const;
export type WarningSignType = (typeof WARNING_SIGN_TYPES)[number];

/** Things that show in a household's activity log. */
export const ACTIVITY_TYPES = [
  'FOOD_ADDED',
  'USED',
  'PARTIALLY_USED',
  'WASTED',
  'REMOVED',
  'MEMBER_JOINED',
  'MEMBER_LEFT',
  'PHOTO_CHECKED',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const REMINDER_TYPES = ['APPROACHING_EXPIRY', 'DUE', 'OVERDUE'] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const PREFERENCE_KEYS = ['approachingExpiry', 'due', 'overdue'] as const;
export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];

/** How push reminders arrive: one summary a day, or one per reminder (both at the user's chosen hour). */
export const REMINDER_MODES = ['DIGEST', 'EACH_ITEM'] as const;
export type ReminderMode = (typeof REMINDER_MODES)[number];

/** Buttons inside a push notification. */
/** Where a push subscription lives: a browser (Web Push), or the Android or iOS app (Firebase Cloud Messaging). */
export const PUSH_PLATFORMS = ['web', 'android', 'ios'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

export const PUSH_ACTIONS = ['USED', 'SNOOZE'] as const;
export type PushAction = (typeof PUSH_ACTIONS)[number];

/** Breakfast, lunch and dinner: the meals a cooking reminder and a planned meal can be for. */
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

/**
 * The buttons on a meal reminder. COOKED and RECIPE open a page; SNOOZE_MEAL calls the API (with the
 * notification's own token) to be reminded again in 30 minutes.
 */
export const MEAL_PUSH_ACTIONS = ['COOKED', 'RECIPE', 'SNOOZE_MEAL'] as const;
export type MealPushAction = (typeof MEAL_PUSH_ACTIONS)[number];

/** Every button a push notification can carry. */
export type PushActionName = PushAction | MealPushAction;

/** What a push is about. It decides which sound, channel and vibration it gets. */
export const PUSH_KINDS = ['APPROACHING_EXPIRY', 'DIGEST', 'DUE', 'OVERDUE', 'MEAL'] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

/** The three reminder sounds: gentle (approaching expiry and the daily summary), strong (due and overdue), meal. */
export const SOUND_NAMES = ['gentle', 'strong', 'meal'] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

/**
 * Android notification channels. food-soon, food-urgent and meal-reminders are the three that carry the
 * sounds; the other three let a person's sound and vibration switches (and quiet hours) take effect, because
 * Android fixes sound and vibration per channel.
 */
export const NOTIFICATION_CHANNELS = [
  'food-soon',
  'food-urgent',
  'meal-reminders',
  'food-urgent-sound',
  'reminders-vibrate',
  'reminders-silent',
] as const;
export type NotificationChannelId = (typeof NOTIFICATION_CHANNELS)[number];
