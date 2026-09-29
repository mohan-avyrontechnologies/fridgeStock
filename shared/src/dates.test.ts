import { describe, expect, it } from 'vitest';
import { addDays, diffDays, formatDisplay, isValidDate, todayInTz } from './dates.js';

describe('isValidDate', () => {
  it.each(['2026-09-29', '2028-02-29', '2026-12-31', '1999-01-01'])('accepts %s', (d) => {
    expect(isValidDate(d)).toBe(true);
  });

  it('knows leap years, including the century rules', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2000-02-29')).toBe(true); // divisible by 400
    expect(isValidDate('2100-02-29')).toBe(false); // divisible by 100 but not 400
    expect(isValidDate('2026-04-31')).toBe(false); // 30-day month
  });

  it.each([
    '2026-02-30',
    '2027-02-29',
    '2026-13-01',
    '2026-9-29',
    '29/09/2026',
    '2026-09-29T00:00:00Z',
    '',
    20260929,
    null,
  ])('rejects %s', (d) => {
    expect(isValidDate(d)).toBe(false);
  });
});

describe('todayInTz', () => {
  const instant = new Date('2026-09-29T23:30:00Z');

  it("returns the calendar day in the given zone, not the machine's", () => {
    expect(todayInTz('UTC', instant)).toBe('2026-09-29');
    expect(todayInTz('Asia/Kolkata', instant)).toBe('2026-09-30');
    expect(todayInTz('America/Los_Angeles', instant)).toBe('2026-09-29');
    expect(todayInTz('Pacific/Kiritimati', new Date('2026-09-29T10:00:00Z'))).toBe('2026-09-30');
  });
});

describe('addDays', () => {
  it('adds and subtracts across month and year ends', () => {
    expect(addDays('2026-09-29', 4)).toBe('2026-10-03');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-04-30', 1)).toBe('2026-05-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-01-01', 365)).toBe('2028-12-31'); // leap year has 366 days
    expect(addDays('2026-09-29', 0)).toBe('2026-09-29');
  });

  it('is unaffected by daylight-saving changes', () => {
    // Europe and the US change clocks on these weekends.
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
  });

  it('throws on an invalid date', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
  });
});

describe('diffDays', () => {
  it('counts whole days from the first date to the second', () => {
    expect(diffDays('2026-09-29', '2026-10-03')).toBe(4);
    expect(diffDays('2026-10-03', '2026-09-29')).toBe(-4);
    expect(diffDays('2026-09-29', '2026-09-29')).toBe(0);
    expect(diffDays('2026-10-31', '2026-11-02')).toBe(2);
    expect(diffDays('2028-02-28', '2028-03-01')).toBe(2); // across 29 Feb
    expect(diffDays('2026-12-30', '2027-01-02')).toBe(3); // across a year end
  });

  it('is the inverse of addDays', () => {
    for (const n of [-40, -1, 0, 1, 7, 365]) expect(diffDays('2026-09-29', addDays('2026-09-29', n))).toBe(n);
  });
});

describe('formatDisplay', () => {
  it('gives a friendly label such as "Thu, 1 Oct"', () => {
    expect(formatDisplay('2026-10-01')).toBe('Thu, 1 Oct');
    expect(formatDisplay('2026-09-29')).toBe('Tue, 29 Sep');
    expect(formatDisplay('2027-01-10')).toBe('Sun, 10 Jan');
  });
});
