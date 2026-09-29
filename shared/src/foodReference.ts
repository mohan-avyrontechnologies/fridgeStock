import type { StorageLocation, Unit } from './enums.js';

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
  lifespanDays: Record<StorageLocation, number | null>;
  /** Typical days it lasts once opened (packaged foods only; null when opening makes no difference). */
  openedDays: number | null;
}

const food = (
  name: string,
  unit: Unit,
  fridge: number | null,
  freezer: number | null,
  pantry: number | null,
  opened: number | null = null,
): ReferenceFood => ({
  name,
  unit,
  lifespanDays: { FRIDGE: fridge, FREEZER: freezer, PANTRY: pantry },
  openedDays: opened,
});

export const FOOD_REFERENCE: readonly ReferenceFood[] = [
  // Meat and fish
  food('Chicken', 'g', 2, 270, null),
  food('Beef mince', 'g', 2, 120, null),
  food('Steak', 'g', 3, 180, null),
  food('Fish fillets', 'g', 2, 180, null),
  food('Prawns', 'g', 2, 180, null),
  food('Bacon', 'pack', 7, 30, null, 5),
  food('Sausages', 'pack', 3, 60, null, 2),
  food('Sliced ham', 'pack', 4, 60, null, 3),
  // Dairy and eggs
  food('Milk', 'l', 5, 90, null, 4),
  food('Yoghurt', 'g', 7, 60, null, 5),
  food('Hard cheese', 'g', 21, 180, null, 21),
  food('Soft cheese', 'g', 7, null, null, 5),
  food('Butter', 'g', 30, 180, null, 30),
  food('Cream', 'ml', 5, null, null, 3),
  food('Eggs', 'pcs', 21, null, null),
  food('Paneer', 'g', 5, 90, null, 3),
  food('Tofu', 'pack', 5, 90, null, 3),
  // Vegetables and herbs
  food('Spinach', 'bunch', 4, 240, null),
  food('Lettuce', 'pcs', 5, null, null),
  food('Coriander', 'bunch', 5, null, null),
  food('Broccoli', 'pcs', 5, 300, null),
  food('Carrots', 'kg', 21, 300, 7),
  food('Tomatoes', 'pcs', 7, 60, 4),
  food('Cucumber', 'pcs', 7, null, null),
  food('Bell pepper', 'pcs', 7, 240, null),
  food('Mushrooms', 'g', 5, 240, null),
  food('Potatoes', 'kg', null, null, 21),
  food('Onions', 'kg', null, null, 30),
  food('Garlic', 'pcs', null, null, 60),
  // Fruit
  food('Apples', 'pcs', 28, null, 7),
  food('Bananas', 'pcs', null, 60, 5),
  food('Berries', 'pack', 4, 240, null),
  food('Grapes', 'pack', 7, 300, null),
  food('Oranges', 'pcs', 21, null, 7),
  food('Avocado', 'pcs', 4, null, 3),
  // Bread, grains and cooked food
  food('Bread', 'pack', 7, 90, 4, 5),
  food('Tortillas', 'pack', 21, 180, 7, 7),
  food('Fresh pasta', 'pack', 3, 60, null, 2),
  food('Cooked rice', 'g', 3, 30, null),
  food('Leftovers', 'pcs', 3, 60, null),
  food('Homemade soup', 'ml', 3, 90, null),
  food('Hummus', 'g', 5, null, null, 4),
  food('Juice', 'l', 7, 240, null, 5),
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
