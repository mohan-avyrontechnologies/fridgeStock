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
 */
export const REFERENCE_SOURCE = 'Cook First reference list';

export interface ReferenceFood {
  name: string;
  unit: Unit;
  category: FoodCategory;
  lifespanDays: Record<StorageLocation, number | null>;
  /** Typical days it lasts once opened (packaged foods only; null when opening makes no difference). */
  openedDays: number | null;
}

const food = (
  name: string,
  unit: Unit,
  category: FoodCategory,
  fridge: number | null,
  freezer: number | null,
  pantry: number | null,
  opened: number | null = null,
): ReferenceFood => ({
  name,
  unit,
  category,
  lifespanDays: { FRIDGE: fridge, FREEZER: freezer, PANTRY: pantry },
  openedDays: opened,
});

export const FOOD_REFERENCE: readonly ReferenceFood[] = [
  // Meat and fish
  food('Chicken', 'g', 'MEAT_FISH', 2, 270, null),
  food('Beef mince', 'g', 'MEAT_FISH', 2, 120, null),
  food('Steak', 'g', 'MEAT_FISH', 3, 180, null),
  food('Fish fillets', 'g', 'MEAT_FISH', 2, 180, null),
  food('Prawns', 'g', 'MEAT_FISH', 2, 180, null),
  food('Bacon', 'pack', 'MEAT_FISH', 7, 30, null, 5),
  food('Sausages', 'pack', 'MEAT_FISH', 3, 60, null, 2),
  food('Sliced ham', 'pack', 'MEAT_FISH', 4, 60, null, 3),
  // Dairy and eggs
  food('Milk', 'l', 'DAIRY_EGGS', 5, 90, null, 4),
  food('Yoghurt', 'g', 'DAIRY_EGGS', 7, 60, null, 5),
  food('Hard cheese', 'g', 'DAIRY_EGGS', 21, 180, null, 21),
  food('Soft cheese', 'g', 'DAIRY_EGGS', 7, null, null, 5),
  food('Butter', 'g', 'DAIRY_EGGS', 30, 180, null, 30),
  food('Cream', 'ml', 'DAIRY_EGGS', 5, null, null, 3),
  food('Eggs', 'pcs', 'DAIRY_EGGS', 21, null, null),
  food('Paneer', 'g', 'DAIRY_EGGS', 5, 90, null, 3),
  food('Tofu', 'pack', 'DAIRY_EGGS', 5, 90, null, 3),
  // Vegetables and herbs
  food('Spinach', 'bunch', 'VEGETABLES', 4, 240, null),
  food('Lettuce', 'pcs', 'VEGETABLES', 5, null, null),
  food('Coriander', 'bunch', 'VEGETABLES', 5, null, null),
  food('Broccoli', 'pcs', 'VEGETABLES', 5, 300, null),
  food('Carrots', 'kg', 'VEGETABLES', 21, 300, 7),
  food('Tomatoes', 'pcs', 'VEGETABLES', 7, 60, 4),
  food('Cucumber', 'pcs', 'VEGETABLES', 7, null, null),
  food('Bell pepper', 'pcs', 'VEGETABLES', 7, 240, null),
  food('Mushrooms', 'g', 'VEGETABLES', 5, 240, null),
  food('Potatoes', 'kg', 'VEGETABLES', null, null, 21),
  food('Onions', 'kg', 'VEGETABLES', null, null, 30),
  food('Garlic', 'pcs', 'VEGETABLES', null, null, 60),
  // Fruit
  food('Apples', 'pcs', 'FRUIT', 28, null, 7),
  food('Bananas', 'pcs', 'FRUIT', null, 60, 5),
  food('Berries', 'pack', 'FRUIT', 4, 240, null),
  food('Grapes', 'pack', 'FRUIT', 7, 300, null),
  food('Oranges', 'pcs', 'FRUIT', 21, null, 7),
  food('Avocado', 'pcs', 'FRUIT', 4, null, 3),
  // Bread, grains and cooked food
  food('Bread', 'pack', 'BAKERY', 7, 90, 4, 5),
  food('Tortillas', 'pack', 'BAKERY', 21, 180, 7, 7),
  food('Fresh pasta', 'pack', 'CHILLED_PACKAGED', 3, 60, null, 2),
  food('Cooked rice', 'g', 'COOKED', 3, 30, null),
  food('Leftovers', 'pcs', 'COOKED', 3, 60, null),
  food('Homemade soup', 'ml', 'COOKED', 3, 90, null),
  food('Hummus', 'g', 'CHILLED_PACKAGED', 5, null, null, 4),
  food('Juice', 'l', 'CHILLED_PACKAGED', 7, 240, null, 5),
];

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
export const CATEGORY_DEFAULTS: Record<FoodCategory, Record<StorageLocation, number | null>> = {
  MEAT_FISH: { FRIDGE: 2, FREEZER: 180, PANTRY: null },
  DAIRY_EGGS: { FRIDGE: 7, FREEZER: 90, PANTRY: null },
  VEGETABLES: { FRIDGE: 7, FREEZER: 240, PANTRY: 5 },
  FRUIT: { FRIDGE: 7, FREEZER: 240, PANTRY: 5 },
  BAKERY: { FRIDGE: 7, FREEZER: 90, PANTRY: 4 },
  COOKED: { FRIDGE: 3, FREEZER: 60, PANTRY: null },
  CHILLED_PACKAGED: { FRIDGE: 5, FREEZER: 90, PANTRY: null },
};

/**
 * Words (lower case) that tell a free-text category, such as the one a photo check returns, which
 * FoodCategory it means. Only used to look a category up; the AI never supplies a number.
 */
const CATEGORY_WORDS: ReadonlyArray<readonly [FoodCategory, readonly string[]]> = [
  ['COOKED', ['cooked', 'leftover', 'ready meal', 'soup', 'curry', 'prepared']],
  ['MEAT_FISH', ['meat', 'fish', 'poultry', 'seafood', 'chicken', 'beef', 'pork', 'lamb', 'shellfish']],
  ['DAIRY_EGGS', ['dairy', 'egg', 'milk', 'cheese', 'yoghurt', 'yogurt', 'butter', 'cream', 'tofu']],
  ['VEGETABLES', ['vegetable', 'veg', 'salad', 'herb', 'greens']],
  ['FRUIT', ['fruit', 'berry', 'berries']],
  ['BAKERY', ['bread', 'bakery', 'baked', 'grain', 'tortilla', 'wrap']],
  ['CHILLED_PACKAGED', ['chilled', 'packaged', 'drink', 'juice', 'dip', 'sauce', 'deli']],
];

/** The category a free-text label means (case-insensitive), or null when it matches none. */
export function categoryFromText(text: string | null | undefined): FoodCategory | null {
  const lower = (text ?? '').trim().toLowerCase();
  if (!lower) return null;
  return CATEGORY_WORDS.find(([, words]) => words.some((word) => lower.includes(word)))?.[0] ?? null;
}

/** Foods that can go in the fridge but are usually kept on the shelf. */
const USUALLY_PANTRY = new Set(['bread', 'tortillas', 'tomatoes', 'avocado', 'oranges']);

/** Where a catalog food is usually kept: the pantry for a few shelf foods, else the fridge, else the pantry, else the freezer. */
export function usualStorage(foodEntry: ReferenceFood): StorageLocation {
  const { lifespanDays } = foodEntry;
  if (USUALLY_PANTRY.has(foodEntry.name.toLowerCase()) && lifespanDays.PANTRY !== null) return 'PANTRY';
  if (lifespanDays.FRIDGE !== null) return 'FRIDGE';
  if (lifespanDays.PANTRY !== null) return 'PANTRY';
  return 'FREEZER';
}
