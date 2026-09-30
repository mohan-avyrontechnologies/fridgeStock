import { addDays, diffDays, findReference, MESSAGES, type StorageLocation } from '@cook-first/shared';
import type {
  ActiveFoodItem,
  BulkCreateInput,
  BulkCreateResult,
  MoveFoodInput,
  OpenFoodInput,
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
import { LEFTOVER_MAX_DAYS } from '../config/ai.js';
import { FoodItemModel, type FoodItemDoc } from '../models/FoodItem.js';
import type { UserDoc } from '../models/User.js';
import { clock } from './clock.js';
import { conflict, foodNotFound, validationError } from './errors.js';
import { cancelForFood, dispatchDue, scheduleForFood } from './notificationService.js';
import { prioritise } from './priorityEngine.js';
import { createRecord, deleteRecord, latestForFood } from './usageService.js';
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

/** An opened date can't be in the future or before the item was added. */
function assertOpenedDate(openedDate: DateString | null | undefined, addedDate: DateString, today: DateString) {
  if (openedDate && (openedDate > today || openedDate < addedDate)) {
    throw validationError(MESSAGES.openedDate, 'openedDate');
  }
}

/** How long after an action its "Undo" still works. */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

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

/** The fields of a new item: owner, household, calculated expiry and a FRIDGE default. */
function newItem(user: UserDoc, input: FoodInput) {
  const { name, quantity, unit, addedDate, lifespanDays, notes, storage, openedDate, leftover } = input;
  return {
    userId: user._id,
    householdId: user.householdId,
    name,
    quantity,
    unit,
    addedDate,
    lifespanDays,
    expiryDate: expiryFor(addedDate, lifespanDays),
    notes: cleanNotes(notes) ?? undefined,
    storage: storage ?? 'FRIDGE',
    openedDate: openedDate ?? null,
    enteredLifespanDays: lifespanDays,
    enteredStorage: storage ?? 'FRIDGE',
    leftover: leftover ?? false,
  };
}

/** Leftovers have a short lifespan: at most LEFTOVER_MAX_DAYS unless frozen. */
function assertLeftoverLifespan(
  leftover: boolean,
  storage: StorageLocation,
  lifespanDays: number,
  field = 'lifespanDays',
) {
  if (leftover && storage !== 'FREEZER' && lifespanDays > LEFTOVER_MAX_DAYS) {
    throw validationError(MESSAGES.leftoverLifespan, field);
  }
}

export async function createFood(user: UserDoc, input: FoodInput): Promise<FoodItem> {
  const today = clock.today(user.timeZone);
  assertNotFuture(input.addedDate, today);
  assertOpenedDate(input.openedDate, input.addedDate, today);
  assertLeftoverLifespan(input.leftover ?? false, input.storage ?? 'FRIDGE', input.lifespanDays);
  const food = await FoodItemModel.create(newItem(user, input));
  await scheduleForFood(food, user);
  return toFoodView(food, today);
}

/** Edits an active item. Changing the added date or lifespan recalculates the expiry and reschedules reminders. */
export async function updateFood(user: UserDoc, id: string, input: FoodUpdateInput): Promise<FoodItem> {
  const today = clock.today(user.timeZone);
  const food = await findOwned(user, id);
  assertActive(food);
  if (input.addedDate !== undefined) assertNotFuture(input.addedDate, today);
  const { name, quantity, unit, addedDate, lifespanDays, notes, storage, openedDate, leftover } = input;
  assertOpenedDate(openedDate, addedDate ?? food.addedDate, today);
  assertLeftoverLifespan(leftover ?? food.leftover, storage ?? food.storage, lifespanDays ?? food.lifespanDays);
  if (name !== undefined) food.name = name;
  if (quantity !== undefined) food.quantity = quantity;
  if (unit !== undefined) food.unit = unit;
  if (addedDate !== undefined) food.addedDate = addedDate;
  if (lifespanDays !== undefined) food.lifespanDays = food.enteredLifespanDays = lifespanDays;
  if (notes !== undefined) food.notes = cleanNotes(notes) ?? undefined;
  if (storage !== undefined) food.storage = food.enteredStorage = storage;
  if (openedDate !== undefined) food.openedDate = openedDate;
  if (leftover !== undefined) food.leftover = leftover;

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

/**
 * Adds a whole shopping haul: every row is checked first, then all are saved
 * together (all or nothing), and each gets its reminders.
 */
export async function bulkCreate(user: UserDoc, input: BulkCreateInput): Promise<BulkCreateResult> {
  const today = clock.today(user.timeZone);
  assertNotFuture(input.addedDate, today);
  const docs = input.items.map((row) =>
    newItem(user, { ...row, addedDate: input.addedDate, storage: row.storage ?? input.storage }),
  );
  const saved = await FoodItemModel.insertMany(docs);
  for (const food of saved) await scheduleForFood(food, user);
  return { items: saved.map((food) => toFoodView(food, today)) };
}

/**
 * Undoes the item's most recent action (used, partly used, wasted or removed)
 * within UNDO_WINDOW_MS. This replaces confirmation dialogs: the app acts at
 * once and offers "Undo". The usage record is deleted so history stays accurate.
 */
export async function undoLastAction(user: UserDoc, id: string): Promise<FoodItem> {
  const food = await findOwned(user, id);
  const record = await latestForFood(user, food._id);
  if (!record) throw conflict(MESSAGES.nothingToUndo);
  if (clock.now().getTime() - record.createdAt.getTime() > UNDO_WINDOW_MS) throw conflict(MESSAGES.undoExpired);

  if (record.action === 'PARTIALLY_USED') {
    food.quantity = round(food.quantity + record.quantityUsed);
  } else {
    food.status = 'ACTIVE';
    food.closedAt = undefined;
    food.quantity = record.quantityUsed;
  }
  await food.save();
  await deleteRecord(user, record);
  if (record.action !== 'PARTIALLY_USED') await scheduleForFood(food, user);
  return toFoodView(food, clock.today(user.timeZone));
}

/** The longest lifespan an item can have. */
const MAX_LIFESPAN = 365;

/** Sets a new expected expiry by changing the lifespan, keeping expiryDate = addedDate + lifespanDays. */
function setExpiry(food: FoodItemDoc, expiryDate: DateString) {
  food.lifespanDays = Math.min(Math.max(diffDays(food.addedDate, expiryDate), 0), MAX_LIFESPAN);
  food.expiryDate = expiryFor(food.addedDate, food.lifespanDays);
}

/**
 * Marks an item as opened. The expected expiry becomes the opened date plus
 * the days it lasts once opened, but only if that is earlier: opening never
 * lengthens it. Without `daysLeft`, the reference list's "once opened" value is used.
 */
export async function openFood(user: UserDoc, id: string, input: OpenFoodInput): Promise<FoodItem> {
  const today = clock.today(user.timeZone);
  const food = await findOwned(user, id);
  assertActive(food);
  if (food.openedDate) throw conflict(MESSAGES.alreadyOpened);
  const openedDate = input.openedDate ?? today;
  assertOpenedDate(openedDate, food.addedDate, today);
  const daysLeft = input.daysLeft ?? findReference(food.name)?.openedDays ?? null;
  if (daysLeft === null) throw validationError(MESSAGES.openedDaysNeeded, 'daysLeft');

  food.lifespanBeforeOpened = food.lifespanDays;
  food.openedDate = openedDate;
  const candidate = addDays(openedDate, daysLeft);
  if (candidate < food.expiryDate) setExpiry(food, candidate);
  await food.save();
  await scheduleForFood(food, user);
  return toFoodView(food, today);
}

/** Undoes "Opened": clears the opened date and restores the lifespan from before. */
export async function undoOpen(user: UserDoc, id: string): Promise<FoodItem> {
  const food = await findOwned(user, id);
  assertActive(food);
  if (!food.openedDate || food.lifespanBeforeOpened == null) throw conflict(MESSAGES.notOpened);
  food.lifespanDays = food.lifespanBeforeOpened;
  food.expiryDate = expiryFor(food.addedDate, food.lifespanDays);
  food.openedDate = null;
  food.lifespanBeforeOpened = null;
  await food.save();
  await scheduleForFood(food, user);
  return toFoodView(food, clock.today(user.timeZone));
}

/**
 * Moves an item to another location. The expected expiry becomes today plus
 * the days it lasts there (the location's reference value unless given),
 * capped so the lifespan stays within 365 days.
 */
export async function moveFood(user: UserDoc, id: string, input: MoveFoodInput): Promise<FoodItem> {
  const today = clock.today(user.timeZone);
  const food = await findOwned(user, id);
  assertActive(food);
  if (food.storage === input.storage) throw validationError(MESSAGES.sameStorage, 'storage');
  const daysLeft = input.daysLeft ?? suggestedDaysIn(food.name, input.storage);
  if (daysLeft === null) throw validationError(MESSAGES.storageDaysNeeded, 'daysLeft');
  assertLeftoverLifespan(food.leftover, input.storage, daysLeft, 'daysLeft');

  food.storage = input.storage;
  setExpiry(food, addDays(today, daysLeft));
  await food.save();
  await scheduleForFood(food, user);
  return toFoodView(food, today);
}

/** The reference list's typical lifespan for this food in a location, if it has one. */
function suggestedDaysIn(name: string, storage: StorageLocation): number | null {
  return findReference(name)?.lifespanDays[storage] ?? null;
}

/** How long "Snooze" on a push notification keeps an item out of push reminders. */
export const SNOOZE_DAYS = 1;

/**
 * Leaves an item out of push reminders until tomorrow, when it is reminded
 * about again. It stays in the Cook First list and in-app reminders as usual.
 */
export async function snoozeFood(user: UserDoc, id: string): Promise<FoodItem> {
  const today = clock.today(user.timeZone);
  const food = await findOwned(user, id);
  assertActive(food);
  food.snoozedUntil = addDays(today, SNOOZE_DAYS);
  await food.save();
  return toFoodView(food, today);
}
