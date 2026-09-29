import { describe, expect, it } from 'vitest';
import { STORAGE_LOCATIONS, UNITS } from './enums.js';
import { FOOD_REFERENCE, findReference, searchReference } from './foodReference.js';

describe('food reference list', () => {
  it('has unique names, valid units, and whole-number lifespans from 0 to 365 (or null)', () => {
    const names = FOOD_REFERENCE.map((f) => f.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const f of FOOD_REFERENCE) {
      expect(UNITS).toContain(f.unit);
      expect(f.name.length).toBeLessThanOrEqual(60);
      const values = STORAGE_LOCATIONS.map((s) => f.lifespanDays[s]);
      expect(
        values.some((v) => v !== null),
        `${f.name} has at least one location`,
      ).toBe(true);
      for (const v of values) {
        if (v !== null) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(365);
        }
      }
    }
  });

  it('suggests a longer lifespan in the freezer than the fridge', () => {
    for (const f of FOOD_REFERENCE) {
      const { FRIDGE, FREEZER } = f.lifespanDays;
      if (FRIDGE !== null && FREEZER !== null) expect(FREEZER, f.name).toBeGreaterThan(FRIDGE);
    }
  });

  it('finds matches by name, prefix matches first', () => {
    expect(searchReference('chick').map((f) => f.name)).toEqual(['Chicken']);
    const cheese = searchReference('cheese').map((f) => f.name);
    expect(cheese).toEqual(expect.arrayContaining(['Hard cheese', 'Soft cheese']));
    expect(searchReference('mi')[0]!.name).toBe('Milk');
    expect(searchReference('   ')).toEqual([]);
  });

  it('looks up an exact name, ignoring case and spaces', () => {
    expect(findReference('  SPINACH ')).toMatchObject({ unit: 'bunch', lifespanDays: { FRIDGE: 4 } });
    expect(findReference('Spinach salad')).toBeUndefined();
  });
});
