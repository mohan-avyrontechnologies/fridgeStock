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
export const PUSH_ACTIONS = ['USED', 'SNOOZE'] as const;
export type PushAction = (typeof PUSH_ACTIONS)[number];
