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

export const REMINDER_TYPES = ['APPROACHING_EXPIRY', 'DUE', 'OVERDUE'] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const PREFERENCE_KEYS = ['approachingExpiry', 'due', 'overdue'] as const;
export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];
