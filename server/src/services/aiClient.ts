import Anthropic from '@anthropic-ai/sdk';
import { env, type AiConfig } from '../config/env.js';
import { createGeminiClient } from './geminiClient.js';

/** An image sent with a request (receipt scanning, and Photo Check later). */
export interface AiImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}

/**
 * How much model the request needs. "fast" is for reading text off a photo; "smart" for naming food in a
 * photo and for writing ideas. A provider with one model for both (Claude) ignores it.
 */
export type AiTier = 'fast' | 'smart';

/** Tokens a request used, reported to an optional `onUsage` callback (the evaluation script prices them). */
export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiRequest {
  system: string;
  prompt: string;
  /** JSON schema the answer must follow (structured outputs). */
  schema: Record<string, unknown>;
  maxTokens: number;
  images?: AiImage[];
  tier?: AiTier;
}

/**
 * Thrown when the provider says it is out of capacity (HTTP 429, or a quota error) and a retry did not
 * help. The service turns it into the friendly "AI is busy" message instead of a failure.
 */
export class AiBusyError extends Error {
  constructor(cause?: unknown) {
    super('The AI provider is rate-limited or out of quota.', { cause });
    this.name = 'AiBusyError';
  }
}

/** True for HTTP 429, a quota or rate-limit message, or an overloaded provider (529), from either SDK. */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof AiBusyError) return true;
  const e = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  if ([e.status, e.code].some((value) => value === 429 || value === 529 || value === '429')) return true;
  return (
    typeof e.message === 'string' && /\b429\b|quota|rate.?limit|RESOURCE_EXHAUSTED|too many requests/i.test(e.message)
  );
}

/** How long to wait before the one retry after a rate limit. */
export const RATE_LIMIT_BACKOFF_MS = 2000;

/**
 * Wraps a client so a rate limit gets one retry after a pause, then becomes an AiBusyError. Any other
 * error passes through untouched. Both providers go through this, so they behave the same.
 */
export function withRateLimitRetry(
  inner: AiClient,
  options: { backoffMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): AiClient {
  const { backoffMs = RATE_LIMIT_BACKOFF_MS, sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)) } =
    options;
  return {
    model: inner.model,
    async generate(request) {
      try {
        return await inner.generate(request);
      } catch (first) {
        if (!isRateLimitError(first)) throw first;
        await sleep(backoffMs);
        try {
          return await inner.generate(request);
        } catch (second) {
          if (isRateLimitError(second)) throw new AiBusyError(second);
          throw second;
        }
      }
    },
  };
}

/**
 * The only way the app talks to an AI model. Services depend on this
 * interface, and every test uses a fake one, so no test calls a real API.
 * The result is unchecked JSON: callers validate it with zod.
 */
export interface AiClient {
  readonly model: string;
  generate(request: AiRequest): Promise<unknown>;
}

/** The slice of the Anthropic SDK this client uses (replaceable in tests). */
export interface MessagesApi {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
}

/** Claude via the official @anthropic-ai/sdk, with JSON structured outputs. */
export function createClaudeClient(
  config: { apiKey: string; model: string; onUsage?: (usage: AiUsage) => void },
  // Retries are ours (withRateLimitRetry), so the SDK's own are off: one policy for both providers.
  messages: MessagesApi = new Anthropic({ apiKey: config.apiKey, maxRetries: 0, timeout: 60_000 }).messages,
): AiClient {
  return {
    model: config.model,
    async generate({ system, prompt, schema, maxTokens, images = [] }) {
      const response = await messages.create({
        model: config.model,
        max_tokens: maxTokens,
        system,
        messages: [
          {
            role: 'user',
            content: [
              ...images.map((image) => ({
                type: 'image' as const,
                source: { type: 'base64' as const, media_type: image.mediaType, data: image.base64 },
              })),
              { type: 'text' as const, text: prompt },
            ],
          },
        ],
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      });
      config.onUsage?.({
        model: config.model,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      });
      if (response.stop_reason !== 'end_turn') throw new Error(`AI stopped early: ${response.stop_reason}`);
      const text = response.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
      return JSON.parse(text);
    },
  };
}

/** The client for the configured provider, with rate limits handled. A null config means AI is off. */
export function createAiClient(config: AiConfig | null): AiClient | null {
  if (!config) return null;
  return withRateLimitRetry(config.provider === 'gemini' ? createGeminiClient(config) : createClaudeClient(config));
}

let client: AiClient | null = createAiClient(env.ai);

/** The configured AI client, or null when AI features are off. */
export function aiClient(): AiClient | null {
  return client;
}

/** Swaps the client (tests use a fake one). */
export function setAiClient(next: AiClient | null): void {
  client = next;
}
