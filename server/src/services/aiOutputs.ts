import { PRINTED_DATE_TYPES, UNITS, WARNING_SIGN_TYPES } from '@cook-first/shared';
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

/**
 * Photo Check. The answer has a name, a category, how sure it is, and a list of
 * visible problems. There is no field for good or normal condition, and `strict()`
 * rejects anything outside this shape, so the AI has nowhere to put one.
 */
export const photoCheckJsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    category: { type: 'string' },
    confidence: { type: 'number' },
    warningSigns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...WARNING_SIGN_TYPES] },
          description: { type: 'string' },
        },
        required: ['type', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'category', 'confidence', 'warningSigns'],
  additionalProperties: false,
};

export const photoCheckOutput = z
  .object({
    name: z.string().trim().min(1).max(60),
    category: z.string().trim().min(1).max(40),
    confidence: z.number().min(0).max(1),
    warningSigns: z
      .array(
        z
          .object({
            type: z.enum(WARNING_SIGN_TYPES),
            description: z.string().trim().min(1).max(120),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();
export type PhotoCheckOutput = z.infer<typeof photoCheckOutput>;

/**
 * Reading the date printed on a pack. The AI copies the text it can see and says what the date is called;
 * it has no field for a lifespan or a number of days, and the text is turned into a date by
 * parsePrintedDate (using the person's locale), not by the AI.
 */
export const printedDateJsonSchema = {
  type: 'object',
  properties: {
    text: { type: ['string', 'null'] },
    kind: { type: 'string', enum: [...PRINTED_DATE_TYPES] },
  },
  required: ['text', 'kind'],
  additionalProperties: false,
};

export const printedDateOutput = z
  .object({
    text: z.string().trim().max(40).nullable(),
    kind: z.enum(PRINTED_DATE_TYPES),
  })
  .strict();
export type PrintedDateOutput = z.infer<typeof printedDateOutput>;
