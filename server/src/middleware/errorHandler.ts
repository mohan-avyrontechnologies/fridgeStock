import type { NextFunction, Request, Response } from 'express';
import { MESSAGES } from '@fridgestock/shared';
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
  // An upload the file parser refused: too big, or not one file called "photo".
  if (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'MulterError') {
    const tooBig = (err as { code?: string }).code === 'LIMIT_FILE_SIZE';
    res.status(tooBig ? 413 : 400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: tooBig ? MESSAGES.photoTooBig : MESSAGES.photoMissing,
        field: 'photo',
      },
    });
    return;
  }
  // A request body over the size limit: say so, rather than a 500.
  if (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'VALIDATION_ERROR', message: 'That request is too large.' } });
    return;
  }
  // Any other body the parser couldn't read (an unknown or corrupt Content-Encoding, for example) is the
  // client's mistake: keep the parser's 4xx status, with our own message rather than the parser's.
  const status = (err as { status?: unknown } | null)?.status;
  if (
    (err as { expose?: unknown } | null)?.expose === true &&
    typeof status === 'number' &&
    status >= 400 &&
    status < 500
  ) {
    res.status(status).json({ error: { code: 'VALIDATION_ERROR', message: "The request body couldn't be read." } });
    return;
  }
  // Log it on the server only. The response never includes a stack trace, and
  // request bodies (which may hold passwords) are never logged.
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
}
