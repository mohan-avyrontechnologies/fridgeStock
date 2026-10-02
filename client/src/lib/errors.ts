import { ApiError } from '../api/client';
import { errorCopy } from '../copy';

/**
 * Turns anything that went wrong into one clear sentence: what happened, and what to do about it.
 * `whatFailed` finishes "Couldn’t …": for example "save that" or "mark Spinach as used".
 *
 * - no connection → say so, and to check it;
 * - signed out → say the session ended, and to sign in again;
 * - the server refused it with a reason (a mistake in what was typed, a limit) → that reason, which is specific;
 * - the server had a problem, or anything unexpected → say it isn't their fault, and to try again shortly.
 */
export function describeError(error: unknown, whatFailed: string): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return errorCopy.offline(whatFailed);
    if (error.status === 401 && error.code === 'UNAUTHENTICATED') return errorCopy.signedOut(whatFailed);
    if (error.status === 429) return error.message || errorCopy.tooMany(whatFailed);
    if (error.status >= 500) return errorCopy.serverProblem(whatFailed);
    if (error.message) return error.message;
  }
  return errorCopy.unexpected(whatFailed);
}
