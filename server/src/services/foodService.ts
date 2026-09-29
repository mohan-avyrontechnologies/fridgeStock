import { addDays, MESSAGES } from '@cook-first/shared';
import type {
  ActiveFoodItem,
  CookFirstList,
  DateString,
  FoodInput,
  FoodItem,
  FoodList,
  FoodUpdateInput,
  UsageResult,
  UseFoodInput,
} from '@cook-first/shared';
import { isValidObjectId } from 'mongoose';
import { FoodItemModel, type FoodItemDoc } from '../models/FoodItem.js';
import type { UserDoc } from '../models/User.js';
import { clock } from './clock.js';
import { conflict, foodNotFound, validationError } from './errors.js';
import { cancelForFood, dispatchDue, scheduleForFood } from './notificationService.js';
import { prioritise } from './priorityEngine.js';
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

/** Any action on a used, wasted or removed item is a 409. */
function assertActive(food: FoodItemDoc) {
  if (food.status !== 'ACTIVE') throw conflict(MESSAGES.itemClosed);
}

/** Past dates are fine (food bought earlier); a date after today in the user's time zone is not. */
function assertNotFuture(addedDate: DateString, today: DateString) {
  if (addedDate > today) throw validationError(MESSAGES.addedDate, 'addedDate');
}

async function prioritisedFor(user: UserDoc) {
  const today = clock.today(user.timeZone);
  const foods = await FoodItemModel.find({ userId: user._id, status: 'ACTIVE' });
  const result = prioritise(
    foods.map((doc) => ({
      id: doc._id.toString(),
      status: doc.status,
      addedDate: doc.addedDate,
      expiryDate: doc.expiryDate,
      doc,
    })),
    today,
  );
  const view = (list: typeof result.items) => list.map(({ doc }) => toFoodView(doc, today) as ActiveFoodItem);
  return { today, items: view(result.items), cookFirst: view(result.cookFirst), summary: result.summary };
}

/** The expiry date is always calculated here, never accepted from the client. */
const expiryFor = (addedDate: DateString, lifespanDays: number) => addDays(addedDate, lifespanDays);

/** An empty notes string clears the notes. */
const cleanNotes = (notes: string | undefined) => (notes === undefined ? undefined : notes.trim() || null);

type ClosingAction = 'USED' | 'WASTED' | 'REMOVED';

/**
 * Closes an item: logs the quantity that was left, sets closedAt and deletes
 * its pending reminders.
 */
async function close(user: UserDoc, food: FoodItemDoc, action: ClosingAction): Promise<UsageResult> {
  const quantityLeft = food.quantity;
  food.status = action;
  food.closedAt = clock.now();
  await food.save();
  const record = await createRecord(user, food, action, quantityLeft, 0);
  await cancelForFood(user._id, food._id);
  return { food: toFoodView(food, clock.today(user.timeZone)), usageRecord: toUsageView(record) };
}

/** Uses part of an item: reduces its quantity, logs PARTIALLY_USED, and leaves it active. */
async function usePart(user: UserDoc, food: FoodItemDoc, quantity: number): Promise<UsageResult> {
  const remaining = round(food.quantity - quantity);
  food.quantity = remaining;
  await food.save();
  const record = await createRecord(user, food, 'PARTIALLY_USED', quantity, remaining);
  return { food: toFoodView(food, clock.today(user.timeZone)), usageRecord: toUsageView(record) };
}

/** Delivers due reminders first. A reminder failure is logged and never blocks the inventory. */
async function dispatchSafely(user: UserDoc): Promise<void> {
  try {
    await dispatchDue(user);
  } catch (error) {
    console.error('Reminder dispatch failed', error);
  }
}

export async function listFoods(user: UserDoc): Promise<FoodList> {
  await dispatchSafely(user);
  const { today, items, summary } = await prioritisedFor(user);
  return { today, summary, items };
}

export async function listCookFirst(user: UserDoc): Promise<CookFirstList> {
  const { today, cookFirst } = await prioritisedFor(user);
  return { today, items: cookFirst };
}

/** Any item the user owns, active or closed. */
export async function getFood(user: UserDoc, id: string): Promise<FoodItem> {
  return toFoodView(await findOwned(user, id), clock.today(user.timeZone));
}

export async function createFood(user: UserDoc, input: FoodInput): Promise<FoodItem> {
  const today = clock.today(user.timeZone);
  assertNotFuture(input.addedDate, today);
  const { name, quantity, unit, addedDate, lifespanDays, notes } = input;
  const food = await FoodItemModel.create({
    userId: user._id,
    name,
    quantity,
    unit,
    addedDate,
    lifespanDays,
    expiryDate: expiryFor(addedDate, lifespanDays),
    notes: cleanNotes(notes) ?? undefined,
  });
  await scheduleForFood(food, user);
  return toFoodView(food, today);
}

/** Edits an active item. Changing the added date or lifespan recalculates the expiry and reschedules reminders. */
export async function updateFood(user: UserDoc, id: string, input: FoodUpdateInput): Promise<FoodItem> {
  const today = clock.today(user.timeZone);
  const food = await findOwned(user, id);
  assertActive(food);
  if (input.addedDate !== undefined) assertNotFuture(input.addedDate, today);
  const { name, quantity, unit, addedDate, lifespanDays, notes } = input;
  if (name !== undefined) food.name = name;
  if (quantity !== undefined) food.quantity = quantity;
  if (unit !== undefined) food.unit = unit;
  if (addedDate !== undefined) food.addedDate = addedDate;
  if (lifespanDays !== undefined) food.lifespanDays = lifespanDays;
  if (notes !== undefined) food.notes = cleanNotes(notes) ?? undefined;

  // No Mongoose hook for this: hooks don't run on update queries.
  const datesChanged = addedDate !== undefined || lifespanDays !== undefined;
  if (datesChanged) food.expiryDate = expiryFor(food.addedDate, food.lifespanDays);
  await food.save();
  if (datesChanged) await scheduleForFood(food, user);
  return toFoodView(food, today);
}

/** Soft delete: closes the item as REMOVED; its history is kept. */
export async function removeFood(user: UserDoc, id: string): Promise<void> {
  const food = await findOwned(user, id);
  assertActive(food);
  await close(user, food, 'REMOVED');
}

/**
 * Without a quantity (or with all of it) the whole item is used. A smaller
 * quantity reduces the item and logs PARTIALLY_USED. More than is left is a 400.
 * Zero and negative quantities are rejected by the request schema.
 */
export async function useFood(user: UserDoc, id: string, { quantity }: UseFoodInput): Promise<UsageResult> {
  const food = await findOwned(user, id);
  assertActive(food);
  if (quantity === undefined || quantity === food.quantity) return close(user, food, 'USED');
  if (quantity > food.quantity) {
    throw validationError(`There is only ${food.quantity} ${food.unit} left.`, 'quantity');
  }
  return usePart(user, food, quantity);
}

/** Closes the whole item as WASTED. */
export async function wasteFood(user: UserDoc, id: string): Promise<UsageResult> {
  const food = await findOwned(user, id);
  assertActive(food);
  return close(user, food, 'WASTED');
}
