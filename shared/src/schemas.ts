import { z } from 'zod';
import { isValidDate } from './dates.js';
import { UNITS } from './enums.js';

/**
 * Request schemas. The server's check is the only one that counts; the client
 * runs the same schemas purely so forms respond instantly with the same
 * messages.
 */

/** Validation messages. The API and forms must use exactly these wordings. */
export const MESSAGES = {
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
} as const;

const email = z.string({ error: MESSAGES.email }).trim().toLowerCase().pipe(z.email({ error: MESSAGES.email }));

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

/** Omit `quantity` to use the whole item; a smaller quantity is a partial use. */
export const useFoodSchema = z.object({ quantity: quantity.optional() });

/** Wasting always closes the whole item; the body is ignored. */
export const wasteFoodSchema = z.object({});

export const preferencesSchema = z
  .object({ approachingExpiry: z.boolean(), due: z.boolean(), overdue: z.boolean() })
  .partial()
  .strict();

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type FoodInput = z.infer<typeof createFoodSchema>;
export type FoodUpdateInput = z.infer<typeof updateFoodSchema>;
export type UseFoodInput = z.infer<typeof useFoodSchema>;
export type PreferencesInput = z.infer<typeof preferencesSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
