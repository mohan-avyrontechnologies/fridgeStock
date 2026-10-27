import { FOOD_REFERENCE, MESSAGES, type PhotoCheck, type PhotoCheckInput } from '@fridgestock/shared';
import { photoCheckEnabled } from '../config/features.js';
import { aiPrompts } from '../copy.js';
import { HouseholdEventModel } from '../models/HouseholdEvent.js';
import type { UserDoc } from '../models/User.js';
import * as aiService from './aiService.js';
import { aiClient } from './aiClient.js';
import { photoCheckJsonSchema, photoCheckOutput } from './aiOutputs.js';
import { aiUnavailable } from './errors.js';
import { getFood } from './foodService.js';

/**
 * Photo Check: the AI names the food in a photo and points out visible warning
 * signs. It can only report problems (the result has no field for good or
 * normal condition) and it changes nothing: the person decides what to do.
 *
 * The photo is used for this one request and is never stored or logged. Each
 * check counts toward the daily AI allowance, every piece of text is checked
 * for banned wording, and the check is recorded in the household's activity
 * log (who checked what, never the photo or the result).
 */
export async function checkPhoto(user: UserDoc, input: PhotoCheckInput): Promise<PhotoCheck> {
  if (!photoCheckEnabled() || aiClient() === null) throw aiUnavailable(MESSAGES.photoCheckOff);
  // A photo of an item already at home must be of one of this household's items.
  const food = input.foodId ? await getFood(user, input.foodId) : null;

  const result = await aiService.generate(user, {
    system: aiPrompts.photoSystem,
    prompt: aiPrompts.photo(FOOD_REFERENCE.map((item) => item.name)),
    images: [{ mediaType: input.mediaType, base64: input.image }],
    schema: photoCheckJsonSchema,
    output: photoCheckOutput,
    texts: (r) => [r.name, r.category, ...r.warningSigns.map((sign) => sign.description)],
    maxTokens: 800,
    tier: 'smart',
  });

  await HouseholdEventModel.create({
    householdId: user.householdId,
    userId: user._id,
    actorName: user.name,
    type: 'PHOTO_CHECKED',
    foodName: food?.name ?? result.name,
  });
  return result;
}
