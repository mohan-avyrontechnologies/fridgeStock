import type { LearnedLifespan, StorageLocation, Unit } from '@fridgestock/shared';
import { FoodItemModel } from '../models/FoodItem.js';
import type { UserDoc } from '../models/User.js';

/** How many of the most recent items per food and location to learn from. */
const RECENT = 10;
/** A suggestion needs at least this many items behind it. */
const MIN_ITEMS = 2;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * The lifespans this user usually sets, per food name (ignoring case) and
 * location: the median of what they entered for their last 10 such items,
 * once there are at least 2. Uses what they entered, not what Move or Opened
 * changed it to. Learned only from the user's own items.
 */
export async function learnedLifespans(user: UserDoc): Promise<LearnedLifespan[]> {
  const items = await FoodItemModel.find(
    // Only lifespans the person typed in: estimates would just teach the app its own numbers back.
    { userId: user._id, enteredByUser: { $ne: false } },
    { name: 1, unit: 1, enteredLifespanDays: 1, enteredStorage: 1, createdAt: 1 },
  ).sort({ createdAt: -1, _id: -1 });

  const groups = new Map<string, { name: string; storage: StorageLocation; unit: Unit; days: number[] }>();
  for (const item of items) {
    const key = `${item.name.trim().toLowerCase()}|${item.enteredStorage}`;
    const group = groups.get(key) ?? { name: item.name, storage: item.enteredStorage, unit: item.unit, days: [] };
    if (group.days.length < RECENT) group.days.push(item.enteredLifespanDays);
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter((g) => g.days.length >= MIN_ITEMS)
    .map((g) => ({ name: g.name, storage: g.storage, unit: g.unit, days: median(g.days), basedOn: g.days.length }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.storage.localeCompare(b.storage));
}
