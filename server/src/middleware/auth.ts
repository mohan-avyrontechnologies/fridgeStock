import type { NextFunction, Request, Response } from 'express';
import { UserModel, type UserDoc } from '../models/User.js';
import { verifyToken } from '../services/token.js';
import { unauthenticated } from '../utils/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserDoc;
    }
  }
}

/**
 * Verifies the bearer token and attaches the user. Controllers identify the
 * data owner only through req.user, never from the body or query string.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthenticated();

  const userId = verifyToken(token);
  if (!userId) throw unauthenticated();

  const user = await UserModel.findById(userId);
  if (!user) throw unauthenticated();

  req.user = user;
  next();
}

export function currentUser(req: Request): UserDoc {
  if (!req.user) throw unauthenticated();
  return req.user;
}
