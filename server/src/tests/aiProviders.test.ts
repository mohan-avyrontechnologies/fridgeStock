import { BANNED_PHRASES } from '@fridgestock/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aiProviderFrom,
  aiStartupWarnings,
  DEFAULT_GEMINI_MODEL_FAST,
  DEFAULT_GEMINI_MODEL_SMART,
  type AiConfig,
} from '../config/env.js';
import { AiUsageModel } from '../models/AiUsage.js';
import {
  AiBusyError,
  createAiClient,
  createClaudeClient,
  isRateLimitError,
  setAiClient,
  withRateLimitRetry,
  type AiClient,
  type AiRequest,
  type MessagesApi,
} from '../services/aiClient.js';
import { createGeminiClient, type GeminiModelsApi } from '../services/geminiClient.js';
import { api, registerUser, setToday } from './helpers.js';

/**
 * The AI provider is switchable (AI_PROVIDER). Both providers sit behind the same AiClient interface, so the
 * same answers must come out of each, through the same checks. Every API below is a mock: no real call is made.
 */

// A banned phrase is taken from the shared list so this file never spells one out (the source guard scans it).
const BANNED = BANNED_PHRASES[1];

afterEach(() => {
  setAiClient(null);
  vi.restoreAllMocks();
});

const noSleep = async () => {};

/** A provider whose mocked API answers with the given texts in turn (an Error is thrown instead). */
type Reply = string | Error;
interface Provider {
  name: string;
  /** A client plus the mock that stands in for the provider's API. */
  build(replies: Reply[]): { client: AiClient; calls: unknown[] };
}

function claudeProvider(): Provider {
  return {
    name: 'anthropic',
    build(replies) {
      const calls: unknown[] = [];
      const messages = {
        create: vi.fn(async (params: unknown) => {
          calls.push(params);
          const reply = replies.length > 1 ? replies.shift()! : replies[0]!;
          if (reply instanceof Error) throw reply;
          return {
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: reply }],
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        }),
      } as unknown as MessagesApi;
      return { client: createClaudeClient({ apiKey: 'test', model: 'claude-test' }, messages), calls };
    },
  };
}

function geminiProvider(): Provider {
  return {
    name: 'gemini',
    build(replies) {
      const calls: unknown[] = [];
      const models = {
        generateContent: vi.fn(async (params: unknown) => {
          calls.push(params);
          const reply = replies.length > 1 ? replies.shift()! : replies[0]!;
          if (reply instanceof Error) throw reply;
          return {
            text: reply,
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          };
        }),
      } as unknown as GeminiModelsApi;
      return {
        client: createGeminiClient({ apiKey: 'test', fastModel: 'fast-test', smartModel: 'smart-test' }, models),
        calls,
      };
    },
  };
}

const providers = [claudeProvider(), geminiProvider()];

const receipt = (name: string) =>
  JSON.stringify({ purchaseDate: null, items: [{ name, quantity: 1, unit: 'l', price: null }] });
const PIXEL = { mediaType: 'image/png', image: 'AAAA' };

describe.each(providers)('the $name provider, with mocked responses', (provider) => {
  async function session() {
    setToday('2026-09-29');
    return registerUser();
  }

  it('returns the same zod-validated JSON through the same endpoint', async () => {
    const { client } = provider.build([receipt('Milk')]);
    setAiClient(withRateLimitRetry(client, { sleep: noSleep }));
    const s = await session();
    const res = await s.auth(api().post('/api/parse/receipt').send(PIXEL)).expect(200);
    expect(res.body).toEqual({ purchaseDate: null, items: [{ name: 'Milk', quantity: 1, unit: 'l', price: null }] });
  });

  it('asks again when the answer uses a banned phrase, and shows only the clean one', async () => {
    const { client, calls } = provider.build([receipt(`Milk ${BANNED}`), receipt('Milk')]);
    setAiClient(withRateLimitRetry(client, { sleep: noSleep }));
    const s = await session();
    const res = await s.auth(api().post('/api/parse/receipt').send(PIXEL)).expect(200);
    expect(res.body.items[0].name).toBe('Milk');
    expect(calls).toHaveLength(2);
  });

  it('asks again when the answer is not valid JSON for the schema', async () => {
    const { client, calls } = provider.build([JSON.stringify({ nope: true }), receipt('Milk')]);
    setAiClient(withRateLimitRetry(client, { sleep: noSleep }));
    const s = await session();
    await s.auth(api().post('/api/parse/receipt').send(PIXEL)).expect(200);
    expect(calls).toHaveLength(2);
  });

  it('reads a printed date: the AI copies the text, the server works out the date', async () => {
    const { client } = provider.build([JSON.stringify({ text: '03/04/2026', kind: 'BEST_BEFORE' })]);
    setAiClient(withRateLimitRetry(client, { sleep: noSleep }));
    const s = await session();
    // 3 April 2026 is more than 30 days before 29 September, so the date is dropped; the text is still returned.
    const old = await s
      .auth(
        api()
          .post('/api/parse/date')
          .send({ ...PIXEL, locale: 'en-GB' }),
      )
      .expect(200);
    expect(old.body).toEqual({ text: '03/04/2026', printedDate: null, printedDateType: 'UNKNOWN' });
  });

  it('uses the locale for day/month order', async () => {
    const { client } = provider.build([JSON.stringify({ text: '03/10/2026', kind: 'USE_BY' })]);
    setAiClient(withRateLimitRetry(client, { sleep: noSleep }));
    const s = await session();
    const dayFirst = await s
      .auth(
        api()
          .post('/api/parse/date')
          .send({ ...PIXEL, locale: 'en-GB' }),
      )
      .expect(200);
    expect(dayFirst.body).toEqual({ text: '03/10/2026', printedDate: '2026-10-03', printedDateType: 'USE_BY' });
    // Month first it is 10 March, long past, so it is dropped.
    const monthFirst = await s
      .auth(
        api()
          .post('/api/parse/date')
          .send({ ...PIXEL, locale: 'en-US' }),
      )
      .expect(200);
    expect(monthFirst.body).toEqual({ text: '03/10/2026', printedDate: null, printedDateType: 'UNKNOWN' });
  });

  it('takes the earlier reading of an ambiguous date when no locale is given', async () => {
    const { client } = provider.build([JSON.stringify({ text: '03/04/2027', kind: 'EXPIRY' })]);
    setAiClient(withRateLimitRetry(client, { sleep: noSleep }));
    const s = await session();
    const res = await s.auth(api().post('/api/parse/date').send(PIXEL)).expect(200);
    expect(res.body).toEqual({ text: '03/04/2027', printedDate: '2027-03-04', printedDateType: 'EXPIRY' });
  });

  it('ignores a date more than two years away', async () => {
    const { client } = provider.build([JSON.stringify({ text: '01/01/2031', kind: 'BEST_BEFORE' })]);
    setAiClient(withRateLimitRetry(client, { sleep: noSleep }));
    const s = await session();
    const res = await s
      .auth(
        api()
          .post('/api/parse/date')
          .send({ ...PIXEL, locale: 'en-GB' }),
      )
      .expect(200);
    expect(res.body.printedDate).toBeNull();
  });

  it('retries a rate limit once after a pause, then succeeds', async () => {
    const limited = Object.assign(new Error('Too Many Requests'), { status: 429 });
    const { client, calls } = provider.build([limited, receipt('Milk')]);
    const sleep = vi.fn(async () => {});
    setAiClient(withRateLimitRetry(client, { sleep, backoffMs: 1500 }));
    const s = await session();
    await s.auth(api().post('/api/parse/receipt').send(PIXEL)).expect(200);
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(1500);
  });

  it('says "AI is busy" after a second rate limit, and does not use up the allowance', async () => {
    const limited = Object.assign(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'), { status: 429 });
    const { client, calls } = provider.build([limited]);
    setAiClient(withRateLimitRetry(client, { sleep: noSleep }));
    const s = await session();
    const res = await s.auth(api().post('/api/parse/receipt').send(PIXEL)).expect(503);
    expect(res.body.error).toEqual({ code: 'AI_UNAVAILABLE', message: 'AI is busy, try again later.' });
    expect(calls).toHaveLength(2);
    const usage = await AiUsageModel.findOne({ userId: s.user.id });
    expect(usage?.count ?? 0).toBe(0);
  });

  it('treats a quota error with no status code as a rate limit too', async () => {
    const quota = new Error('You exceeded your current quota, please check your plan and billing details.');
    const { client } = provider.build([quota]);
    setAiClient(withRateLimitRetry(client, { sleep: noSleep }));
    const s = await session();
    const res = await s.auth(api().post('/api/parse/receipt').send(PIXEL)).expect(503);
    expect(res.body.error.message).toBe('AI is busy, try again later.');
  });

  it('does not retry other errors as rate limits', async () => {
    const { client, calls } = provider.build([new Error('boom')]);
    const sleep = vi.fn(async () => {});
    setAiClient(withRateLimitRetry(client, { sleep }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = await session();
    const res = await s.auth(api().post('/api/parse/receipt').send(PIXEL)).expect(503);
    expect(res.body.error.message).not.toBe('AI is busy, try again later.');
    expect(sleep).not.toHaveBeenCalled();
    // The service's own three attempts, one call each.
    expect(calls).toHaveLength(3);
  });
});

describe('the Gemini client', () => {
  const request: AiRequest = {
    system: 'sys',
    prompt: 'hello',
    schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    maxTokens: 100,
    images: [{ mediaType: 'image/jpeg', base64: 'AAAA' }],
  };

  it('sends the model, system prompt, JSON schema and any images, and parses the JSON answer', async () => {
    const { client, calls } = geminiProvider().build(['{"ok":true}']);
    expect(await client.generate(request)).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({
      model: 'fast-test',
      contents: [
        { role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }, { text: 'hello' }] },
      ],
      config: {
        systemInstruction: 'sys',
        responseMimeType: 'application/json',
        responseJsonSchema: request.schema,
      },
    });
  });

  it('uses the smart model for the smart tier', async () => {
    const { client, calls } = geminiProvider().build(['{"ok":true}']);
    await client.generate({ ...request, tier: 'smart' });
    expect(calls[0]).toMatchObject({ model: 'smart-test' });
  });

  it('rejects an answer that was cut off or blocked, or has no text', async () => {
    for (const reply of [
      { text: '{', candidates: [{ finishReason: 'MAX_TOKENS' }] },
      { candidates: [{ finishReason: 'STOP' }] },
    ]) {
      const client = createGeminiClient({ apiKey: 'k', fastModel: 'f', smartModel: 's' }, {
        generateContent: async () => reply,
      } as unknown as GeminiModelsApi);
      await expect(client.generate(request)).rejects.toThrow();
    }
  });

  it('reports the tokens used, for the evaluation script', async () => {
    const onUsage = vi.fn();
    const client = createGeminiClient({ apiKey: 'k', fastModel: 'f', smartModel: 's', onUsage }, {
      generateContent: async () => ({
        text: '{}',
        candidates: [{ finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, thoughtsTokenCount: 2 },
      }),
    } as unknown as GeminiModelsApi);
    await client.generate(request);
    expect(onUsage).toHaveBeenCalledWith({ model: 'f', inputTokens: 7, outputTokens: 5 });
  });
});

describe('rate-limit detection', () => {
  it('recognises 429s, quota messages and overloaded providers', () => {
    expect(isRateLimitError(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(isRateLimitError(Object.assign(new Error('x'), { code: 429 }))).toBe(true);
    expect(isRateLimitError(Object.assign(new Error('x'), { status: 529 }))).toBe(true);
    expect(isRateLimitError(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
    expect(isRateLimitError(new Error('Quota exceeded for metric'))).toBe(true);
    expect(isRateLimitError(new AiBusyError())).toBe(true);
  });

  it('ignores other errors', () => {
    expect(isRateLimitError(new Error('network down'))).toBe(false);
    expect(isRateLimitError(Object.assign(new Error('bad request'), { status: 400 }))).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError('429')).toBe(false);
  });

  it('the wrapper passes other errors through unchanged and a second 429 becomes AiBusyError', async () => {
    const boom = new Error('boom');
    const failing: AiClient = { model: 'm', generate: async () => Promise.reject(boom) };
    await expect(withRateLimitRetry(failing, { sleep: noSleep }).generate({} as AiRequest)).rejects.toBe(boom);
    const limited: AiClient = {
      model: 'm',
      generate: async () => Promise.reject(Object.assign(new Error('x'), { status: 429 })),
    };
    await expect(withRateLimitRetry(limited, { sleep: noSleep }).generate({} as AiRequest)).rejects.toBeInstanceOf(
      AiBusyError,
    );
  });
});

describe('choosing the provider', () => {
  it('defaults to gemini in development and anthropic in production', () => {
    expect(aiProviderFrom(undefined, false)).toBe('gemini');
    expect(aiProviderFrom('', false)).toBe('gemini');
    expect(aiProviderFrom(undefined, true)).toBe('anthropic');
    expect(aiProviderFrom('', true)).toBe('anthropic');
  });

  it('can be set either way, ignoring case and spaces', () => {
    expect(aiProviderFrom(' Anthropic ', false)).toBe('anthropic');
    expect(aiProviderFrom('GEMINI', true)).toBe('gemini');
  });

  it('refuses a provider it does not know', () => {
    expect(() => aiProviderFrom('openai', false)).toThrow(/AI_PROVIDER/);
  });

  it('builds the matching client, or none when AI is off', () => {
    expect(createAiClient(null)).toBeNull();
    expect(createAiClient({ provider: 'anthropic', apiKey: 'k', model: 'claude-test' })?.model).toBe('claude-test');
    const gemini: AiConfig = { provider: 'gemini', apiKey: 'k', fastModel: 'a', smartModel: 'b', tier: 'free' };
    expect(createAiClient(gemini)?.model).toBe('a / b');
  });

  it('has default Gemini models', () => {
    expect(DEFAULT_GEMINI_MODEL_FAST).toMatch(/^gemini-/);
    expect(DEFAULT_GEMINI_MODEL_SMART).toMatch(/^gemini-/);
  });
});

describe('the startup warning', () => {
  const gemini = (tier: 'free' | 'paid'): AiConfig => ({
    provider: 'gemini',
    apiKey: 'k',
    fastModel: 'a',
    smartModel: 'b',
    tier,
  });

  it('warns when production uses a free-tier Gemini key', () => {
    const warnings = aiStartupWarnings(gemini('free'), true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/free-tier/);
  });

  it('is quiet for a paid key, for development, for Claude and when AI is off', () => {
    expect(aiStartupWarnings(gemini('paid'), true)).toEqual([]);
    expect(aiStartupWarnings(gemini('free'), false)).toEqual([]);
    expect(aiStartupWarnings({ provider: 'anthropic', apiKey: 'k', model: 'm' }, true)).toEqual([]);
    expect(aiStartupWarnings(null, true)).toEqual([]);
  });
});
