import { addDays, type FoodStatus } from '@fridgestock/shared';
import { describe, expect, it } from 'vitest';
import { APPROACHING_EXPIRY_DAYS } from '../config/urgency.js';
import { classifyUrgency, prioritise } from '../services/priorityEngine.js';

const TODAY = '2026-09-29';

function item(id: string, addedDate: string, lifespanDays: number, status: FoodStatus = 'ACTIVE') {
  return { id, status, addedDate, expiryDate: addDays(addedDate, lifespanDays) };
}

const ids = (list: { id: string }[]) => list.map((i) => i.id);

describe('prioritise', () => {
  it('sorts items with different expiry dates earliest first', () => {
    const { items } = prioritise([item('late', TODAY, 9), item('soon', TODAY, 1), item('mid', TODAY, 5)], TODAY);
    expect(ids(items)).toEqual(['soon', 'mid', 'late']);
  });

  it('orders items with the same expiry date by added date, then by id', () => {
    const { items } = prioritise(
      [
        item('c', '2026-09-27', 3), // expires 09-30, added 09-27
        item('b', '2026-09-25', 5), // expires 09-30, added earliest
        item('a', '2026-09-27', 3), // same expiry and added date as c; lower id
      ],
      TODAY,
    );
    expect(ids(items)).toEqual(['b', 'a', 'c']);
  });

  it('compares ids as strings', () => {
    const { items } = prioritise([item('10', TODAY, 2), item('9', TODAY, 2), item('100', TODAY, 2)], TODAY);
    expect(ids(items)).toEqual(['10', '100', '9']);
  });

  it('excludes used, wasted and removed items', () => {
    const { items, fridgeStock, summary } = prioritise(
      [
        item('active', TODAY, 1),
        item('used', TODAY, 1, 'USED'),
        item('wasted', TODAY, 1, 'WASTED'),
        item('removed', TODAY, 1, 'REMOVED'),
      ],
      TODAY,
    );
    expect(ids(items)).toEqual(['active']);
    expect(ids(fridgeStock)).toEqual(['active']);
    expect(summary.total).toBe(1);
  });

  it.each([
    [4, 'NOT_URGENT'],
    [3, 'APPROACHING_EXPIRY'],
    [1, 'APPROACHING_EXPIRY'],
    [0, 'DUE'],
    [-1, 'OVERDUE'],
  ] as const)('switches urgency at exactly the right point: %i days remaining → %s', (remaining, urgency) => {
    const { items } = prioritise([item('x', addDays(TODAY, remaining), 0)], TODAY);
    expect(items[0]).toMatchObject({ remainingDays: remaining, urgency });
    expect(classifyUrgency(remaining)).toBe(urgency);
  });

  it('uses the single threshold constant for the NOT_URGENT / APPROACHING_EXPIRY boundary', () => {
    expect(APPROACHING_EXPIRY_DAYS).toBe(3);
    expect(classifyUrgency(APPROACHING_EXPIRY_DAYS)).toBe('APPROACHING_EXPIRY');
    expect(classifyUrgency(APPROACHING_EXPIRY_DAYS + 1)).toBe('NOT_URGENT');
  });

  it('counts an item with a zero-day lifespan as DUE on the day it is added', () => {
    const { items, fridgeStock } = prioritise([item('yoghurt', TODAY, 0)], TODAY);
    expect(items[0]).toMatchObject({ expiryDate: TODAY, remainingDays: 0, urgency: 'DUE' });
    expect(ids(fridgeStock)).toEqual(['yoghurt']);
  });

  it('gives identical output when run twice on the same input', () => {
    const input = [
      item('x', '2026-09-20', 5),
      item('y', '2026-09-28', 2),
      item('z', '2026-09-28', 2),
      item('w', TODAY, 9),
    ];
    const first = prioritise(input, TODAY);
    const second = prioritise(input, TODAY);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('gives the same order whatever order the items arrive in', () => {
    const input = [
      item('x', '2026-09-20', 5),
      item('y', '2026-09-28', 2),
      item('z', '2026-09-28', 2),
      item('w', TODAY, 0),
    ];
    const expected = ids(prioritise(input, TODAY).items);
    expect(ids(prioritise([...input].reverse(), TODAY).items)).toEqual(expected);
  });

  it('does not change the items it is given', () => {
    const input = [item('b', TODAY, 2), item('a', TODAY, 1)];
    const copy = structuredClone(input);
    prioritise(input, TODAY);
    expect(input).toEqual(copy);
  });

  it('orders chicken, spinach, milk, eggs, with only chicken and spinach in FridgeStock', () => {
    const { items, fridgeStock, summary } = prioritise(
      [item('eggs', TODAY, 8), item('milk', TODAY, 4), item('chicken', TODAY, 1), item('spinach', TODAY, 2)],
      TODAY,
    );
    expect(ids(items)).toEqual(['chicken', 'spinach', 'milk', 'eggs']);
    expect(ids(fridgeStock)).toEqual(['chicken', 'spinach']);
    expect(summary).toEqual({ NOT_URGENT: 2, APPROACHING_EXPIRY: 2, DUE: 0, OVERDUE: 0, total: 4 });
  });

  it('returns FridgeStock in the same order as the full list, with a summary and total', () => {
    const { items, fridgeStock, summary } = prioritise(
      [item('later', TODAY, 7), item('soon', TODAY, 3), item('due', TODAY, 0), item('overdue', '2026-09-20', 2)],
      TODAY,
    );
    expect(ids(items)).toEqual(['overdue', 'due', 'soon', 'later']);
    expect(ids(fridgeStock)).toEqual(['overdue', 'due', 'soon']);
    expect(summary).toEqual({ NOT_URGENT: 1, APPROACHING_EXPIRY: 1, DUE: 1, OVERDUE: 1, total: 4 });
  });
});
