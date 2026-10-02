import { hasBannedWording, type AiStatus } from '@cook-first/shared';
import type { z } from 'zod';
import { AI_ATTEMPTS, AI_DAILY_LIMIT } from '../config/ai.js';
import { aiCopy, aiPrompts } from '../copy.js';
import { AiUsageModel } from '../models/AiUsage.js';
import type { UserDoc } from '../models/User.js';
import { aiClient, type AiImage } from './aiClient.js';
import { clock } from './clock.js';
import { aiLimitReached, aiUnavailable } from './errors.js';

export async function status(user: UserDoc): Promise<AiStatus> {
  const usage = await AiUsageModel.findOne({ userId: user._id, date: clock.today(user.timeZone) });
  return { enabled: aiClient() !== null, dailyLimit: AI_DAILY_LIMIT, usedToday: usage?.count ?? 0 };
}

/** Counts one request against today's limit, atomically; throws when the limit is reached. */
async function reserve(user: UserDoc): Promise<string> {
  const date = clock.today(user.timeZone);
  try {
    // Once the count reaches the limit the filter stops matching and the upsert
    // collides with the existing document: that duplicate-key error means "limit reached".
    await AiUsageModel.updateOne(
      { userId: user._id, date, count: { $lt: AI_DAILY_LIMIT } },
      { $inc: { count: 1 } },
      { upsert: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw aiLimitReached(aiCopy.limitReached(AI_DAILY_LIMIT));
    throw error;
  }
  return date;
}

/** A request that produced nothing usable doesn't use up the user's allowance. */
async function refund(user: UserDoc, date: string): Promise<void> {
  await AiUsageModel.updateOne({ userId: user._id, date, count: { $gt: 0 } }, { $inc: { count: -1 } });
}

export interface AiTask<T> {
  prompt: string;
  /** JSON schema for structured outputs (no min/max: the API doesn't support them). */
  schema: Record<string, unknown>;
  /** The full check, including limits the JSON schema can't express. */
  output: z.ZodType<T>;
  /** Every piece of text in the result that a user might see. */
  texts: (result: T) => string[];
  maxTokens: number;
  /** Replaces the default system prompt (the receipt reader is not about Cook First codes). */
  system?: string;
  /** Photos sent with the prompt. Used for this request only: never stored or logged. */
  images?: AiImage[];
}

/**
 * Runs one AI request for a user:
 * 1. AI must be enabled, and the request counts toward the daily limit.
 * 2. The answer is validated with zod.
 * 3. If any text uses banned wording (or calls food "safe"), or the answer is
 *    invalid, it is asked for again, up to AI_ATTEMPTS times in all.
 * 4. If no attempt passes, the request is refunded and a 503 is returned.
 */
export async function generate<T>(user: UserDoc, task: AiTask<T>): Promise<T> {
  const client = aiClient();
  if (!client) throw aiUnavailable(aiCopy.notEnabled);
  const date = await reserve(user);

  let prompt = task.prompt;
  for (let attempt = 1; attempt <= AI_ATTEMPTS; attempt++) {
    let raw: unknown;
    try {
      raw = await client.generate({
        system: task.system ?? aiPrompts.system,
        prompt,
        schema: task.schema,
        maxTokens: task.maxTokens,
        images: task.images,
      });
    } catch (error) {
      console.error('AI request failed', error instanceof Error ? error.message : error);
      continue;
    }
    const parsed = task.output.safeParse(raw);
    if (!parsed.success) {
      prompt = `${task.prompt}\n\n${aiPrompts.fixFormat}`;
      continue;
    }
    if (task.texts(parsed.data).some(hasBannedWording)) {
      prompt = `${task.prompt}\n\n${aiPrompts.fixWording}`;
      continue;
    }
    return parsed.data;
  }

  await refund(user, date);
  throw aiUnavailable(aiCopy.failed);
}
