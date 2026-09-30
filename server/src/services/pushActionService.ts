import type { PushActionInput } from '@cook-first/shared';
import { findUserById } from './authService.js';
import { unauthenticated } from './errors.js';
import * as foodService from './foodService.js';
import { verifyActionToken } from './token.js';

/**
 * A "Used" or "Snooze" button tapped on a push notification. The service
 * worker has no login token, so the notification carries an action token that
 * names exactly one user and one item. Anything that fails here (an expired
 * token, an item already closed) makes the service worker open Food Details
 * instead.
 */
export async function handleAction({ token, action }: PushActionInput): Promise<void> {
  const claims = verifyActionToken(token);
  if (!claims) throw unauthenticated();
  const user = await findUserById(claims.userId);
  if (!user) throw unauthenticated();

  if (action === 'USED') await foodService.useFood(user, claims.foodId, {});
  else await foodService.snoozeFood(user, claims.foodId);
}
