import { BANNED_PHRASES } from '@cook-first/shared';
import { describe, expect, it } from 'vitest';
import {
  bannedCount,
  costOf,
  emptyTotals,
  report,
  scoreDate,
  scorePhoto,
  scoreReceipt,
  type DateSample,
  type PhotoSample,
  type ReceiptSample,
} from '../services/aiEvaluation.js';

/** The evaluation script's scoring: the same answers must score the same whichever provider gave them. */

describe('scoreDate', () => {
  const sample: DateSample = {
    id: 'd',
    task: 'date',
    image: 'd.jpg',
    locale: 'en-GB',
    expected: { printedDate: '2026-11-05', kind: 'USE_BY' },
  };

  it('scores the date the app would use, in the sample locale', () => {
    expect(scoreDate(sample, { text: '05/11/26', kind: 'USE_BY' }).score).toBe(1);
    expect(scoreDate({ ...sample, locale: 'en-US' }, { text: '05/11/26', kind: 'USE_BY' }).parts.date).toBe(false);
  });

  it('gives half for the right date with the wrong label', () => {
    expect(scoreDate(sample, { text: '5 NOV 2026', kind: 'BEST_BEFORE' }).score).toBe(0.5);
  });

  it('expects null when no date is printed', () => {
    const none: DateSample = { ...sample, expected: { printedDate: null } };
    expect(scoreDate(none, { text: null, kind: 'UNKNOWN' }).score).toBe(1);
    expect(scoreDate(none, { text: '05/11/26', kind: 'UNKNOWN' }).score).toBe(0);
  });
});

describe('scoreReceipt', () => {
  const sample: ReceiptSample = {
    id: 'r',
    task: 'receipt',
    image: 'r.jpg',
    expected: { items: [{ name: 'Milk' }, { name: 'Eggs' }] },
  };
  const line = (name: string) => ({ name, quantity: 1, unit: 'pcs' as const, price: null });

  it('scores recall and precision', () => {
    const perfect = scoreReceipt(sample, { purchaseDate: null, items: [line('milk'), line('Eggs')] });
    expect(perfect.score).toBe(1);
    const extra = scoreReceipt(sample, { purchaseDate: null, items: [line('Milk'), line('Eggs'), line('Soap')] });
    expect(extra.parts).toMatchObject({ recall: 1, precision: 2 / 3 });
    const missing = scoreReceipt(sample, { purchaseDate: null, items: [line('Milk')] });
    expect(missing.parts).toMatchObject({ recall: 0.5, precision: 1 });
  });

  it('checks the purchase date only when the sample has one', () => {
    const dated: ReceiptSample = { ...sample, expected: { ...sample.expected, purchaseDate: '2026-09-28' } };
    expect(scoreReceipt(dated, { purchaseDate: '2026-09-28', items: [line('Milk'), line('Eggs')] }).score).toBe(1);
    expect(scoreReceipt(dated, { purchaseDate: null, items: [line('Milk'), line('Eggs')] }).parts.purchaseDate).toBe(
      false,
    );
  });
});

describe('scorePhoto', () => {
  const sample: PhotoSample = {
    id: 'p',
    task: 'photo',
    image: 'p.jpg',
    expected: { name: 'Spinach', warningSigns: ['WILTING'] },
  };
  const answer = (name: string, types: string[]) => ({
    name,
    category: 'vegetables',
    confidence: 0.9,
    warningSigns: types.map((type) => ({ type: type as 'WILTING', description: 'x' })),
  });

  it('scores the name and the set of warning signs', () => {
    expect(scorePhoto(sample, answer('spinach', ['WILTING'])).score).toBe(1);
    expect(scorePhoto(sample, answer('Spinach', [])).score).toBe(0.5);
    expect(scorePhoto(sample, answer('Lettuce', ['WILTING'])).score).toBe(0.5);
  });

  it('expects no signs when the sample lists none', () => {
    const clean: PhotoSample = { ...sample, expected: { name: 'Chicken', warningSigns: [] } };
    expect(scorePhoto(clean, answer('Chicken', [])).score).toBe(1);
    expect(scorePhoto(clean, answer('Chicken', ['MOULD'])).score).toBe(0.5);
  });
});

describe('cost and the report', () => {
  const prices = { 'fast-model': { inputPerMillion: 1, outputPerMillion: 4 } };

  it('prices tokens, or says it cannot', () => {
    expect(costOf('fast-model', 1_000_000, 500_000, prices)).toBe(3);
    expect(costOf('unknown', 10, 10, prices)).toBeNull();
  });

  it('summarises a run, with cost per 1,000 requests', () => {
    const totals = emptyTotals('p');
    totals.samples = 4;
    totals.valid = 3;
    totals.failed = 1;
    totals.scores.date = [1, 0.5];
    totals.scores.photo = [0];
    totals.latenciesMs = [100, 300];
    totals.usage = { 'fast-model': { inputTokens: 2_000_000, outputTokens: 1_000_000 } };
    const r = report(totals, prices);
    expect(r).toMatchObject({
      validRate: 0.75,
      failed: 1,
      inputTokens: 2_000_000,
      outputTokens: 1_000_000,
      costUsd: 6,
    });
    expect(r.accuracy).toMatchObject({ date: 0.75, receipt: null, photo: 0, overall: 0.5 });
    expect(r.avgLatencyMs).toBe(200);
    expect(r.costPer1000Usd).toBe(1500);
  });

  it('has no cost when a model is missing from the price table', () => {
    const totals = emptyTotals('p');
    totals.samples = 1;
    totals.usage = { mystery: { inputTokens: 1, outputTokens: 1 } };
    expect(report(totals, prices).costUsd).toBeNull();
  });

  it('counts banned wording in what people would see', () => {
    expect(bannedCount(['Milk', `Chicken is ${BANNED_PHRASES[5]}`])).toBe(1);
  });
});
