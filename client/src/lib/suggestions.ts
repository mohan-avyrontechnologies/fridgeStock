import {
  FOOD_REFERENCE,
  findReference,
  type LearnedLifespan,
  type StorageLocation,
  type Unit,
} from '@cook-first/shared';

/** A lifespan suggestion for a food in a location: the user's own usual first, then the reference list. */
export interface LifespanSuggestion {
  name: string;
  unit: Unit;
  /** null when the reference list has no value for this location. */
  days: number | null;
  source: 'learned' | 'reference';
  /** For learned suggestions: how many of the user's items it's based on. */
  basedOn?: number;
}

const key = (name: string) => name.trim().toLowerCase();

export function suggestFor(
  name: string,
  storage: StorageLocation,
  learned: LearnedLifespan[],
): LifespanSuggestion | null {
  const own = learned.find((l) => key(l.name) === key(name) && l.storage === storage);
  if (own) return { name: own.name, unit: own.unit, days: own.days, source: 'learned', basedOn: own.basedOn };
  const ref = findReference(name);
  if (ref) return { name: ref.name, unit: ref.unit, days: ref.lifespanDays[storage], source: 'reference' };
  return null;
}

/** Foods matching what's typed: the user's own foods first, then the reference list, prefix matches first. */
export function searchSuggestions(
  query: string,
  storage: StorageLocation,
  learned: LearnedLifespan[],
  limit = 6,
): LifespanSuggestion[] {
  const q = key(query);
  if (!q) return [];
  const names = new Map<string, string>();
  for (const l of learned) if (l.storage === storage) names.set(key(l.name), l.name);
  for (const r of FOOD_REFERENCE) if (!names.has(key(r.name))) names.set(key(r.name), r.name);
  return [...names.entries()]
    .filter(([k]) => k.includes(q) && k !== q)
    .sort(([a], [b]) => Number(!a.startsWith(q)) - Number(!b.startsWith(q)))
    .slice(0, limit)
    .map(([, name]) => suggestFor(name, storage, learned)!)
    .sort((a, b) => Number(a.source !== 'learned') - Number(b.source !== 'learned'));
}
