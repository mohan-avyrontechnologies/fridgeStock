import { describe, expect, it } from 'vitest';
import {
  classifyUrgency,
  cookFirst,
  prioritise,
  summarise,
} from '../src/services/priorityEngine.js';
import { addDays, diffDays, parseDateKey, todayIn } from '../src/utils/dates.js';

const d = (key: string) => parseDateKey(key)!;
const today = d('2026-09-29');

function item(id: string, added: string, lifespan: number, status = 'ACTIVE') {
  const addedDate = d(added);
  return { id, status, addedDate, expiryDate: addDays(addedDate, lifespan) };
}

describe('classifyUrgency', () => {
  it.each([
    [10, 'NOT_URGENT'],
    [4, 'NOT_URGENT'],
    [3, 'USE_SOON'],
    [1, 'USE_SOON'],
    [0, 'DUE_TODAY'],
    [-1, 'PAST_EXPECTED_EXPIRY'],
    [-30, 'PAST_EXPECTED_EXPIRY'],
  ])('%i remaining days -> %s', (days, expected) => {
    expect(classifyUrgency(days)).toBe(expected);
  });

  it('honours configured thresholds', () => {
    expect(classifyUrgency(5, { useSoonDays: 5, cookFirstMinimum: 'USE_SOON' })).toBe('USE_SOON');
  });
});

describe('prioritise', () => {
  it('orders the FRD worked example earliest expected expiry first', () => {
    const items = [
      item('eggs', '2026-09-29', 8),
      item('milk', '2026-09-29', 4),
      item('chicken', '2026-09-29', 1),
      item('spinach', '2026-09-29', 2),
    ];
    expect(prioritise(items, today).map((i) => i.id)).toEqual(['chicken', 'spinach', 'milk', 'eggs']);
  });

  it('breaks expiry ties by added date, then by id', () => {
    const items = [
      item('c', '2026-09-27', 3), // expires 09-30, added later
      item('b', '2026-09-25', 5), // expires 09-30, added earliest
      item('a', '2026-09-27', 3), // same expiry and added date as c; lower id
    ];
    expect(prioritise(items, today).map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('is deterministic regardless of input order', () => {
    const items = [
      item('x', '2026-09-20', 5),
      item('y', '2026-09-28', 2),
      item('z', '2026-09-28', 2),
      item('w', '2026-09-29', 0),
    ];
    const expected = prioritise(items, today).map((i) => i.id);
    for (let n = 0; n < 10; n++) {
      const shuffled = [...items].sort(() => Math.random() - 0.5);
      expect(prioritise(shuffled, today).map((i) => i.id)).toEqual(expected);
    }
  });

  it('excludes used, wasted and removed items', () => {
    const items = [
      item('active', '2026-09-29', 1),
      item('used', '2026-09-29', 1, 'USED'),
      item('wasted', '2026-09-29', 1, 'WASTED'),
      item('removed', '2026-09-29', 1, 'REMOVED'),
    ];
    expect(prioritise(items, today).map((i) => i.id)).toEqual(['active']);
  });

  it('computes remaining days and urgency, including past expected expiry', () => {
    const [overdue, due, soon, later] = prioritise(
      [
        item('later', '2026-09-29', 7),
        item('soon', '2026-09-29', 2),
        item('due', '2026-09-26', 3),
        item('overdue', '2026-09-20', 2),
      ],
      today,
    );
    expect(overdue).toMatchObject({ id: 'overdue', remainingDays: -7, urgency: 'PAST_EXPECTED_EXPIRY' });
    expect(due).toMatchObject({ id: 'due', remainingDays: 0, urgency: 'DUE_TODAY' });
    expect(soon).toMatchObject({ id: 'soon', remainingDays: 2, urgency: 'USE_SOON' });
    expect(later).toMatchObject({ id: 'later', remainingDays: 7, urgency: 'NOT_URGENT' });
  });
});

describe('cookFirst and summarise', () => {
  const list = prioritise(
    [
      item('later', '2026-09-29', 7),
      item('soon', '2026-09-29', 3),
      item('due', '2026-09-29', 0),
      item('overdue', '2026-09-20', 2),
    ],
    today,
  );

  it('includes every item that is not "Not urgent", in priority order', () => {
    expect(cookFirst(list).map((i) => i.id)).toEqual(['overdue', 'due', 'soon']);
  });

  it('counts items by urgency', () => {
    expect(summarise(list)).toEqual({
      NOT_URGENT: 1,
      USE_SOON: 1,
      DUE_TODAY: 1,
      PAST_EXPECTED_EXPIRY: 1,
    });
  });
});

describe('date helpers', () => {
  it('rejects impossible calendar dates', () => {
    expect(parseDateKey('2026-02-30')).toBeNull();
    expect(parseDateKey('29/09/2026')).toBeNull();
    expect(parseDateKey('2028-02-29')).not.toBeNull();
  });

  it('counts whole days across a DST change', () => {
    expect(diffDays(d('2026-11-02'), d('2026-10-31'))).toBe(2);
  });

  it("uses the user's local calendar day as today", () => {
    const instant = new Date('2026-09-29T23:30:00Z');
    expect(todayIn('UTC', instant)).toEqual(d('2026-09-29'));
    expect(todayIn('Asia/Kolkata', instant)).toEqual(d('2026-09-30'));
    expect(todayIn('America/Los_Angeles', instant)).toEqual(d('2026-09-29'));
  });
});
