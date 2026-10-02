import { FOOD_REFERENCE, isValidDate, type ReceiptDraft, type ReceiptInput } from '@cook-first/shared';
import { aiPrompts } from '../copy.js';
import type { UserDoc } from '../models/User.js';
import * as aiService from './aiService.js';
import { receiptJsonSchema, receiptOutput } from './aiOutputs.js';
import { clock } from './clock.js';

/**
 * Reads the food lines off a receipt photo with the AI. The result is only a
 * draft for the person to check: nothing is saved, the photo is used for this
 * request alone (never stored or logged), and the request counts toward the
 * daily AI allowance like any other.
 */
export async function readReceipt(user: UserDoc, input: ReceiptInput): Promise<ReceiptDraft> {
  const today = clock.today(user.timeZone);
  const result = await aiService.generate(user, {
    system: aiPrompts.receiptSystem,
    prompt: aiPrompts.receipt(
      FOOD_REFERENCE.map((food) => food.name),
      today,
    ),
    images: [{ mediaType: input.mediaType, base64: input.image }],
    schema: receiptJsonSchema,
    output: receiptOutput,
    texts: (r) => r.items.map((item) => item.name),
    maxTokens: 2000,
  });

  // A date that is not a real day, or is in the future, is a misread: leave it blank.
  const { purchaseDate } = result;
  return {
    purchaseDate: purchaseDate && isValidDate(purchaseDate) && purchaseDate <= today ? purchaseDate : null,
    items: result.items.map(({ name, quantity, unit, price }) => ({
      name,
      quantity: Math.round(quantity * 1000) / 1000,
      unit,
      price: price === null ? null : Math.round(price * 100) / 100,
    })),
  };
}
