/** Enumerations shared by client and server. Each is a const array plus its union type. */

/** Derived from remaining days; never stored. */
export const URGENCIES = ['NOT_URGENT', 'USE_SOON', 'DUE_TODAY', 'PAST_EXPECTED_EXPIRY'] as const;
export type Urgency = (typeof URGENCIES)[number];

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
