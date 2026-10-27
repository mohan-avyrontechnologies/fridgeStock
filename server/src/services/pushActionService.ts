import type { PushActionInput } from '@fridgestock/shared';
import { UsedActionTokenModel } from '../models/UsedActionToken.js';
import { findUserById } from './authService.js';
import { AppError, unauthenticated } from './errors.js';
import * as foodService from './foodService.js';
import * as mealReminderService from './mealReminderService.js';
import { verifyActionToken, verifyMealActionToken } from './token.js';

const alreadyUsed = () => new AppError(401, 'UNAUTHENTICATED', 'This notification button has already been used.');

/**
 * Runs one action with a token that hasn't been used. The token is marked as used first (atomically, by its
 * unique id), so two taps can't both get through; if the action then fails, the token is given back.
 */
async function once(token: { jti: string; expiresAt: Date }, action: () => Promise<void>): Promise<void> {
  try {
    await UsedActionTokenModel.create({ jti: token.jti, expiresAt: token.expiresAt });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw alreadyUsed();
    throw error;
  }
  try {
    await action();
  } catch (error) {
    await UsedActionTokenModel.deleteOne({ jti: token.jti });
    throw error;
  }
}

/**
 * A "Used" or "Snooze" button tapped on a push notification. The service
 * worker has no login token, so the notification carries an action token that
 * names exactly one user and one item, works for a day and does one thing once.
 * Anything that fails here (an expired or used token, an item already closed)
 * makes the service worker open Food Details instead.
 */
export async function handleAction({ token, action }: PushActionInput): Promise<void> {
  // "Snooze 30 min" on a meal reminder carries a meal token (one person, one meal, one day) instead.
  if (action === 'SNOOZE_MEAL') {
    const meal = verifyMealActionToken(token);
    if (!meal || !mealReminderService.isMeal(meal.meal)) throw unauthenticated();
    const owner = await findUserById(meal.userId);
    if (!owner) throw unauthenticated();
    const which = meal.meal;
    await once(meal, () => mealReminderService.snoozeMeal(owner, which, meal.date));
    return;
  }
  const claims = verifyActionToken(token);
  if (!claims) throw unauthenticated();
  const user = await findUserById(claims.userId);
  if (!user) throw unauthenticated();

  await once(claims, async () => {
    if (action === 'USED') await foodService.useFood(user, claims.foodId, {});
    else await foodService.snoozeFood(user, claims.foodId);
  });
}
