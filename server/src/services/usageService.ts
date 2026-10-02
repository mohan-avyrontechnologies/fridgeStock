import { USAGE_ACTIONS, type Pagination, type UsageAction, type UsageHistory } from '@cook-first/shared';
import type { Types } from 'mongoose';
import type { FoodItemDoc } from '../models/FoodItem.js';
import { UsageRecordModel, type UsageRecordDoc } from '../models/UsageRecord.js';
import type { UserDoc } from '../models/User.js';
import { clock } from './clock.js';
import { toUsageView } from './views.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The price of the quantity an action covers, or null when the item has no price (or the action is a removal). */
function valueOf(food: FoodItemDoc, action: UsageAction, quantityUsed: number): number | null {
  if (action === 'REMOVED' || food.price == null || !food.priceQuantity) return null;
  return round2((food.price * Math.min(quantityUsed, food.priceQuantity)) / food.priceQuantity);
}

/** Writes one usage record for an action on a food item. */
export function createRecord(
  user: UserDoc,
  food: FoodItemDoc,
  action: UsageAction,
  quantityUsed: number,
  quantityRemaining: number,
): Promise<UsageRecordDoc> {
  return UsageRecordModel.create({
    userId: user._id,
    foodId: food._id,
    action,
    date: clock.today(user.timeZone),
    quantityUsed,
    foodName: food.name,
    unit: food.unit,
    quantityRemaining,
    value: valueOf(food, action, quantityUsed),
  });
}

/** The most recent usage record for one of the user's items. */
export function latestForFood(user: UserDoc, foodId: Types.ObjectId): Promise<UsageRecordDoc | null> {
  return UsageRecordModel.findOne({ userId: user._id, foodId }).sort({ createdAt: -1, _id: -1 });
}

export async function deleteRecord(user: UserDoc, record: UsageRecordDoc): Promise<void> {
  await UsageRecordModel.deleteOne({ _id: record._id, userId: user._id });
}

/** The user's usage/waste history, newest first, with per-action totals. */
export async function listHistory(user: UserDoc, { limit, offset }: Pagination): Promise<UsageHistory> {
  const filter = { userId: user._id };
  const [records, total, grouped] = await Promise.all([
    UsageRecordModel.find(filter).sort({ date: -1, createdAt: -1, _id: -1 }).skip(offset).limit(limit),
    UsageRecordModel.countDocuments(filter),
    UsageRecordModel.aggregate<{ _id: UsageAction; count: number }>([
      { $match: filter },
      { $group: { _id: '$action', count: { $sum: 1 } } },
    ]),
  ]);
  const counts = Object.fromEntries(USAGE_ACTIONS.map((a) => [a, 0])) as Record<UsageAction, number>;
  for (const g of grouped) counts[g._id] = g.count;
  return { items: records.map(toUsageView), total, counts };
}
