import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';

/** An image sent with a request (Photo Check, a later phase). */
export interface AiImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}

export interface AiRequest {
  system: string;
  prompt: string;
  /** JSON schema the answer must follow (structured outputs). */
  schema: Record<string, unknown>;
  maxTokens: number;
  images?: AiImage[];
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
  config: { apiKey: string; model: string },
  messages: MessagesApi = new Anthropic({ apiKey: config.apiKey, maxRetries: 2, timeout: 60_000 }).messages,
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
      if (response.stop_reason !== 'end_turn') throw new Error(`AI stopped early: ${response.stop_reason}`);
      const text = response.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
      return JSON.parse(text);
    },
  };
}

let client: AiClient | null = env.ai ? createClaudeClient(env.ai) : null;

/** The configured AI client, or null when AI features are off. */
export function aiClient(): AiClient | null {
  return client;
}

/** Swaps the client (tests use a fake one). */
export function setAiClient(next: AiClient | null): void {
  client = next;
}
