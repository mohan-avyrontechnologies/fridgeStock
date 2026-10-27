import { hasBannedWording, parsePrintedDate, type PrintedDateType } from '@fridgestock/shared';
import type { PhotoCheckOutput, PrintedDateOutput, ReceiptOutput } from './aiOutputs.js';

/**
 * Scoring for the AI evaluation script (scripts/ai-eval.ts). Pure functions, so the same sample set gives the
 * same score for any provider and the scoring itself is unit-tested.
 */

export type EvalTask = 'date' | 'receipt' | 'photo';

interface SampleBase {
  id: string;
  /** Image file, relative to the samples file's folder (or --images). */
  image: string;
}

export interface DateSample extends SampleBase {
  task: 'date';
  /** The person's locale, which decides day/month order. */
  locale?: string;
  expected: { printedDate: string | null; kind?: PrintedDateType };
}

export interface ReceiptSample extends SampleBase {
  task: 'receipt';
  expected: { purchaseDate?: string | null; items: { name: string }[] };
}

export interface PhotoSample extends SampleBase {
  task: 'photo';
  expected: { name: string; warningSigns?: string[] };
}

export type EvalSample = DateSample | ReceiptSample | PhotoSample;

/** 0 to 1 per sample; `parts` says which checks passed. */
export interface Score {
  score: number;
  parts: Record<string, boolean | number>;
}

const norm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

/** The date the app would use for what the AI read, judged exactly like the real service does. */
export function scoreDate(sample: DateSample, answer: PrintedDateOutput): Score {
  const date = parsePrintedDate(answer.text, sample.locale);
  const dateOk = date === sample.expected.printedDate;
  const parts: Score['parts'] = { date: dateOk };
  if (sample.expected.kind !== undefined) parts.kind = answer.kind === sample.expected.kind;
  const values = Object.values(parts) as boolean[];
  return { score: values.filter(Boolean).length / values.length, parts };
}

/** How well the food lines match: the share found (recall) and the share of lines that were real (precision). */
export function scoreReceipt(sample: ReceiptSample, answer: ReceiptOutput): Score {
  const wanted = sample.expected.items.map((item) => norm(item.name));
  const got = answer.items.map((item) => norm(item.name));
  const matches = (a: string, b: string) => a === b || a.includes(b) || b.includes(a);
  const found = wanted.filter((w) => got.some((g) => matches(g, w))).length;
  const real = got.filter((g) => wanted.some((w) => matches(g, w))).length;
  const recall = wanted.length === 0 ? 1 : found / wanted.length;
  const precision = got.length === 0 ? (wanted.length === 0 ? 1 : 0) : real / got.length;
  const parts: Score['parts'] = { recall, precision };
  if (sample.expected.purchaseDate !== undefined)
    parts.purchaseDate = answer.purchaseDate === sample.expected.purchaseDate;
  const values = Object.values(parts).map(Number);
  return { score: values.reduce((a, b) => a + b, 0) / values.length, parts };
}

/** The food named and, when the sample lists them, the warning-sign types found (as a set). */
export function scorePhoto(sample: PhotoSample, answer: PhotoCheckOutput): Score {
  const name = norm(answer.name);
  const want = norm(sample.expected.name);
  const parts: Score['parts'] = { name: name === want || name.includes(want) || want.includes(name) };
  if (sample.expected.warningSigns) {
    const expected = new Set(sample.expected.warningSigns);
    const got = new Set(answer.warningSigns.map((sign) => sign.type as string));
    parts.warningSigns = expected.size === got.size && [...expected].every((type) => got.has(type));
  }
  const values = Object.values(parts) as boolean[];
  return { score: values.filter(Boolean).length / values.length, parts };
}

/** Every piece of text in an answer a person could see, for the banned-wording count. */
export function textsOf(task: EvalTask, answer: unknown): string[] {
  if (task === 'receipt') return (answer as ReceiptOutput).items.map((item) => item.name);
  if (task === 'photo') {
    const photo = answer as PhotoCheckOutput;
    return [photo.name, photo.category, ...photo.warningSigns.map((sign) => sign.description)];
  }
  return [];
}

export const bannedCount = (texts: string[]) => texts.filter(hasBannedWording).length;

export interface PriceTable {
  [model: string]: { inputPerMillion: number; outputPerMillion: number };
}

/** US dollars for the tokens used, or null when the model isn't in the price table. */
export function costOf(model: string, inputTokens: number, outputTokens: number, prices: PriceTable): number | null {
  const price = prices[model];
  if (!price) return null;
  return (inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion) / 1_000_000;
}

export interface ProviderTotals {
  provider: string;
  samples: number;
  /** Answers that passed the same zod check the app uses. */
  valid: number;
  /** Requests that failed outright (after the client's own rate-limit retry). */
  failed: number;
  bannedTexts: number;
  scores: Record<EvalTask, number[]>;
  latenciesMs: number[];
  /** Tokens per model, so the fast and smart tiers are priced separately. */
  usage: Record<string, { inputTokens: number; outputTokens: number }>;
}

export const emptyTotals = (provider: string): ProviderTotals => ({
  provider,
  samples: 0,
  valid: 0,
  failed: 0,
  bannedTexts: 0,
  scores: { date: [], receipt: [], photo: [] },
  latenciesMs: [],
  usage: {},
});

const mean = (values: number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);

export interface ProviderReport {
  provider: string;
  samples: number;
  validRate: number | null;
  failed: number;
  bannedTexts: number;
  accuracy: Record<EvalTask, number | null> & { overall: number | null };
  avgLatencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  /** Null unless every model used is in the price table. */
  costUsd: number | null;
  /** Cost per 1,000 samples, for comparing providers on a run of any size. */
  costPer1000Usd: number | null;
}

export function report(totals: ProviderTotals, prices: PriceTable): ProviderReport {
  const all = [...totals.scores.date, ...totals.scores.receipt, ...totals.scores.photo];
  let inputTokens = 0;
  let outputTokens = 0;
  let cost: number | null = 0;
  for (const [model, tokens] of Object.entries(totals.usage)) {
    inputTokens += tokens.inputTokens;
    outputTokens += tokens.outputTokens;
    const part = costOf(model, tokens.inputTokens, tokens.outputTokens, prices);
    cost = cost === null || part === null ? null : cost + part;
  }
  return {
    provider: totals.provider,
    samples: totals.samples,
    validRate: totals.samples === 0 ? null : totals.valid / totals.samples,
    failed: totals.failed,
    bannedTexts: totals.bannedTexts,
    accuracy: {
      date: mean(totals.scores.date),
      receipt: mean(totals.scores.receipt),
      photo: mean(totals.scores.photo),
      overall: mean(all),
    },
    avgLatencyMs: mean(totals.latenciesMs),
    inputTokens,
    outputTokens,
    costUsd: cost,
    costPer1000Usd: cost === null || totals.samples === 0 ? null : (cost / totals.samples) * 1000,
  };
}
