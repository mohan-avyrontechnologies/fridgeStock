import type { PushActionInput } from '@cook-first/shared';
import { findUserById } from './authService.js';
import { unauthenticated } from './errors.js';
import * as foodService from './foodService.js';
import * as mealReminderService from './mealReminderService.js';
import { verifyActionToken, verifyMealActionToken } from './token.js';

/**
 * A "Used" or "Snooze" button tapped on a push notification. The service
 * worker has no login token, so the notification carries an action token that
 * names exactly one user and one item. Anything that fails here (an expired
 * token, an item already closed) makes the service worker open Food Details
 * instead.
 */
export async function handleAction({ token, action }: PushActionInput): Promise<void> {
  // "Snooze 30 min" on a meal reminder carries a meal token (one person, one meal, one day) instead.
  if (action === 'SNOOZE_MEAL') {
    const meal = verifyMealActionToken(token);
    if (!meal || !mealReminderService.isMeal(meal.meal)) throw unauthenticated();
    const owner = await findUserById(meal.userId);
    if (!owner) throw unauthenticated();
    await mealReminderService.snoozeMeal(owner, meal.meal, meal.date);
    return;
  }
  const claims = verifyActionToken(token);
  if (!claims) throw unauthenticated();
  const user = await findUserById(claims.userId);
  if (!user) throw unauthenticated();

  if (action === 'USED') await foodService.useFood(user, claims.foodId, {});
  else await foodService.snoozeFood(user, claims.foodId);
}
