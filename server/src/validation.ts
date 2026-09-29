import { z } from 'zod';
import { USAGE_ACTIONS } from './models/UsageRecord.js';
import { parseDateKey } from './utils/dates.js';

const QUANTITY_MSG = 'Quantity must be a positive number.';
const LIFESPAN_MSG = 'Lifespan must be zero or a positive number of days.';
const DATE_MSG = 'Added date could not be parsed.';

const email = z
  .string({ error: 'Email is required.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address.' }));

export const registerSchema = z.object({
  name: z.string({ error: 'Name is required.' }).trim().min(1, 'Name is required.').max(80),
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

const foodFields = {
  name: z
    .string({ error: 'Food name is required.' })
    .trim()
    .min(1, 'Food name is required.')
    .max(100, 'Food name must be at most 100 characters.'),
  quantity: z
    .number({ error: QUANTITY_MSG })
    .positive(QUANTITY_MSG)
    .max(1_000_000, 'Quantity is too large.'),
  unit: z
    .string({ error: 'Unit is required.' })
    .trim()
    .min(1, 'Unit is required.')
    .max(20, 'Unit must be at most 20 characters.'),
  addedDate: z
    .string({ error: DATE_MSG })
    .refine((value) => parseDateKey(value) !== null, DATE_MSG),
  lifespanDays: z
    .number({ error: LIFESPAN_MSG })
    .int(LIFESPAN_MSG)
    .min(0, LIFESPAN_MSG)
    .max(3650, 'Lifespan can be at most 3650 days.'),
};

export const createFoodSchema = z.object(foodFields);

export const updateFoodSchema = z
  .object(foodFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update.');

export const useFoodSchema = z.object({
  action: z.enum(['USED', 'PARTIALLY_USED'] satisfies (typeof USAGE_ACTIONS)[number][], {
    error: 'Action must be USED or PARTIALLY_USED.',
  }),
  quantityUsed: z.number({ error: 'Quantity used must be a number.' }).positive(
    'Quantity used must be greater than zero.',
  ).optional(),
});

export const wasteFoodSchema = z.object({
  quantityUsed: z.number({ error: 'Quantity must be a number.' }).positive(
    'Quantity must be greater than zero.',
  ).optional(),
});

export const preferencesSchema = z
  .object({
    approachingExpiry: z.boolean(),
    due: z.boolean(),
    overdue: z.boolean(),
  })
  .partial()
  .strict();

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const updateAccountSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').max(80),
    timeZone: z.string(),
  })
  .partial();
