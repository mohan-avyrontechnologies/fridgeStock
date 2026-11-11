import { z } from 'zod';
import validationMessages from '../data/validation-messages.json' with { type: 'json' };
import { isValidBarcode } from './barcode.js';
import { isValidDate } from './dates.js';
import {
  CURRENCIES,
  MEAL_TYPES,
  PRINTED_DATE_TYPES,
  PUSH_ACTIONS,
  REMINDER_MODES,
  STORAGE_LOCATIONS,
  UNITS,
} from './enums.js';

/**
 * Request schemas. The server's check is the only one that counts; the client
 * runs the same schemas purely so forms respond instantly with the same
 * messages.
 */

/** Leftovers kept anywhere but the freezer can have a lifespan of at most this many days. */
export const LEFTOVER_MAX_DAYS = 4;

/**
 * Validation messages, from shared/data/validation-messages.json (the Python server reads the same file). The API
 * and forms must use exactly these wordings.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { description, ...messages } = validationMessages;
export const MESSAGES = messages;

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

/** Deleting the account needs the password again. */
export const deleteAccountSchema = z.object({
  password: z.string({ error: MESSAGES.loginPassword }).min(1, MESSAGES.loginPassword),
});

/** An invite code is 8 letters and digits; people may type it with a dash, spaces or lower case. */
export const joinHouseholdSchema = z.object({
  code: z
    .string({ error: MESSAGES.inviteCode })
    .trim()
    .transform((value) => value.replace(/[\s-]/g, '').toUpperCase())
    .pipe(z.string().min(1, MESSAGES.inviteCode).max(20, MESSAGES.inviteInvalid)),
});

/** DELETE /household/invites/:code: the same code, written the same ways. */
export const inviteCodeParamSchema = joinHouseholdSchema;

export const updateAccountSchema = z
  .object({
    name,
    timeZone: z.string(),
    currency: z.enum(CURRENCIES, { error: MESSAGES.currency }),
    /** Keep a photo with each food item you add by camera. */
    savePhotos: z.boolean(),
    /** The first-run guide was finished or skipped. */
    firstRunDone: z.boolean(),
  })
  .partial();

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
  leftover: z.boolean().optional(),
  /** What the whole quantity cost. Optional; used only for the money saved and lost on Insights. */
  price: z.number({ error: MESSAGES.price }).min(0, MESSAGES.price).max(100_000, MESSAGES.price).nullable().optional(),
};

/**
 * The expiry date is not a field: the server always calculates it from the
 * added date and lifespan. Unknown keys (such as an expiry date) are dropped.
 */
export const createFoodSchema = z.object({
  ...foodFields,
  /** Left out: today (the receipt date for a receipt item) in the person's time zone. */
  addedDate: foodFields.addedDate.optional(),
  /** Left out: the server estimates the expected expiry. Given: the person set it, and the source is USER. */
  lifespanDays: foodFields.lifespanDays.optional(),
  /** A date read from the pack (a calendar date from the date reader). */
  printedDate: z
    .string({ error: MESSAGES.printedDate })
    .refine(isValidDate, MESSAGES.printedDate)
    .nullable()
    .optional(),
  printedDateType: z.enum(PRINTED_DATE_TYPES, { error: MESSAGES.printedDateType }).nullable().optional(),
  /** A free-text category, such as a photo check's, used if the catalog has no entry for the food. */
  category: z.string().trim().max(40).optional(),
});

export const updateFoodSchema = z
  .object(foodFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update.');

/** A browser language tag such as "en-GB". Decides whether a printed 03/04 means 3 April or 4 March. */
const locale = z
  .string({ error: MESSAGES.locale })
  .trim()
  .max(35, MESSAGES.locale)
  .regex(/^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/, MESSAGES.locale);

/** The longest base64 text accepted for a receipt photo (about 3 MB of image). */
export const MAX_RECEIPT_BASE64 = 4_000_000;
/** Photos are scaled down to this many pixels on their longest side before they are sent. */
export const RECEIPT_MAX_SIDE = 1600;

/** POST /parse/receipt: one photo, as base64 text without the "data:" prefix. */
export const receiptSchema = z.object({
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp'], { error: MESSAGES.receiptImage }),
  image: z
    .string({ error: MESSAGES.receiptImage })
    .min(1, MESSAGES.receiptImage)
    .max(MAX_RECEIPT_BASE64, MESSAGES.receiptTooBig)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, MESSAGES.receiptImage),
});

/** GET /products/barcode/:code */
export const barcodeSchema = z.object({
  code: z
    .string({ error: MESSAGES.barcode })
    .transform((value) => value.replace(/[\s-]/g, ''))
    .refine(isValidBarcode, MESSAGES.barcode),
});

/** One row of a bulk add; the added date (and default storage) come from the request. */
const bulkItem = z.object({
  name: foodFields.name,
  quantity,
  unit: foodFields.unit,
  /** Left out: estimated by the server. Given: the person set it (source USER). */
  lifespanDays: foodFields.lifespanDays.optional(),
  storage: foodFields.storage,
  notes: foodFields.notes,
  price: foodFields.price,
  /** A date read off the pack and a free-text category (see createFoodSchema). */
  printedDate: z
    .string({ error: MESSAGES.printedDate })
    .refine(isValidDate, MESSAGES.printedDate)
    .nullable()
    .optional(),
  printedDateType: z.enum(PRINTED_DATE_TYPES, { error: MESSAGES.printedDateType }).nullable().optional(),
  category: z.string().trim().max(40).optional(),
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
/** A device token from Firebase Cloud Messaging (native apps). Opaque text, a couple of hundred characters. */
const nativeToken = z
  .string({ error: MESSAGES.pushSubscription })
  .min(20, MESSAGES.pushSubscription)
  .max(4096, MESSAGES.pushSubscription)
  .regex(/^\S+$/, MESSAGES.pushSubscription);

const browserName = z.string().trim().max(40).optional();

/**
 * POST /push/subscriptions. A browser sends its Web Push subscription (the platform may be left out); the
 * Android or iOS app sends its Firebase device token and says which it is.
 */
export const pushSubscriptionSchema = z.union(
  [
    z.object({
      platform: z.literal('web').optional(),
      endpoint: pushEndpoint,
      keys: z.object({ p256dh: pushKey, auth: pushKey }, { error: MESSAGES.pushSubscription }),
      browser: browserName,
    }),
    z.object({
      platform: z.enum(['android', 'ios'], { error: MESSAGES.pushSubscription }),
      token: nativeToken,
      browser: browserName,
    }),
  ],
  { error: MESSAGES.pushSubscription },
);

/** DELETE /push/subscriptions */
export const pushUnsubscribeSchema = z.union([z.object({ endpoint: pushEndpoint }), z.object({ token: nativeToken })], {
  error: MESSAGES.pushSubscription,
});

/** POST /push/actions: sent by the service worker when a notification button is tapped. */
export const pushActionSchema = z.object({
  token: z.string().min(1).max(2000),
  action: z.enum([...PUSH_ACTIONS, 'SNOOZE_MEAL'], { error: MESSAGES.pushAction }),
});

/** A time of day, "HH:mm" (24-hour). */
const clockTime = z.string({ error: MESSAGES.clockTime }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, MESSAGES.clockTime);

/** PUT /notifications/alerts: sounds, vibration and quiet hours. Any part may be sent. */
export const alertSettingsSchema = z
  .object({
    sound: z.boolean(),
    vibration: z.boolean(),
    quietHours: z.object({ enabled: z.boolean(), start: clockTime, end: clockTime }).partial().strict(),
  })
  .partial()
  .strict();

/** PUT /notifications/meals: each meal's switch and time. Any part may be sent. */
const mealSettingSchema = z.object({ enabled: z.boolean(), time: clockTime }).partial().strict();
export const mealRemindersSchema = z
  .object(
    Object.fromEntries(MEAL_TYPES.map((meal) => [meal, mealSettingSchema])) as Record<
      (typeof MEAL_TYPES)[number],
      typeof mealSettingSchema
    >,
  )
  .partial()
  .strict();

/** POST /ai/recipes: which meal the ideas are for (so breakfast ideas suit breakfast). */
export const recipesRequestSchema = z.object({ mealType: z.enum(MEAL_TYPES, { error: MESSAGES.mealType }).optional() });

/** GET /meal-reminders/:meal */
export const mealParamSchema = z.object({ meal: z.enum(MEAL_TYPES, { error: MESSAGES.mealType }) });

/** PUT and DELETE /meal-plan/:date: a real calendar date (whether it is in this week is the service's check). */
export const mealDateParamSchema = z.object({
  date: z.string({ error: MESSAGES.mealDate }).refine(isValidDate, MESSAGES.mealDate),
});

/** DELETE /meal-plan/:date?meal=: which meal; leaving it out means dinner. */
export const mealQuerySchema = z.object({
  meal: z.enum(MEAL_TYPES, { error: MESSAGES.mealType }).default('dinner'),
});

/** POST /shopping */
export const shoppingItemSchema = z.object({
  name: z
    .string({ error: MESSAGES.shoppingName })
    .trim()
    .min(1, MESSAGES.shoppingName)
    .max(60, MESSAGES.shoppingNameTooLong),
  quantity: z
    .number({ error: MESSAGES.quantity })
    .positive(MESSAGES.quantity)
    .max(100000, MESSAGES.quantity)
    .nullable()
    .optional(),
  unit: z.enum(UNITS, { error: MESSAGES.unit }).nullable().optional(),
});

/** PUT /shopping/:id */
export const shoppingUpdateSchema = shoppingItemSchema.partial().extend({ checked: z.boolean().optional() }).strict();

/**
 * An id in a request body: a 24-hex ObjectId (the Node server, on MongoDB) or a UUID (the Python server, on
 * PostgreSQL), in either case. A well-formed id that isn't one of the household's is the service's concern.
 */
const idSchema = (message: string) =>
  z.string().regex(/^(?:[0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i, message);

/** PUT /meal-plan/:date */
export const mealPlanEntrySchema = z.object({
  /** Which meal; leaving it out means dinner, as before meals were added. */
  meal: z.enum(MEAL_TYPES, { error: MESSAGES.mealType }).default('dinner'),
  title: z.string({ error: MESSAGES.mealTitle }).trim().min(1, MESSAGES.mealTitle).max(80, MESSAGES.mealTitle),
  foodIds: z.array(idSchema(MESSAGES.mealFoods), { error: MESSAGES.mealFoods }).max(10, MESSAGES.mealFoods).default([]),
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
export type JoinHouseholdInput = z.infer<typeof joinHouseholdSchema>;
export type ReceiptInput = z.infer<typeof receiptSchema>;
export type PrintedDateInput = z.infer<typeof printedDateSchema>;
export type PhotoCheckInput = z.infer<typeof photoCheckSchema>;
export type PhotoSizeInput = z.infer<typeof photoSizeSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type FoodInput = z.infer<typeof createFoodSchema>;
export type FoodUpdateInput = z.infer<typeof updateFoodSchema>;
export type UseFoodInput = z.infer<typeof useFoodSchema>;
export type PreferencesInput = z.infer<typeof preferencesSchema>;
export type DeliveryInput = z.infer<typeof deliverySchema>;
export type AlertSettingsInput = z.infer<typeof alertSettingsSchema>;
export type MealRemindersInput = z.infer<typeof mealRemindersSchema>;
export type RecipesRequest = z.infer<typeof recipesRequestSchema>;
export type ShoppingItemInput = z.infer<typeof shoppingItemSchema>;
export type ShoppingUpdateInput = z.infer<typeof shoppingUpdateSchema>;
export type MealPlanEntryInput = z.infer<typeof mealPlanEntrySchema>;
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
export type PushActionInput = z.infer<typeof pushActionSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type BulkCreateInput = z.infer<typeof bulkCreateSchema>;
export type FavouriteInput = z.infer<typeof favouriteSchema>;
export type OpenFoodInput = z.infer<typeof openFoodSchema>;
export type MoveFoodInput = z.infer<typeof moveFoodSchema>;

/** Below this confidence a photo's identification is not used to pre-fill a name (on a scale of 0 to 1). */
export const PHOTO_CONFIDENCE_MIN = 0.6;

/**
 * POST /parse/photo: a photo of food, as base64 text without the "data:" prefix.
 * `foodId` is set when the photo is of an item already in the household (Food Details).
 */
export const photoCheckSchema = receiptSchema.extend({
  foodId: idSchema(MESSAGES.photoFood).optional(),
});

/** POST /parse/date: a photo of the date on a pack (like the receipt photo), plus the person's locale. */
export const printedDateSchema = receiptSchema.extend({ locale: locale.optional() });

/** The largest product photo that can be uploaded. */
export const PRODUCT_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
/** Product photos are kept this many days after their item is closed (used, wasted or removed). */
export const PHOTO_RETENTION_DAYS = 30;
/** Stored photos: the full size is at most this many pixels on its longest side, and the thumbnail this many. */
export const PHOTO_FULL_PIXELS = 1280;
export const PHOTO_THUMB_PIXELS = 320;

/** GET /foods/:id/photo?size=thumb|full. `v` is the photo's version (its time stamp), so a new photo isn't served from a cache. */
export const photoSizeSchema = z.object({
  size: z.enum(['thumb', 'full'], { error: MESSAGES.photoSize }).default('full'),
  v: z.string().max(40).optional(),
});
