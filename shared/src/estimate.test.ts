import { describe, expect, it } from 'vitest';
import type { LearnedLifespan } from './api.js';
import { addDays } from './dates.js';
import {
  estimateExpiry,
  expirySourceLabel,
  FALLBACK_LIFESPAN_DAYS,
  isUsablePrintedDate,
  parsePrintedDate,
  recalculateExpiry,
} from './estimate.js';
import { findReference } from './foodReference.js';
import { hasBannedWording } from './wording.js';

const ADDED = '2026-10-10';
const MILK = findReference('Milk')!; // fridge 5, freezer 90, opened 4

const learned = (name: string, days: number, storage: LearnedLifespan['storage'] = 'FRIDGE'): LearnedLifespan => ({
  name,
  storage,
  unit: 'l',
  days,
  basedOn: 3,
});

const base = { product: { name: 'Milk' }, storage: 'FRIDGE' as const, addedDate: ADDED };

describe('estimateExpiry: each source', () => {
  it('uses the printed date first when it is the earliest', () => {
    const result = estimateExpiry({ ...base, printedDate: '2026-10-12', printedDateType: 'USE_BY' });
    expect(result.source).toBe('PRINTED_DATE');
    expect(result.expiryDate).toBe('2026-10-12');
    expect(result.explanation).toMatch(/use-by/);
  });

  it('uses the household lifespan when it is shorter than the catalog', () => {
    const result = estimateExpiry({ ...base, usageHistory: [learned('milk', 3)] });
    expect(result.source).toBe('LEARNED');
    expect(result.expiryDate).toBe(addDays(ADDED, 3));
  });

  it('uses the catalog lifespan for the product and location', () => {
    const result = estimateExpiry({ ...base, storage: 'FREEZER' });
    expect(result).toMatchObject({ source: 'CATALOG', expiryDate: addDays(ADDED, MILK.lifespanDays.FREEZER!) });
  });

  it('uses the category default when the product is not in the catalog', () => {
    const result = estimateExpiry({
      product: { name: 'Kefir' },
      storage: 'FRIDGE',
      addedDate: ADDED,
      category: 'DAIRY_EGGS',
    });
    expect(result.source).toBe('CATEGORY_DEFAULT');
    expect(result.expiryDate).toBe(addDays(ADDED, 7));
  });

  it('reads a free-text category such as a photo check returns', () => {
    const result = estimateExpiry({
      product: { name: 'Kefir' },
      storage: 'FRIDGE',
      addedDate: ADDED,
      category: 'Dairy product',
    });
    expect(result.source).toBe('CATEGORY_DEFAULT');
  });

  it('falls back to the short default, labelled as a rough estimate', () => {
    const result = estimateExpiry({ product: { name: 'Mystery jar' }, storage: 'PANTRY', addedDate: ADDED });
    expect(result.source).toBe('FALLBACK');
    expect(result.expiryDate).toBe(addDays(ADDED, FALLBACK_LIFESPAN_DAYS));
    expect(expirySourceLabel(result.source)).toBe('Rough estimate');
  });

  it('falls back when the catalog and category have no figure for that location', () => {
    // Chicken is not usually kept in the pantry, and meat has no pantry default.
    const result = estimateExpiry({ product: { name: 'Chicken' }, storage: 'PANTRY', addedDate: ADDED });
    expect(result.source).toBe('FALLBACK');
  });
});

describe('estimateExpiry: the earliest date wins', () => {
  it('prefers the catalog when the printed date is later', () => {
    const result = estimateExpiry({ ...base, printedDate: '2026-10-20', printedDateType: 'BEST_BEFORE' });
    expect(result.source).toBe('CATALOG');
    expect(result.expiryDate).toBe(addDays(ADDED, 5));
  });

  it('prefers the printed date when it is earlier than the catalog and learned dates', () => {
    const result = estimateExpiry({
      ...base,
      printedDate: '2026-10-11',
      printedDateType: 'USE_BY',
      usageHistory: [learned('Milk', 3)],
    });
    expect(result.source).toBe('PRINTED_DATE');
  });

  it('gives a tie to the source higher in the priority order', () => {
    const result = estimateExpiry({ ...base, printedDate: addDays(ADDED, 5), printedDateType: 'USE_BY' });
    expect(result.source).toBe('PRINTED_DATE');
  });

  it('uses the shorter once-opened catalog lifespan when the item is opened', () => {
    const result = estimateExpiry({ ...base, openedDate: '2026-10-10' });
    expect(result.source).toBe('CATALOG');
    expect(result.expiryDate).toBe(addDays('2026-10-10', 4));
  });

  it('does not let a long opened lifespan extend the unopened one', () => {
    const cheese = {
      product: { name: 'Hard cheese' },
      storage: 'FRIDGE' as const,
      addedDate: ADDED,
      openedDate: '2026-10-20',
    };
    expect(estimateExpiry(cheese).expiryDate).toBe(addDays(ADDED, 21));
  });
});

describe('estimateExpiry: learned lifespans only apply when shorter', () => {
  it('ignores a learned lifespan that is longer than the catalog value', () => {
    expect(estimateExpiry({ ...base, usageHistory: [learned('Milk', 9)] }).source).toBe('CATALOG');
  });

  it('ignores a learned lifespan that equals the catalog value', () => {
    expect(estimateExpiry({ ...base, usageHistory: [learned('Milk', 5)] }).source).toBe('CATALOG');
  });

  it('ignores a learned lifespan for a different location', () => {
    expect(estimateExpiry({ ...base, usageHistory: [learned('Milk', 1, 'FREEZER')] }).source).toBe('CATALOG');
  });

  it('is measured against the category default when the catalog has no entry', () => {
    const input = { product: { name: 'Kefir' }, storage: 'FRIDGE' as const, addedDate: ADDED, category: 'DAIRY_EGGS' };
    expect(estimateExpiry({ ...input, usageHistory: [learned('Kefir', 4)] }).source).toBe('LEARNED');
    expect(estimateExpiry({ ...input, usageHistory: [learned('Kefir', 12)] }).source).toBe('CATEGORY_DEFAULT');
  });

  it('is used when there is no other figure for the food at all', () => {
    const result = estimateExpiry({
      product: { name: 'Kimchi' },
      storage: 'FRIDGE',
      addedDate: ADDED,
      usageHistory: [learned('Kimchi', 30)],
    });
    expect(result).toMatchObject({ source: 'LEARNED', expiryDate: addDays(ADDED, 30) });
  });
});

describe('estimateExpiry: printed dates out of range', () => {
  const today = ADDED;

  it('ignores a date more than two years away and falls back to the next source', () => {
    const result = estimateExpiry({ ...base, today, printedDate: addDays(today, 731), printedDateType: 'EXPIRY' });
    expect(result.source).toBe('CATALOG');
  });

  it('accepts a date exactly two years away (as the earliest source, if it is)', () => {
    expect(isUsablePrintedDate(addDays(today, 730), today)).toBe(true);
  });

  it('ignores a date more than 30 days past', () => {
    const result = estimateExpiry({ ...base, today, printedDate: addDays(today, -31), printedDateType: 'BEST_BEFORE' });
    expect(result.source).toBe('CATALOG');
  });

  it('accepts a date that is 30 days past', () => {
    const result = estimateExpiry({ ...base, today, printedDate: addDays(today, -30), printedDateType: 'BEST_BEFORE' });
    expect(result.source).toBe('PRINTED_DATE');
  });

  it('falls through all the way to the fallback when nothing else is known', () => {
    const result = estimateExpiry({
      product: { name: 'Mystery jar' },
      storage: 'PANTRY',
      addedDate: ADDED,
      today,
      printedDate: addDays(today, 900),
    });
    expect(result.source).toBe('FALLBACK');
  });

  it('ignores a printed date that is not a real date', () => {
    expect(isUsablePrintedDate('2026-02-30', today)).toBe(false);
  });
});

describe('parsePrintedDate: locale day/month order', () => {
  it('reads 03/04/2026 as 3 April in a day-first locale', () => {
    expect(parsePrintedDate('03/04/2026', 'en-GB')).toBe('2026-04-03');
  });

  it('reads 03/04/2026 as 4 March in a month-first locale', () => {
    expect(parsePrintedDate('03/04/2026', 'en-US')).toBe('2026-03-04');
  });

  it('uses the other order when the locale order is not a real date', () => {
    expect(parsePrintedDate('13/05/2026', 'en-US')).toBe('2026-05-13');
    expect(parsePrintedDate('05/13/2026', 'en-GB')).toBe('2026-05-13');
  });

  it('reads two-digit years and other separators', () => {
    expect(parsePrintedDate('12.11.26', 'de-DE')).toBe('2026-11-12');
    expect(parsePrintedDate('12-11-26', 'en-US')).toBe('2026-12-11');
  });

  it('reads month names without needing the locale', () => {
    expect(parsePrintedDate('5 NOV 2026', 'en-US')).toBe('2026-11-05');
    expect(parsePrintedDate('Nov 5 2026', 'en-GB')).toBe('2026-11-05');
    expect(parsePrintedDate('05-Sept-26', null)).toBe('2026-09-05');
  });

  it('reads year-first dates', () => {
    expect(parsePrintedDate('2026-11-05', 'en-US')).toBe('2026-11-05');
  });

  it('reads a month and year as the last day of the month', () => {
    expect(parsePrintedDate('02/2028', 'en-GB')).toBe('2028-02-29');
    expect(parsePrintedDate('Nov 2026', null)).toBe('2026-11-30');
  });

  it('returns null for text that is not a date', () => {
    expect(parsePrintedDate('LOT 4471', 'en-GB')).toBeNull();
    expect(parsePrintedDate('31/02/2026', 'en-GB')).toBeNull();
    expect(parsePrintedDate('', 'en-GB')).toBeNull();
    expect(parsePrintedDate(null, 'en-GB')).toBeNull();
  });
});

describe('parsePrintedDate: ambiguous dates', () => {
  it('takes the earlier reading when there is no locale to decide', () => {
    expect(parsePrintedDate('03/04/2026', null)).toBe('2026-03-04');
    expect(parsePrintedDate('04/03/2026', undefined)).toBe('2026-03-04');
  });

  it('takes the earlier reading for a locale it does not recognise', () => {
    expect(parsePrintedDate('03/04/2026', 'not a locale!')).toBe('2026-03-04');
  });

  it('is not ambiguous when both numbers are the same', () => {
    expect(parsePrintedDate('05/05/2026', null)).toBe('2026-05-05');
  });
});

describe('recalculateExpiry: never moves an expiry later', () => {
  it('returns a new estimate when it is earlier', () => {
    const next = recalculateExpiry(addDays(ADDED, 30), { ...base, openedDate: ADDED });
    expect(next).toMatchObject({ source: 'CATALOG', expiryDate: addDays(ADDED, 4) });
  });

  it('returns null when the new estimate would be later', () => {
    expect(recalculateExpiry(addDays(ADDED, 2), { ...base, storage: 'FREEZER' })).toBeNull();
  });

  it('returns null when the new estimate is the same day', () => {
    expect(recalculateExpiry(addDays(ADDED, 5), base)).toBeNull();
  });
});

describe('wording', () => {
  it('uses expected-expiry wording and no banned phrases in any explanation', () => {
    const cases = [
      estimateExpiry({ ...base, printedDate: '2026-10-11', printedDateType: 'USE_BY' }),
      estimateExpiry({ ...base, usageHistory: [learned('Milk', 2)] }),
      estimateExpiry(base),
      estimateExpiry({ product: { name: 'Kefir' }, storage: 'FRIDGE', addedDate: ADDED, category: 'DAIRY_EGGS' }),
      estimateExpiry({ product: { name: 'Mystery jar' }, storage: 'PANTRY', addedDate: ADDED }),
    ];
    for (const { explanation } of cases) {
      expect(hasBannedWording(explanation)).toBe(false);
      expect(explanation.length).toBeLessThan(140);
    }
  });
});
