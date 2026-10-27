import type { ErrorCode } from '@fridgestock/shared';

/** Errors thrown by services and turned into `{error: {code, message, field?}}` responses. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export const validationError = (message: string, field?: string) =>
  new AppError(400, 'VALIDATION_ERROR', message, field);

export const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');

export const foodNotFound = () => new AppError(404, 'NOT_FOUND', 'Food item not found.');

export const conflict = (message: string, field?: string) => new AppError(409, 'CONFLICT', message, field);

export const aiUnavailable = (message: string) => new AppError(503, 'AI_UNAVAILABLE', message);

export const aiLimitReached = (message: string) => new AppError(429, 'RATE_LIMITED', message);
