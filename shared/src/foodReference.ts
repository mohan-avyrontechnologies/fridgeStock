import categoryData from '../data/category-defaults.json' with { type: 'json' };
import referenceData from '../data/food-reference.json' with { type: 'json' };
import type { FoodCategory, StorageLocation, Unit } from './enums.js';

/**
 * The Cook First reference list: common foods with suggested lifespans in
 * days for each storage location (null = not usually kept there).
 *
 * These are rough planning estimates used only to pre-fill the Add Food form.
 * The user always sees the suggested number and can change it. The FRD
 * requires lifespans to be user-entered or come from a clearly identified
 * reference dataset; this is that dataset. It says nothing about whether food
 * is fit to eat.
 *
 * The data lives in shared/data/food-reference.json and category-defaults.json,
 * which the Python server reads too.
 */
export const REFERENCE_SOURCE: string = referenceData.source;

export interface ReferenceFood {
  name: string;
  unit: Unit;
  category: FoodCategory;
  lifespanDays: Record<StorageLocation, number | null>;
  /** Typical days it lasts once opened (packaged foods only; null when opening makes no difference). */
  openedDays: number | null;
}

export const FOOD_REFERENCE: readonly ReferenceFood[] = referenceData.foods as ReferenceFood[];

/** Reference foods whose name contains the query (case-insensitive), best matches first. */
export function searchReference(query: string, limit = 6): ReferenceFood[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return FOOD_REFERENCE.filter((f) => f.name.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
    .slice(0, limit);
}

/** The exact reference entry for a name (case-insensitive), if there is one. */
export function findReference(name: string): ReferenceFood | undefined {
  const key = name.trim().toLowerCase();
  return FOOD_REFERENCE.find((f) => f.name.toLowerCase() === key);
}

/**
 * Default lifespans in days for a whole category of food, per location (null = not usually kept there).
 * Used only for a product the catalog has no entry of its own for.
 */
export const CATEGORY_DEFAULTS = categoryData.defaults as Record<FoodCategory, Record<StorageLocation, number | null>>;

/**
 * Words (lower case) that tell a free-text category, such as the one a photo check returns, which
 * FoodCategory it means. Only used to look a category up; the AI never supplies a number.
 */
const CATEGORY_WORDS = categoryData.categoryWords as ReadonlyArray<{
  category: FoodCategory;
  words: readonly string[];
}>;

/** The category a free-text label means (case-insensitive), or null when it matches none. */
export function categoryFromText(text: string | null | undefined): FoodCategory | null {
  const lower = (text ?? '').trim().toLowerCase();
  if (!lower) return null;
  return CATEGORY_WORDS.find(({ words }) => words.some((word) => lower.includes(word)))?.category ?? null;
}

/** Foods that can go in the fridge but are usually kept on the shelf. */
const USUALLY_PANTRY = new Set(referenceData.usuallyPantry);

/** Where a catalog food is usually kept: the pantry for a few shelf foods, else the fridge, else the pantry, else the freezer. */
export function usualStorage(foodEntry: ReferenceFood): StorageLocation {
  const { lifespanDays } = foodEntry;
  if (USUALLY_PANTRY.has(foodEntry.name.toLowerCase()) && lifespanDays.PANTRY !== null) return 'PANTRY';
  if (lifespanDays.FRIDGE !== null) return 'FRIDGE';
  if (lifespanDays.PANTRY !== null) return 'PANTRY';
  return 'FREEZER';
}
