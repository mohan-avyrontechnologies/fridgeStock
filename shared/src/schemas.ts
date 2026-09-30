import { z } from 'zod';
import { isValidDate } from './dates.js';
import { PUSH_ACTIONS, REMINDER_MODES, STORAGE_LOCATIONS, UNITS } from './enums.js';

/**
 * Request schemas. The server's check is the only one that counts; the client
 * runs the same schemas purely so forms respond instantly with the same
 * messages.
 */

/** Validation messages. The API and forms must use exactly these wordings. */
export const MESSAGES = {
  reminderMode: 'Choose a daily summary or one reminder per item.',
  reminderHour: 'Choose an hour from 0 to 23.',
  pushSubscription: 'That push subscription isn’t valid.',
  pushAction: 'Unknown notification action.',
  foodName: 'Food name is required.',
  foodNameTooLong: 'Food name must be at most 60 characters.',
  quantity: 'Quantity must be a positive number.',
  unit: 'Choose a unit from the list.',
  addedDate: "Added date must be a valid date that isn't in the future.",
  lifespan: 'Lifespan must be a whole number of days from 0 to 365.',
  notes: 'Notes must be at most 200 characters.',
  email: 'Enter a valid email address.',
  password: 'Password must be at least 8 characters.',
  passwordTooLong: 'Password must be at most 128 characters.',
  loginPassword: 'Password is required.',
  name: 'Name is required.',
  nameTooLong: 'Name must be at most 50 characters.',
  invalidCredentials: 'Email or password is incorrect.',
  itemClosed: 'This item is no longer active.',
  storage: 'Choose where it is kept: fridge, freezer or pantry.',
  openedDate: "Opened date must be a valid date that isn't in the future or before the added date.",
  bulkEmpty: 'Add at least one item.',
  bulkTooMany: 'Add at most 50 items at once.',
  favouriteExists: 'This food is already a favourite.',
  nothingToUndo: 'There is nothing to undo for this item.',
  undoExpired: 'This action can no longer be undone.',
  daysLeft: 'Days left must be a whole number from 0 to 365.',
  alreadyOpened: 'This item is already marked as opened.',
  notOpened: 'This item is not marked as opened.',
  sameStorage: 'It is already kept there.',
  openedDaysNeeded: 'Enter how many days it lasts once opened.',
  storageDaysNeeded: 'Enter how many days it lasts there.',
} as const;

const email = z
  .string({ error: MESSAGES.email })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: MESSAGES.email }));

const name = z.string({ error: MESSAGES.name }).trim().min(1, MESSAGES.name).max(50, MESSAGES.nameTooLong);

export const registerSchema = z.object({
  name,
  email,
  password: z.string({ error: MESSAGES.password }).min(8, MESSAGES.password).max(128, MESSAGES.passwordTooLong),
  timeZone: z.string().optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string({ error: MESSAGES.loginPassword }).min(1, MESSAGES.loginPassword),
  timeZone: z.string().optional(),
});

export const updateAccountSchema = z.object({ name, timeZone: z.string() }).partial();

const quantity = z.number({ error: MESSAGES.quantity }).positive(MESSAGES.quantity).max(1_000_000, MESSAGES.quantity);

const foodFields = {
  name: z.string({ error: MESSAGES.foodName }).trim().min(1, MESSAGES.foodName).max(60, MESSAGES.foodNameTooLong),
  quantity,
  unit: z.enum(UNITS, { error: MESSAGES.unit }),
  // "Not in the future" depends on the user's time zone, so the server checks
  // that part (with the same message) once it knows who is asking.
  addedDate: z.string({ error: MESSAGES.addedDate }).refine(isValidDate, MESSAGES.addedDate),
  lifespanDays: z
    .number({ error: MESSAGES.lifespan })
    .int(MESSAGES.lifespan)
    .min(0, MESSAGES.lifespan)
    .max(365, MESSAGES.lifespan),
  notes: z.string({ error: MESSAGES.notes }).trim().max(200, MESSAGES.notes).optional(),
  /** Defaults to FRIDGE when omitted. */
  storage: z.enum(STORAGE_LOCATIONS, { error: MESSAGES.storage }).optional(),
  /** When the item was opened, if it has been. Checked against today and the added date by the server. */
  openedDate: z.string({ error: MESSAGES.openedDate }).refine(isValidDate, MESSAGES.openedDate).nullable().optional(),
};

/**
 * The expiry date is not a field: the server always calculates it from the
 * added date and lifespan. Unknown keys (such as an expiry date) are dropped.
 */
export const createFoodSchema = z.object(foodFields);

export const updateFoodSchema = z
  .object(foodFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update.');

/** One row of a bulk add; the added date (and default storage) come from the request. */
const bulkItem = z.object({
  name: foodFields.name,
  quantity,
  unit: foodFields.unit,
  lifespanDays: foodFields.lifespanDays,
  storage: foodFields.storage,
  notes: foodFields.notes,
});

/** A whole shopping haul in one request: 1–50 items sharing an added date. */
export const bulkCreateSchema = z.object({
  addedDate: foodFields.addedDate,
  storage: foodFields.storage,
  items: z.array(bulkItem, { error: MESSAGES.bulkEmpty }).min(1, MESSAGES.bulkEmpty).max(50, MESSAGES.bulkTooMany),
});

/** A saved food the user can re-add with one tap. */
export const favouriteSchema = z.object({
  name: foodFields.name,
  quantity,
  unit: foodFields.unit,
  lifespanDays: foodFields.lifespanDays,
  storage: z.enum(STORAGE_LOCATIONS, { error: MESSAGES.storage }).default('FRIDGE'),
});

const daysLeft = z
  .number({ error: MESSAGES.daysLeft })
  .int(MESSAGES.daysLeft)
  .min(0, MESSAGES.daysLeft)
  .max(365, MESSAGES.daysLeft);

/**
 * Mark an item as opened (default: today). `daysLeft` is how long it lasts once
 * opened; omitted, the server suggests one. The expected expiry only ever gets shorter.
 */
export const openFoodSchema = z.object({
  openedDate: z.string({ error: MESSAGES.openedDate }).refine(isValidDate, MESSAGES.openedDate).optional(),
  daysLeft: daysLeft.optional(),
});

/** Move an item to another location; `daysLeft` counts from today (omitted: the location's suggestion). */
export const moveFoodSchema = z.object({
  storage: z.enum(STORAGE_LOCATIONS, { error: MESSAGES.storage }),
  daysLeft: daysLeft.optional(),
});

/** Omit `quantity` to use the whole item; a smaller quantity is a partial use. */
export const useFoodSchema = z.object({ quantity: quantity.optional() });

/** Wasting always closes the whole item; the body is ignored. */
export const wasteFoodSchema = z.object({});

export const preferencesSchema = z
  .object({ approachingExpiry: z.boolean(), due: z.boolean(), overdue: z.boolean() })
  .partial()
  .strict();

/** PUT /notifications/delivery: how and when push reminders arrive. */
export const deliverySchema = z
  .object({
    mode: z.enum(REMINDER_MODES, { error: MESSAGES.reminderMode }),
    hour: z
      .number({ error: MESSAGES.reminderHour })
      .int(MESSAGES.reminderHour)
      .min(0, MESSAGES.reminderHour)
      .max(23, MESSAGES.reminderHour),
  })
  .partial()
  .strict();

const pushEndpoint = z
  .string({ error: MESSAGES.pushSubscription })
  .max(1000, MESSAGES.pushSubscription)
  .refine((value) => URL.canParse(value) && new URL(value).protocol === 'https:', MESSAGES.pushSubscription);
const pushKey = z
  .string({ error: MESSAGES.pushSubscription })
  .min(1, MESSAGES.pushSubscription)
  .max(200, MESSAGES.pushSubscription);

/** POST /push/subscriptions: the browser's PushSubscription.toJSON(), plus a short browser name. */
export const pushSubscriptionSchema = z.object({
  endpoint: pushEndpoint,
  keys: z.object({ p256dh: pushKey, auth: pushKey }, { error: MESSAGES.pushSubscription }),
  browser: z.string().trim().max(40).optional(),
});

/** DELETE /push/subscriptions */
export const pushUnsubscribeSchema = z.object({ endpoint: pushEndpoint });

/** POST /push/actions: sent by the service worker when a notification button is tapped. */
export const pushActionSchema = z.object({
  token: z.string().min(1).max(2000),
  action: z.enum(PUSH_ACTIONS, { error: MESSAGES.pushAction }),
});

/** GET /usage: limit defaults to 20 and offset to 0. */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /notifications: pages of up to 50, newest first. */
export const notificationPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type FoodInput = z.infer<typeof createFoodSchema>;
export type FoodUpdateInput = z.infer<typeof updateFoodSchema>;
export type UseFoodInput = z.infer<typeof useFoodSchema>;
export type PreferencesInput = z.infer<typeof preferencesSchema>;
export type DeliveryInput = z.infer<typeof deliverySchema>;
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
export type PushActionInput = z.infer<typeof pushActionSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type BulkCreateInput = z.infer<typeof bulkCreateSchema>;
export type FavouriteInput = z.infer<typeof favouriteSchema>;
export type OpenFoodInput = z.infer<typeof openFoodSchema>;
export type MoveFoodInput = z.infer<typeof moveFoodSchema>;
