import type { NextFunction, Request, Response } from 'express';
import type { UserDoc } from '../models/User.js';
import { findUserById } from '../services/authService.js';
import { unauthenticated } from '../services/errors.js';
import { verifyToken } from '../services/token.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserDoc;
    }
  }
}

/**
 * Verifies the bearer token and attaches the user. The user's identity comes
 * only from here: never from the body, query string or URL.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthenticated();

  const userId = verifyToken(token);
  if (!userId) throw unauthenticated();

  const user = await findUserById(userId);
  if (!user) throw unauthenticated();

  req.user = user;
  next();
}

export function currentUser(req: Request): UserDoc {
  if (!req.user) throw unauthenticated();
  return req.user;
}
