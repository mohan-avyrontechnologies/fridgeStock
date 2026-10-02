import { UNITS } from '@cook-first/shared';
import { z } from 'zod';

/**
 * What the AI must return, twice over: a JSON schema sent with the request
 * (structured outputs can't express lengths or ranges), and the zod schema
 * every answer is checked against before anything uses it.
 */

const strings = { type: 'array', items: { type: 'string' } };

export const recipeSchema = {
  type: 'object',
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, minutes: { type: 'integer' }, uses: strings, steps: strings },
        required: ['title', 'minutes', 'uses', 'steps'],
        additionalProperties: false,
      },
    },
  },
  required: ['recipes'],
  additionalProperties: false,
};

export const recipeOutput = z.object({
  recipes: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(80),
        minutes: z.number().int().min(1).max(300),
        uses: z.array(z.string()).max(12),
        steps: z.array(z.string().trim().min(1).max(240)).min(1).max(8),
      }),
    )
    .max(5),
});
export type RecipeOutput = z.infer<typeof recipeOutput>;

export const mealPlanSchema = {
  type: 'object',
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: { date: { type: 'string', format: 'date' }, title: { type: 'string' }, uses: strings },
        required: ['date', 'title', 'uses'],
        additionalProperties: false,
      },
    },
  },
  required: ['days'],
  additionalProperties: false,
};

export const mealPlanOutput = z.object({
  days: z
    .array(
      z.object({
        date: z.string(),
        title: z.string().trim().min(1).max(80),
        uses: z.array(z.string()).max(10),
      }),
    )
    .max(14),
});
export type MealPlanOutput = z.infer<typeof mealPlanOutput>;

export const receiptJsonSchema = {
  type: 'object',
  properties: {
    purchaseDate: { type: ['string', 'null'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: 'string', enum: [...UNITS] },
          price: { type: ['number', 'null'] },
        },
        required: ['name', 'quantity', 'unit', 'price'],
        additionalProperties: false,
      },
    },
  },
  required: ['purchaseDate', 'items'],
  additionalProperties: false,
};

export const receiptOutput = z.object({
  purchaseDate: z.string().nullable(),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        quantity: z.number().positive().max(1_000_000),
        unit: z.enum(UNITS),
        price: z.number().min(0).max(100_000).nullable(),
      }),
    )
    .max(60),
});
export type ReceiptOutput = z.infer<typeof receiptOutput>;
