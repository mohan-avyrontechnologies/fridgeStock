import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

/** HS256 JWT whose payload carries only the user id (TDD §7.1). */
export function signToken(userId: string): string {
  return jwt.sign({}, env.jwtSecret, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
    // Tokens with an audience (such as notification-action tokens) are never login tokens.
    if (typeof payload !== 'object' || payload.aud !== undefined) return null;
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

const ACTION_AUDIENCE = 'push-action';
/** How long the buttons on a push notification keep working. */
export const ACTION_TOKEN_TTL = '7d';

/**
 * A narrow token carried inside one push notification, so its "Used" and
 * "Snooze" buttons work without the login token. It names one user and one
 * food item, and can't be used to sign in.
 */
export function signActionToken(userId: string, foodId: string): string {
  return jwt.sign({ foodId }, env.jwtSecret, {
    algorithm: 'HS256',
    subject: userId,
    audience: ACTION_AUDIENCE,
    expiresIn: ACTION_TOKEN_TTL,
  });
}

export function verifyActionToken(token: string): { userId: string; foodId: string } | null {
  try {
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'], audience: ACTION_AUDIENCE });
    if (typeof payload !== 'object' || typeof payload.sub !== 'string' || typeof payload.foodId !== 'string') {
      return null;
    }
    return { userId: payload.sub, foodId: payload.foodId };
  } catch {
    return null;
  }
}

const MEAL_ACTION_AUDIENCE = 'meal-action';

/**
 * Like an action token, but for a meal reminder's "Snooze 30 min": it names one user, one meal and one day
 * (not a food item), and can't be used to sign in or to act on food.
 */
export function signMealActionToken(userId: string, meal: string, date: string): string {
  return jwt.sign({ meal, date }, env.jwtSecret, {
    algorithm: 'HS256',
    subject: userId,
    audience: MEAL_ACTION_AUDIENCE,
    expiresIn: '1d',
  });
}

export function verifyMealActionToken(token: string): { userId: string; meal: string; date: string } | null {
  try {
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'], audience: MEAL_ACTION_AUDIENCE });
    if (
      typeof payload !== 'object' ||
      typeof payload.sub !== 'string' ||
      typeof payload.meal !== 'string' ||
      typeof payload.date !== 'string'
    ) {
      return null;
    }
    return { userId: payload.sub, meal: payload.meal, date: payload.date };
  } catch {
    return null;
  }
}
