import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../services/errors.js';

export function notFoundRoute(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.field && { field: err.field }) },
    });
    return;
  }
  // A database-level rule caught something the request schema didn't.
  if (err instanceof mongoose.Error.ValidationError) {
    const [field, detail] = Object.entries(err.errors)[0] ?? [];
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: detail?.message ?? 'Invalid data.', ...(field && { field }) },
    });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON.' } });
    return;
  }
  // A request body over the size limit: say so, rather than a 500.
  if (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'VALIDATION_ERROR', message: 'That request is too large.' } });
    return;
  }
  // Log it on the server only. The response never includes a stack trace, and
  // request bodies (which may hold passwords) are never logged.
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
}
