import type { AtHomeMatch, ShoppingItem, ShoppingItemInput, ShoppingUpdateInput } from '@fridgestock/shared';
import { isValidObjectId } from 'mongoose';
import { FoodItemModel } from '../models/FoodItem.js';
import { ShoppingItemModel, type ShoppingItemDoc } from '../models/ShoppingItem.js';
import type { UserDoc } from '../models/User.js';
import { clock } from './clock.js';
import { AppError } from './errors.js';
import { prioritise } from './priorityEngine.js';

const notFound = () => new AppError(404, 'NOT_FOUND', 'Shopping item not found.');

/** "Tomatoes" → "tomato", "Eggs" → "egg", "Berries" → "berry". Good enough to match lists. */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('oes')) return word.slice(0, -2);
  if (word.length >= 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

const words = (name: string) =>
  name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(singular);

/**
 * A shopping entry matches food at home when all the words of one appear in
 * the other: "milk" matches "Oat milk", and "chicken breasts" matches "Chicken".
 */
export function sameFood(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (x.length === 0 || y.length === 0) return false;
  return x.every((w) => y.includes(w)) || y.every((w) => x.includes(w));
}

async function activeFood(user: UserDoc) {
  const foods = await FoodItemModel.find({ householdId: user.householdId, status: 'ACTIVE' });
  return prioritise(
    foods.map((doc) => ({
      doc,
      id: doc._id.toString(),
      status: doc.status,
      addedDate: doc.addedDate,
      expiryDate: doc.expiryDate,
    })),
    clock.today(user.timeZone),
  ).items;
}

type ActiveFood = Awaited<ReturnType<typeof activeFood>>;

function toView(doc: ShoppingItemDoc, food: ActiveFood): ShoppingItem {
  const atHome: AtHomeMatch[] = food
    .filter((item) => sameFood(doc.name, item.doc.name))
    .map((item) => ({
      id: item.id,
      name: item.doc.name,
      quantity: item.doc.quantity,
      unit: item.doc.unit,
      expiryDate: item.doc.expiryDate,
      urgency: item.urgency,
    }));
  return {
    id: doc._id.toString(),
    name: doc.name,
    quantity: doc.quantity ?? null,
    unit: doc.unit ?? null,
    checked: doc.checked,
    createdAt: doc.createdAt.toISOString(),
    atHome,
  };
}

/** Still to buy first, then ticked items; each in the order added, with any matching food already at home. */
export async function list(user: UserDoc): Promise<{ items: ShoppingItem[] }> {
  const [items, food] = await Promise.all([
    ShoppingItemModel.find({ householdId: user.householdId }).sort({ checked: 1, createdAt: 1, _id: 1 }),
    activeFood(user),
  ]);
  return { items: items.map((doc) => toView(doc, food)) };
}

export async function add(user: UserDoc, input: ShoppingItemInput): Promise<ShoppingItem> {
  const doc = await ShoppingItemModel.create({
    userId: user._id,
    householdId: user.householdId,
    name: input.name,
    quantity: input.quantity ?? null,
    unit: input.unit ?? null,
  });
  return toView(doc, await activeFood(user));
}

async function findOwned(user: UserDoc, id: string): Promise<ShoppingItemDoc> {
  if (!isValidObjectId(id)) throw notFound();
  const doc = await ShoppingItemModel.findOne({ _id: id, householdId: user.householdId });
  if (!doc) throw notFound();
  return doc;
}

export async function update(user: UserDoc, id: string, input: ShoppingUpdateInput): Promise<ShoppingItem> {
  const doc = await findOwned(user, id);
  if (input.name !== undefined) doc.name = input.name;
  if (input.quantity !== undefined) doc.quantity = input.quantity;
  if (input.unit !== undefined) doc.unit = input.unit;
  if (input.checked !== undefined) doc.checked = input.checked;
  await doc.save();
  return toView(doc, await activeFood(user));
}

export async function remove(user: UserDoc, id: string): Promise<void> {
  const doc = await findOwned(user, id);
  await doc.deleteOne();
}

export async function clearChecked(user: UserDoc): Promise<void> {
  await ShoppingItemModel.deleteMany({ householdId: user.householdId, checked: true });
}
