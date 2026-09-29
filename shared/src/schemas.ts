import { z } from 'zod';
import { isValidDate } from './dates.js';
import { UNITS, USAGE_ACTIONS } from './enums.js';

/**
 * Request schemas. The server's copy is the only one that counts; the client
 * runs the same schemas purely so forms respond instantly with the same
 * messages.
 */

const QUANTITY_MSG = 'Quantity must be a positive number.';
const LIFESPAN_MSG = 'Lifespan must be zero or a positive number of days.';
const DATE_MSG = 'Added date could not be parsed.';

const email = z
  .string({ error: 'Email is required.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address.' }));

const name = z
  .string({ error: 'Name is required.' })
  .trim()
  .min(1, 'Name is required.')
  .max(50, 'Name must be at most 50 characters.');

export const registerSchema = z.object({
  name,
  email,
  password: z
    .string({ error: 'Password is required.' })
    .min(8, 'Password must be at least 8 characters.')
    .max(128, 'Password must be at most 128 characters.'),
  timeZone: z.string().optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string({ error: 'Password is required.' }).min(1, 'Password is required.'),
  timeZone: z.string().optional(),
});

export const updateAccountSchema = z.object({ name, timeZone: z.string() }).partial();

const foodFields = {
  name: z
    .string({ error: 'Food name is required.' })
    .trim()
    .min(1, 'Food name is required.')
    .max(60, 'Food name must be at most 60 characters.'),
  quantity: z.number({ error: QUANTITY_MSG }).positive(QUANTITY_MSG).max(1_000_000, 'Quantity is too large.'),
  unit: z.enum(UNITS, { error: `Unit must be one of ${UNITS.join(', ')}.` }),
  addedDate: z.string({ error: DATE_MSG }).refine(isValidDate, DATE_MSG),
  lifespanDays: z
    .number({ error: LIFESPAN_MSG })
    .int(LIFESPAN_MSG)
    .min(0, LIFESPAN_MSG)
    .max(365, 'Lifespan can be at most 365 days.'),
  notes: z.string({ error: 'Notes must be text.' }).trim().max(200, 'Notes must be at most 200 characters.').optional(),
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

export const useFoodSchema = z.object({
  action: z.enum(['USED', 'PARTIALLY_USED'] satisfies (typeof USAGE_ACTIONS)[number][], {
    error: 'Action must be USED or PARTIALLY_USED.',
  }),
  quantityUsed: z
    .number({ error: 'Quantity used must be a number.' })
    .positive('Quantity used must be greater than zero.')
    .optional(),
});

export const wasteFoodSchema = z.object({
  quantityUsed: z.number({ error: 'Quantity must be a number.' }).positive('Quantity must be greater than zero.').optional(),
});

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
export type WasteFoodInput = z.infer<typeof wasteFoodSchema>;
export type PreferencesInput = z.infer<typeof preferencesSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
