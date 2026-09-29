import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../utils/errors.js';

type Source = 'body' | 'query';
// Express 5 makes req.query read-only, so validated query values live here.
type WithQuery<T = unknown> = Request & { validatedQuery: T };

/** Parses req[source] with the schema; the parsed value replaces the raw input. */
export function validate(schema: ZodType, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const issue = result.error.issues[0]!;
      const field = issue.path.length ? String(issue.path[0]) : undefined;
      throw new AppError(400, 'VALIDATION_ERROR', issue.message, field);
    }
    if (source === 'body') req.body = result.data;
    else (req as WithQuery).validatedQuery = result.data;
    next();
  };
}

export function validatedQuery<T>(req: Request): T {
  return (req as WithQuery<T>).validatedQuery;
}
