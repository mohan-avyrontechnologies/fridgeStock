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
    return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
