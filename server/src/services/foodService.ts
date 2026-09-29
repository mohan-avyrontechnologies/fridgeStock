import type {
  CookFirstList,
  DateString,
  FoodInput,
  FoodItem,
  FoodList,
  FoodStatus,
  FoodUpdateInput,
  UsageAction,
  UsageResult,
  UseFoodInput,
  WasteFoodInput,
} from '@cook-first/shared';
import { isValidObjectId } from 'mongoose';
import { FoodItemModel, type FoodItemDoc } from '../models/FoodItem.js';
import type { UserDoc } from '../models/User.js';
import { clock } from './clock.js';
import { AppError, foodNotFound, validationError } from './errors.js';
import { cancelForFood, scheduleForFood } from './notificationService.js';
import { cookFirst, prioritise, summarise } from './priorityEngine.js';
import { createRecord } from './usageService.js';
import { toFoodView, toUsageView } from './views.js';

/** Avoids 0.30000000000000004-style leftovers after subtracting decimals. */
const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Every lookup is filtered by the owner's id, so another user's item is
 * indistinguishable from a missing one (404 rather than 403, so ids don't leak).
 */
async function findOwned(user: UserDoc, id: string): Promise<FoodItemDoc> {
  if (!isValidObjectId(id)) throw foodNotFound();
  const food = await FoodItemModel.findOne({ _id: id, userId: user._id });
  if (!food) throw foodNotFound();
  return food;
}

function assertActive(food: FoodItemDoc) {
  if (food.status !== 'ACTIVE') {
    throw new AppError(409, 'ITEM_CLOSED', 'This item is no longer in your active inventory.');
  }
}

/** Past dates are fine (food bought earlier); future ones are almost always typos. */
function assertNotFuture(addedDate: DateString, today: DateString) {
  if (addedDate > today) throw validationError("Added date can't be in the future.", 'addedDate');
}

async function prioritisedFor(user: UserDoc) {
  const today = clock.today(user.timeZone);
  const foods = await FoodItemModel.find({ userId: user._id, status: 'ACTIVE' });
  const ordered = prioritise(
    foods.map((doc) => ({ id: doc._id.toString(), status: doc.status, addedDate: doc.addedDate, expiryDate: doc.expiryDate, doc })),
    today,
  );
  return { today, items: ordered.map(({ doc }) => toFoodView(doc, today)) };
}

const CLOSING_STATUS: Record<UsageAction, FoodStatus | null> = {
  USED: 'USED',
  PARTIALLY_USED: null,
  WASTED: 'WASTED',
  REMOVED: 'REMOVED',
};

/**
 * Applies a usage action and writes its usage record. Partial use, and
 * wasting only part of an item, reduce quantity and leave the item active.
 */
async function applyUsage(user: UserDoc, food: FoodItemDoc, action: UsageAction, quantityUsed: number): Promise<UsageResult> {
  const remaining = round(food.quantity - quantityUsed);
  const closingStatus = action === 'WASTED' && remaining > 0 ? null : CLOSING_STATUS[action];

  if (closingStatus) {
    food.status = closingStatus;
    food.closedAt = clock.now();
  } else {
    food.quantity = remaining;
  }
  await food.save();

  const record = await createRecord(user, food, action, quantityUsed, closingStatus ? 0 : remaining);
  if (closingStatus) await cancelForFood(user._id, food._id);
  return { food: toFoodView(food, clock.today(user.timeZone)), usageRecord: toUsageView(record) };
}

export async function listFoods(user: UserDoc): Promise<FoodList> {
  const { today, items } = await prioritisedFor(user);
  return { today, summary: summarise(items), items: items as FoodList['items'] };
}

export async function listCookFirst(user: UserDoc): Promise<CookFirstList> {
  const { today, items } = await prioritisedFor(user);
  return { today, items: cookFirst(items) as CookFirstList['items'] };
}

export async function getFood(user: UserDoc, id: string): Promise<FoodItem> {
  return toFoodView(await findOwned(user, id), clock.today(user.timeZone));
}

export async function createFood(user: UserDoc, input: FoodInput): Promise<FoodItem> {
  const today = clock.today(user.timeZone);
  assertNotFuture(input.addedDate, today);
  const food = await FoodItemModel.create({ userId: user._id, ...input });
  await scheduleForFood(food, user);
  return toFoodView(food, today);
}

export async function updateFood(user: UserDoc, id: string, input: FoodUpdateInput): Promise<FoodItem> {
  const today = clock.today(user.timeZone);
  const food = await findOwned(user, id);
  assertActive(food);
  if (input.addedDate !== undefined) assertNotFuture(input.addedDate, today);
  food.set(input);
  await food.save(); // the pre-validate hook recalculates expiryDate
  await scheduleForFood(food, user);
  return toFoodView(food, today);
}

/** Soft close: the item leaves active inventory but its history is kept. */
export async function removeFood(user: UserDoc, id: string): Promise<void> {
  const food = await findOwned(user, id);
  assertActive(food);
  await applyUsage(user, food, 'REMOVED', food.quantity);
}

export async function useFood(user: UserDoc, id: string, { action, quantityUsed }: UseFoodInput): Promise<UsageResult> {
  const food = await findOwned(user, id);
  assertActive(food);
  if (action === 'USED') return applyUsage(user, food, 'USED', food.quantity);

  if (quantityUsed === undefined) throw validationError('Enter how much you used.', 'quantityUsed');
  if (quantityUsed >= food.quantity) {
    throw validationError(
      `That's all of it (${food.quantity} ${food.unit}). Mark it as fully used instead.`,
      'quantityUsed',
    );
  }
  return applyUsage(user, food, 'PARTIALLY_USED', quantityUsed);
}

export async function wasteFood(user: UserDoc, id: string, { quantityUsed }: WasteFoodInput): Promise<UsageResult> {
  const food = await findOwned(user, id);
  assertActive(food);
  if (quantityUsed !== undefined && quantityUsed > food.quantity) {
    throw validationError(`You only have ${food.quantity} ${food.unit} of this item.`, 'quantityUsed');
  }
  return applyUsage(user, food, 'WASTED', quantityUsed ?? food.quantity);
}
