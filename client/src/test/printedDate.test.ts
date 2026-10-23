import { describe, expect, it } from 'vitest';
import { findPrintedDate, kindFromText } from '../lib/printedDate';

const TODAY = '2026-09-29';

describe('kindFromText', () => {
  it('names the date from the words around it', () => {
    expect(kindFromText('USE BY 05/11/26')).toBe('USE_BY');
    expect(kindFromText('Use-by: 5 NOV')).toBe('USE_BY');
    expect(kindFromText('Best before 05/11/26')).toBe('BEST_BEFORE');
    expect(kindFromText('BBE 05.11.2026')).toBe('BEST_BEFORE');
    expect(kindFromText('EXP 11/2026')).toBe('EXPIRY');
    expect(kindFromText('Expiry date')).toBe('EXPIRY');
    expect(kindFromText('LOT 4471')).toBe('UNKNOWN');
  });
});

describe('findPrintedDate', () => {
  it('finds a labelled date and reads day/month order from the locale', () => {
    const uk = findPrintedDate(['Whole milk 1L', 'USE BY 03/10/26'], 'en-GB', TODAY);
    expect(uk).toEqual({ text: '03/10/26', date: '2026-10-03', kind: 'USE_BY' });
    // Month first, 10 March is long past, so the date is ignored.
    expect(findPrintedDate(['USE BY 03/10/26'], 'en-US', TODAY)).toBeNull();
  });

  it('takes the label from the line above', () => {
    expect(findPrintedDate(['Best before', '5 NOV 2026'], 'en-GB', TODAY)).toEqual({
      text: '5 NOV 2026',
      date: '2026-11-05',
      kind: 'BEST_BEFORE',
    });
  });

  it('prefers a labelled date to an unlabelled one (such as the packed-on date)', () => {
    const result = findPrintedDate(['02/10/26', 'EXP 20/10/26'], 'en-GB', TODAY);
    expect(result).toMatchObject({ date: '2026-10-20', kind: 'EXPIRY' });
  });

  it('reads a month and year as the last day of the month', () => {
    expect(findPrintedDate(['EXP 11/2026'], 'en-GB', TODAY)).toMatchObject({ date: '2026-11-30' });
  });

  it('ignores dates more than two years away or more than 30 days past', () => {
    expect(findPrintedDate(['BEST BEFORE 01/01/2031'], 'en-GB', TODAY)).toBeNull();
    expect(findPrintedDate(['BEST BEFORE 01/08/2026'], 'en-GB', TODAY)).toBeNull();
  });

  it('takes the earlier reading when the locale is unknown and the date is ambiguous', () => {
    expect(findPrintedDate(['EXP 03/04/2027'], undefined, TODAY)).toMatchObject({ date: '2027-03-04' });
  });

  it('finds nothing in text with no date, such as a batch code', () => {
    expect(findPrintedDate(['LOT 4471', 'Whole milk', '1 L'], 'en-GB', TODAY)).toBeNull();
    expect(findPrintedDate([], 'en-GB', TODAY)).toBeNull();
  });
});
