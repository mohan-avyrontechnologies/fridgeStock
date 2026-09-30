/** Limits for AI features (Phase 4). */

/** AI requests each user can make per calendar day (in their time zone). A request that fails isn't counted. */
export const AI_DAILY_LIMIT = 20;

/** Attempts per request: a result that fails validation or uses banned wording is asked for again. */
export const AI_ATTEMPTS = 3;

/** Shared with the client, which checks it before saving. */
export { LEFTOVER_MAX_DAYS } from '@cook-first/shared';
