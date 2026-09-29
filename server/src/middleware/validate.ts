import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { validationError } from '../services/errors.js';

type Source = 'body' | 'query';
// Express 5 makes req.query read-only, so validated query values live here.
type WithQuery<T = unknown> = Request & { validatedQuery: T };

/**
 * Parses req[source] with a shared zod schema; the parsed value replaces the
 * raw input. This server-side check is the only validation that counts.
 */
export function validate(schema: ZodType, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const issue = result.error.issues[0]!;
      throw validationError(issue.message, issue.path.length ? issue.path.map(String).join('.') : undefined);
    }
    if (source === 'body') req.body = result.data;
    else (req as WithQuery).validatedQuery = result.data;
    next();
  };
}

export function validatedQuery<T>(req: Request): T {
  return (req as WithQuery<T>).validatedQuery;
}
