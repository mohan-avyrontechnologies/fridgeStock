import { randomUUID } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { clock } from './clock.js';

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
const MEAL_ACTION_AUDIENCE = 'meal-action';
/** How long the buttons on a push notification keep working, in seconds: a day, until the next reminders. */
export const ACTION_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/** Who and what a notification's token is for, plus its own id (jti) and when it stops working. */
interface ActionClaims {
  userId: string;
  jti: string;
  expiresAt: Date;
}

const nowSeconds = () => Math.floor(clock.now().getTime() / 1000);

/** Signed with the app's clock, so tests can move time on; every token gets its own id. */
function signAction(claims: Record<string, string>, userId: string, audience: string): string {
  return jwt.sign({ ...claims, iat: nowSeconds() }, env.jwtSecret, {
    algorithm: 'HS256',
    subject: userId,
    audience,
    expiresIn: ACTION_TOKEN_TTL_SECONDS,
    jwtid: randomUUID(),
  });
}

/** The token's claims if it is genuine, for this audience and not expired; null otherwise. */
function verifyAction<K extends string>(
  token: string,
  audience: string,
  fields: readonly K[],
): (ActionClaims & Record<K, string>) | null {
  try {
    const payload = jwt.verify(token, env.jwtSecret, {
      algorithms: ['HS256'],
      audience,
      clockTimestamp: nowSeconds(),
    });
    if (
      typeof payload !== 'object' ||
      typeof payload.sub !== 'string' ||
      typeof payload.jti !== 'string' ||
      typeof payload.exp !== 'number' ||
      fields.some((field) => typeof payload[field] !== 'string')
    ) {
      return null;
    }
    const extra = Object.fromEntries(fields.map((field) => [field, payload[field] as string])) as Record<K, string>;
    return { ...extra, userId: payload.sub, jti: payload.jti, expiresAt: new Date(payload.exp * 1000) };
  } catch {
    return null;
  }
}

/**
 * A narrow token carried inside one push notification, so its "Used" and "Snooze" buttons work without the
 * login token. It names one user and one food item, works for a day, can carry out one action once (see
 * pushActionService), and can't be used to sign in. Each notification gets a new one.
 */
export function signActionToken(userId: string, foodId: string): string {
  return signAction({ foodId }, userId, ACTION_AUDIENCE);
}

export function verifyActionToken(token: string) {
  return verifyAction(token, ACTION_AUDIENCE, ['foodId']);
}

/**
 * Like an action token, but for a meal reminder's "Snooze 30 min": it names one user, one meal and one day
 * (not a food item), and can't be used to sign in or to act on food.
 */
export function signMealActionToken(userId: string, meal: string, date: string): string {
  return signAction({ meal, date }, userId, MEAL_ACTION_AUDIENCE);
}

export function verifyMealActionToken(token: string) {
  return verifyAction(token, MEAL_ACTION_AUDIENCE, ['meal', 'date']);
}
