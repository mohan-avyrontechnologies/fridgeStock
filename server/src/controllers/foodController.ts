import type { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { currentUser } from '../middleware/auth.js';
import { FoodItemModel, type FoodItemDoc, type FoodStatus } from '../models/FoodItem.js';
import { UsageRecordModel, type UsageAction, type UsageRecordDoc } from '../models/UsageRecord.js';
import type { UserDoc } from '../models/User.js';
import { toFoodView, toPrioritisable } from '../services/foodView.js';
import { cancelForFood, scheduleForFood } from '../services/notificationService.js';
import { cookFirst, prioritise, summarise } from '../services/priorityEngine.js';
import { clock } from '../utils/clock.js';
import { parseDateKey, todayIn, toDateKey } from '../utils/dates.js';
import { AppError, notFound } from '../utils/errors.js';

const today = (user: UserDoc) => todayIn(user.timeZone, clock.now());

/** Avoids 0.30000000000000004-style leftovers after subtracting decimals. */
const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Every lookup is filtered by the owner's id, so another user's item is
 * indistinguishable from a missing one (404 rather than 403, so ids don't leak).
 */
async function findOwned(req: Request): Promise<FoodItemDoc> {
  const user = currentUser(req);
  const id = String(req.params.id);
  if (!isValidObjectId(id)) throw notFound();
  const food = await FoodItemModel.findOne({ _id: id, userId: user._id });
  if (!food) throw notFound();
  return food;
}

function assertActive(food: FoodItemDoc) {
  if (food.status !== 'ACTIVE') {
    throw new AppError(409, 'ITEM_CLOSED', 'This item is no longer in your active inventory.');
  }
}

function parseAddedDate(value: string, user: UserDoc): Date {
  const date = parseDateKey(value);
  if (!date) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Added date could not be parsed.', 'addedDate');
  }
  if (date > today(user)) {
    throw new AppError(400, 'VALIDATION_ERROR', "Added date can't be in the future.", 'addedDate');
  }
  return date;
}

async function prioritisedFor(user: UserDoc) {
  const foods = await FoodItemModel.find({ userId: user._id, status: 'ACTIVE' });
  const now = today(user);
  return {
    today: now,
    items: prioritise(foods.map(toPrioritisable), now).map(({ doc }) => toFoodView(doc, now)),
  };
}

const CLOSING_STATUS: Record<UsageAction, FoodStatus | null> = {
  USED: 'USED',
  PARTIALLY_USED: null,
  WASTED: 'WASTED',
  REMOVED: 'REMOVED',
};

/**
 * Applies a usage action and writes its UsageRecord. Partial use, and wasting
 * only part of an item, reduce quantity and leave the item active.
 */
async function recordUsage(
  food: FoodItemDoc,
  user: UserDoc,
  action: UsageAction,
  quantityUsed: number,
) {
  const remaining = round(food.quantity - quantityUsed);
  const closingStatus = action === 'WASTED' && remaining > 0 ? null : CLOSING_STATUS[action];
  const now = clock.now();

  if (closingStatus) {
    food.status = closingStatus;
    food.closedAt = now;
  } else {
    food.quantity = remaining;
  }
  await food.save();

  const record = await UsageRecordModel.create({
    userId: user._id,
    foodId: food._id,
    action,
    date: now,
    quantityUsed,
    foodName: food.name,
    unit: food.unit,
    quantityRemaining: closingStatus ? 0 : remaining,
  });

  if (closingStatus) await cancelForFood(user._id, food._id);
  return record;
}

export function toUsageView(record: UsageRecordDoc) {
  return {
    id: record._id.toString(),
    foodId: record.foodId.toString(),
    foodName: record.foodName,
    unit: record.unit,
    action: record.action,
    date: record.date.toISOString(),
    quantityUsed: record.quantityUsed,
    quantityRemaining: record.quantityRemaining,
  };
}

export const foodController = {
  async list(req: Request, res: Response) {
    const { today: now, items } = await prioritisedFor(currentUser(req));
    res.json({ today: toDateKey(now), summary: summarise(items), items });
  },

  async cookFirst(req: Request, res: Response) {
    const { today: now, items } = await prioritisedFor(currentUser(req));
    res.json({ today: toDateKey(now), items: cookFirst(items) });
  },

  async get(req: Request, res: Response) {
    const food = await findOwned(req);
    res.json(toFoodView(food, today(currentUser(req))));
  },

  async create(req: Request, res: Response) {
    const user = currentUser(req);
    const { name, quantity, unit, addedDate, lifespanDays } = req.body;
    const food = await FoodItemModel.create({
      userId: user._id,
      name,
      quantity,
      unit,
      addedDate: parseAddedDate(addedDate, user),
      lifespanDays,
    });
    await scheduleForFood(food, user);
    res.status(201).json(toFoodView(food, today(user)));
  },

  async update(req: Request, res: Response) {
    const user = currentUser(req);
    const food = await findOwned(req);
    assertActive(food);
    const { name, quantity, unit, addedDate, lifespanDays } = req.body;
    if (name !== undefined) food.name = name;
    if (quantity !== undefined) food.quantity = quantity;
    if (unit !== undefined) food.unit = unit;
    if (addedDate !== undefined) food.addedDate = parseAddedDate(addedDate, user);
    if (lifespanDays !== undefined) food.lifespanDays = lifespanDays;
    await food.save(); // the pre-validate hook recalculates expiryDate
    await scheduleForFood(food, user);
    res.json(toFoodView(food, today(user)));
  },

  async remove(req: Request, res: Response) {
    const user = currentUser(req);
    const food = await findOwned(req);
    assertActive(food);
    // Soft close: the item leaves active inventory but its history is kept.
    await recordUsage(food, user, 'REMOVED', food.quantity);
    res.status(204).end();
  },

  async use(req: Request, res: Response) {
    const user = currentUser(req);
    const food = await findOwned(req);
    assertActive(food);
    const { action, quantityUsed } = req.body as { action: UsageAction; quantityUsed?: number };

    let amount = food.quantity;
    if (action === 'PARTIALLY_USED') {
      if (quantityUsed === undefined) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Enter how much you used.', 'quantityUsed');
      }
      if (quantityUsed >= food.quantity) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          `That's all of it (${food.quantity} ${food.unit}). Mark it as fully used instead.`,
          'quantityUsed',
        );
      }
      amount = quantityUsed;
    }
    const record = await recordUsage(food, user, action, amount);
    res.json({ food: toFoodView(food, today(user)), usageRecord: toUsageView(record) });
  },

  async waste(req: Request, res: Response) {
    const user = currentUser(req);
    const food = await findOwned(req);
    assertActive(food);
    const { quantityUsed } = req.body as { quantityUsed?: number };
    if (quantityUsed !== undefined && quantityUsed > food.quantity) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `You only have ${food.quantity} ${food.unit} of this item.`,
        'quantityUsed',
      );
    }
    const record = await recordUsage(food, user, 'WASTED', quantityUsed ?? food.quantity);
    res.json({ food: toFoodView(food, today(user)), usageRecord: toUsageView(record) });
  },
};
