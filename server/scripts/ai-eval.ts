/**
 * Runs one sample set against one or both AI providers, to compare accuracy and cost before choosing one for
 * production. It uses the app's own prompts, JSON schemas and zod checks, so a score here is what the app would get.
 *
 *   npm run eval:ai -w server -- --provider both
 *   npm run eval:ai -w server -- --provider gemini --samples scripts/ai-eval/samples.json
 *
 * Options:
 *   --provider anthropic|gemini|both   Which provider(s) to run (default: both, skipping any without a key)
 *   --samples <file>                   The sample set (default: scripts/ai-eval/samples.json)
 *   --images <dir>                     Where the sample images are (default: the samples file's folder)
 *   --prices <file>                    Price table (default: scripts/ai-eval/prices.json if present)
 *   --today <YYYY-MM-DD>               "Today" for the receipt prompt (default: the real date)
 *   --json                             Print the report as JSON
 *
 * Keys come from server/.env (ANTHROPIC_API_KEY, GEMINI_API_KEY, GEMINI_MODEL_FAST, GEMINI_MODEL_SMART, AI_MODEL).
 * Every sample is sent to every provider, so a run costs one request per sample per provider.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { FOOD_REFERENCE } from '@fridgestock/shared';
import type { ZodType } from 'zod';
import { DEFAULT_AI_MODEL, DEFAULT_GEMINI_MODEL_FAST, DEFAULT_GEMINI_MODEL_SMART } from '../src/config/env.js';
import { aiPrompts } from '../src/copy.js';
import {
  bannedCount,
  emptyTotals,
  report,
  scoreDate,
  scorePhoto,
  scoreReceipt,
  textsOf,
  type EvalSample,
  type EvalTask,
  type PriceTable,
  type ProviderReport,
  type ProviderTotals,
  type Score,
} from '../src/services/aiEvaluation.js';
import {
  createClaudeClient,
  withRateLimitRetry,
  type AiClient,
  type AiRequest,
  type AiTier,
  type AiUsage,
} from '../src/services/aiClient.js';
import { createGeminiClient } from '../src/services/geminiClient.js';
import {
  photoCheckJsonSchema,
  photoCheckOutput,
  printedDateJsonSchema,
  printedDateOutput,
  receiptJsonSchema,
  receiptOutput,
} from '../src/services/aiOutputs.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

interface Provider {
  name: string;
  client: AiClient;
  usage: ProviderTotals['usage'];
}

/** Builds each provider's client from the environment, with token counting. */
function providers(which: string): Provider[] {
  const built: Provider[] = [];
  const wanted = which === 'both' ? ['anthropic', 'gemini'] : [which];
  for (const name of wanted) {
    const usage: ProviderTotals['usage'] = {};
    const onUsage = ({ model, inputTokens, outputTokens }: AiUsage) => {
      const entry = (usage[model] ??= { inputTokens: 0, outputTokens: 0 });
      entry.inputTokens += inputTokens;
      entry.outputTokens += outputTokens;
    };
    if (name === 'anthropic') {
      const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
      if (!apiKey) {
        console.warn('Skipping anthropic: ANTHROPIC_API_KEY is not set.');
        continue;
      }
      const model = process.env.AI_MODEL || DEFAULT_AI_MODEL;
      built.push({
        name: `anthropic (${model})`,
        client: withRateLimitRetry(createClaudeClient({ apiKey, model, onUsage })),
        usage,
      });
    } else if (name === 'gemini') {
      const apiKey = process.env.GEMINI_API_KEY ?? '';
      if (!apiKey) {
        console.warn('Skipping gemini: GEMINI_API_KEY is not set.');
        continue;
      }
      const fastModel = process.env.GEMINI_MODEL_FAST || DEFAULT_GEMINI_MODEL_FAST;
      const smartModel = process.env.GEMINI_MODEL_SMART || DEFAULT_GEMINI_MODEL_SMART;
      const client = createGeminiClient({ apiKey, fastModel, smartModel, onUsage });
      built.push({ name: `gemini (${fastModel} / ${smartModel})`, client: withRateLimitRetry(client), usage });
    } else {
      throw new Error(`--provider must be anthropic, gemini or both (got "${which}").`);
    }
  }
  return built;
}

const MEDIA_TYPES: Record<string, 'image/jpeg' | 'image/png' | 'image/webp'> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** The request the app itself would send for a sample, plus how to check and score the answer. */
interface Prepared {
  request: AiRequest;
  output: ZodType<unknown>;
  score: (answer: never) => Score;
}

function prepare(sample: EvalSample, imagePath: string, today: string): Prepared {
  const extension = imagePath.slice(imagePath.lastIndexOf('.')).toLowerCase();
  const mediaType = MEDIA_TYPES[extension];
  if (!mediaType) throw new Error(`${sample.id}: ${extension} is not a supported image type.`);
  const images = [{ mediaType, base64: readFileSync(imagePath).toString('base64') }];
  const known = FOOD_REFERENCE.map((food) => food.name);

  if (sample.task === 'date') {
    return {
      request: {
        system: aiPrompts.dateSystem,
        prompt: aiPrompts.date(),
        images,
        schema: printedDateJsonSchema,
        maxTokens: 200,
        tier: 'fast',
      },
      output: printedDateOutput,
      score: (answer) => scoreDate(sample, answer),
    };
  }
  if (sample.task === 'receipt') {
    return {
      request: {
        system: aiPrompts.receiptSystem,
        prompt: aiPrompts.receipt(known, today),
        images,
        schema: receiptJsonSchema,
        maxTokens: 2000,
        tier: 'fast',
      },
      output: receiptOutput,
      score: (answer) => scoreReceipt(sample, answer),
    };
  }
  return {
    request: {
      system: aiPrompts.photoSystem,
      prompt: aiPrompts.photo(known),
      images,
      schema: photoCheckJsonSchema,
      maxTokens: 800,
      tier: 'smart' as AiTier,
    },
    output: photoCheckOutput,
    score: (answer) => scorePhoto(sample, answer),
  };
}

async function run(
  provider: Provider,
  samples: EvalSample[],
  imageDir: string,
  today: string,
): Promise<ProviderTotals> {
  const totals = emptyTotals(provider.name);
  totals.usage = provider.usage;
  for (const sample of samples) {
    const imagePath = resolve(imageDir, sample.image);
    if (!existsSync(imagePath)) {
      console.warn(`  ${sample.id}: image not found (${imagePath}), skipped.`);
      continue;
    }
    totals.samples += 1;
    const prepared = prepare(sample, imagePath, today);
    const started = Date.now();
    let raw: unknown;
    try {
      raw = await provider.client.generate(prepared.request);
    } catch (error) {
      totals.failed += 1;
      console.warn(
        `  ${provider.name} ${sample.id}: request failed: ${error instanceof Error ? error.message : error}`,
      );
      continue;
    }
    totals.latenciesMs.push(Date.now() - started);
    const parsed = prepared.output.safeParse(raw);
    if (!parsed.success) {
      console.warn(`  ${provider.name} ${sample.id}: answer did not match the schema.`);
      totals.scores[sample.task as EvalTask].push(0);
      continue;
    }
    totals.valid += 1;
    totals.bannedTexts += bannedCount(textsOf(sample.task, parsed.data));
    totals.scores[sample.task].push(prepared.score(parsed.data as never).score);
  }
  return totals;
}

const pct = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);
const usd = (value: number | null) =>
  value === null ? 'n/a (add the model to the price table)' : `$${value.toFixed(4)}`;

function print(reports: ProviderReport[]) {
  for (const r of reports) {
    console.log(`\n${r.provider}`);
    console.log(
      `  samples ${r.samples}, valid answers ${pct(r.validRate)}, failed requests ${r.failed}, banned-wording hits ${r.bannedTexts}`,
    );
    console.log(
      `  accuracy: overall ${pct(r.accuracy.overall)} | date ${pct(r.accuracy.date)} | receipt ${pct(r.accuracy.receipt)} | photo ${pct(r.accuracy.photo)}`,
    );
    console.log(`  average latency ${r.avgLatencyMs === null ? 'n/a' : `${Math.round(r.avgLatencyMs)} ms`}`);
    console.log(`  tokens in ${r.inputTokens}, out ${r.outputTokens}`);
    console.log(`  cost ${usd(r.costUsd)}, per 1,000 requests ${usd(r.costPer1000Usd)}`);
  }
}

async function main() {
  const samplesPath = resolve(arg('samples') ?? 'scripts/ai-eval/samples.json');
  const imageDir = resolve(arg('images') ?? dirname(samplesPath));
  const pricesPath = resolve(arg('prices') ?? 'scripts/ai-eval/prices.json');
  const today = arg('today') ?? new Date().toISOString().slice(0, 10);
  const samples = JSON.parse(readFileSync(samplesPath, 'utf-8')) as EvalSample[];
  const prices: PriceTable = existsSync(pricesPath) ? JSON.parse(readFileSync(pricesPath, 'utf-8')) : {};

  const chosen = providers(arg('provider') ?? 'both');
  if (chosen.length === 0) throw new Error('No provider has a key set. See server/.env.example.');
  console.log(`Running ${samples.length} samples against ${chosen.map((p) => p.name).join(' and ')}…`);

  const reports: ProviderReport[] = [];
  for (const provider of chosen) reports.push(report(await run(provider, samples, imageDir, today), prices));
  if (flag('json')) console.log(JSON.stringify(reports, null, 2));
  else print(reports);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
