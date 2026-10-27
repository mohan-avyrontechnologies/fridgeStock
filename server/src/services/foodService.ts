import {
  addDays,
  diffDays,
  estimateExpiry,
  findReference,
  isUsablePrintedDate,
  lifespanFor,
  MESSAGES,
  recalculateExpiry,
  usualStorage,
  USER_EXPLANATION,
  type ExpiryEstimate,
  type ExpirySource,
  type LearnedLifespan,
  type PrintedDateType,
  type StorageLocation,
} from '@fridgestock/shared';
import type {
  ActiveFoodItem,
  BulkCreateInput,
  BulkCreateResult,
  MoveFoodInput,
  OpenFoodInput,
  FridgeStockList,
  DateString,
  FoodInput,
  FoodItem,
  FoodList,
  FoodUpdateInput,
  UsageResult,
  UseFoodInput,
} from '@fridgestock/shared';
import { isValidObjectId } from 'mongoose';
import { LEFTOVER_MAX_DAYS } from '../config/ai.js';
import { FoodItemModel, type FoodItemDoc } from '../models/FoodItem.js';
import type { UserDoc } from '../models/User.js';
import { clock } from './clock.js';
import { conflict, foodNotFound, validationError } from './errors.js';
import { cancelForFood, dispatchDue, scheduleForHousehold } from './notificationService.js';
import { prioritise } from './priorityEngine.js';
import { createRecord, deleteRecord, latestForFood } from './usageService.js';
import { adjustedCopy } from '../copy.js';
import { learnedLifespans } from './suggestionService.js';
import { toFoodView, toUsageView } from './views.js';

/** Avoids 0.30000000000000004-style leftovers after subtracting decimals. */
const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Every lookup is filtered by the owner's id, so another user's item is
 * indistinguishable from a missing one (404 rather than 403, so ids don't leak).
 */
async function findOwned(user: UserDoc, id: string): Promise<FoodItemDoc> {
  if (!isValidObjectId(id)) throw foodNotFound();
  const food = await FoodItemModel.findOne({ _id: id, householdId: user.householdId });
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
  const foods = await FoodItemModel.find({ householdId: user.householdId, status: 'ACTIVE' });
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
  return { today, items: view(result.items), fridgeStock: view(result.fridgeStock), summary: result.summary };
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

export async function listFridgeStock(user: UserDoc): Promise<FridgeStockList> {
  const { today, fridgeStock } = await prioritisedFor(user);
  return { today, items: fridgeStock };
}

/** Any item the user owns, active or closed. */
export async function getFood(user: UserDoc, id: string): Promise<FoodItem> {
  return toFoodView(await findOwned(user, id), clock.today(user.timeZone));
}

/** The pieces of an item's expected expiry that are stored with it. */
interface ExpiryFields {
  lifespanDays: number;
  expiryDate: DateString;
  expirySource: ExpirySource;
  estimateExplanation: string;
}

/** A person-set lifespan: the source is USER. */
function userExpiry(addedDate: DateString, lifespanDays: number): ExpiryFields {
  return {
    lifespanDays,
    expiryDate: expiryFor(addedDate, lifespanDays),
    expirySource: 'USER',
    estimateExplanation: USER_EXPLANATION,
  };
}

/** An estimate as stored fields. An expected expiry before the added date counts as the added date. */
function fromEstimate(addedDate: DateString, estimate: ExpiryEstimate): ExpiryFields {
  const lifespanDays = lifespanFor(addedDate, estimate.expiryDate);
  return {
    lifespanDays,
    expiryDate: expiryFor(addedDate, lifespanDays),
    expirySource: estimate.source,
    estimateExplanation: estimate.explanation,
  };
}

/** What a new item is made from: the form's fields plus the estimate's inputs. */
type NewItemInput = Pick<FoodInput, 'name' | 'quantity' | 'unit'> &
  Partial<Pick<FoodInput, 'lifespanDays' | 'notes' | 'storage' | 'openedDate' | 'leftover' | 'price' | 'category'>> & {
    addedDate: DateString;
    printedDate?: DateString | null;
    printedDateType?: PrintedDateType | null;
  };

/**
 * The fields of a new item: owner, household, expected expiry and its source. A lifespan the person gave
 * is kept as it is (source USER); otherwise the expiry is estimated from the pack's printed date, this
 * household's history, the catalog, the category and a rough default, in that order of preference.
 * With no storage given the catalog's usual place is used (the fridge for an unknown food).
 */
function newItem(user: UserDoc, input: NewItemInput, learned: readonly LearnedLifespan[], today: DateString) {
  const { name, quantity, unit, addedDate, notes, openedDate, leftover, price } = input;
  const catalog = leftover ? findReference('Leftovers') : findReference(name);
  const storage = input.storage ?? (catalog && !leftover ? usualStorage(catalog) : 'FRIDGE');
  const printedDate = input.printedDate && isUsablePrintedDate(input.printedDate, today) ? input.printedDate : null;
  const fields =
    input.lifespanDays !== undefined
      ? userExpiry(addedDate, input.lifespanDays)
      : fromEstimate(
          addedDate,
          estimateExpiry({
            product: { name },
            catalogMatch: catalog ?? null,
            category: input.category,
            storage,
            addedDate,
            today,
            printedDate,
            printedDateType: printedDate ? (input.printedDateType ?? 'UNKNOWN') : null,
            usageHistory: learned,
            openedDate: openedDate ?? null,
          }),
        );
  return {
    userId: user._id,
    householdId: user.householdId,
    name,
    quantity,
    unit,
    addedDate,
    ...fields,
    printedDate,
    printedDateType: printedDate ? (input.printedDateType ?? 'UNKNOWN') : null,
    notes: cleanNotes(notes) ?? undefined,
    storage,
    openedDate: openedDate ?? null,
    enteredLifespanDays: fields.lifespanDays,
    enteredStorage: storage,
    enteredByUser: input.lifespanDays !== undefined,
    leftover: leftover ?? false,
    price: price ?? null,
    priceQuantity: price == null ? null : quantity,
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
  const addedDate = input.addedDate ?? today;
  assertNotFuture(addedDate, today);
  assertOpenedDate(input.openedDate, addedDate, today);
  const learned = input.lifespanDays === undefined ? await learnedLifespans(user) : [];
  const fields = newItem(user, { ...input, addedDate }, learned, today);
  assertLeftoverLifespan(fields.leftover, fields.storage, fields.lifespanDays);
  const food = await FoodItemModel.create(fields);
  await scheduleForHousehold(food);
  return toFoodView(food, today);
}

/**
 * Makes an item due today. It can only bring the expected expiry forward: an item that is already due
 * today or overdue is a 409, so this can never extend one. (Photo Check offers it when a photo shows
 * warning signs; the person confirms first.) The lifespan an item was entered with is left alone, so
 * your usual lifespans aren't learned from it.
 */
export async function useToday(user: UserDoc, id: string): Promise<FoodItem> {
  const today = clock.today(user.timeZone);
  const food = await findOwned(user, id);
  assertActive(food);
  if (food.expiryDate <= today) throw conflict(MESSAGES.alreadyDue);
  food.lifespanDays = diffDays(food.addedDate, today);
  food.expiryDate = today;
  food.expirySource = 'USER';
  food.estimateExplanation = adjustedCopy.photoCheck;
  await food.save();
  await scheduleForHousehold(food);
  return toFoodView(food, today);
}

/** Edits an active item. Changing the added date or lifespan recalculates the expiry and reschedules reminders. */
export async function updateFood(user: UserDoc, id: string, input: FoodUpdateInput): Promise<FoodItem> {
  const today = clock.today(user.timeZone);
  const food = await findOwned(user, id);
  assertActive(food);
  if (input.addedDate !== undefined) assertNotFuture(input.addedDate, today);
  const { name, quantity, unit, addedDate, lifespanDays, notes, storage, openedDate, leftover, price } = input;
  assertOpenedDate(openedDate, addedDate ?? food.addedDate, today);
  assertLeftoverLifespan(leftover ?? food.leftover, storage ?? food.storage, lifespanDays ?? food.lifespanDays);
  if (name !== undefined) food.name = name;
  if (quantity !== undefined) food.quantity = quantity;
  if (unit !== undefined) food.unit = unit;
  if (addedDate !== undefined) food.addedDate = addedDate;
  if (lifespanDays !== undefined) {
    // Editing the estimate makes it the person's own.
    Object.assign(food, userExpiry(food.addedDate, lifespanDays), {
      enteredLifespanDays: lifespanDays,
      enteredByUser: true,
    });
  }
  if (notes !== undefined) food.notes = cleanNotes(notes) ?? undefined;
  if (storage !== undefined) food.storage = food.enteredStorage = storage;
  if (openedDate !== undefined) food.openedDate = openedDate;
  if (leftover !== undefined) food.leftover = leftover;
  // A new price covers the quantity the item has now; clearing it removes both.
  if (price !== undefined) {
    food.price = price;
    food.priceQuantity = price === null ? null : food.quantity;
  }

  // No Mongoose hook for this: hooks don't run on update queries.
  const datesChanged = addedDate !== undefined || lifespanDays !== undefined;
  if (addedDate !== undefined && lifespanDays === undefined && food.expirySource === 'PRINTED_DATE') {
    // The pack's date doesn't move with the added date.
    food.lifespanDays = lifespanFor(food.addedDate, food.expiryDate);
  }
  if (datesChanged) food.expiryDate = expiryFor(food.addedDate, food.lifespanDays);
  await food.save();
  if (datesChanged) await scheduleForHousehold(food);
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
  const learned = input.items.some((row) => row.lifespanDays === undefined) ? await learnedLifespans(user) : [];
  const docs = input.items.map((row) =>
    newItem(user, { ...row, addedDate: input.addedDate, storage: row.storage ?? input.storage }, learned, today),
  );
  const saved = await FoodItemModel.insertMany(docs);
  for (const food of saved) await scheduleForHousehold(food);
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
  if (record.action !== 'PARTIALLY_USED') await scheduleForHousehold(food);
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
 * Re-estimates an item that was just moved or opened. It can only bring the expected expiry forward: a
 * new estimate that is the same or later changes nothing (see recalculateExpiry in the shared package),
 * and a rough FALLBACK guess never replaces a date the person set.
 */
async function recalculate(user: UserDoc, food: FoodItemDoc, today: DateString): Promise<void> {
  const next = recalculateExpiry(food.expiryDate, {
    product: { name: food.name },
    catalogMatch: food.leftover ? findReference('Leftovers') : undefined,
    storage: food.storage,
    addedDate: food.addedDate,
    today,
    printedDate: food.printedDate,
    printedDateType: food.printedDateType,
    usageHistory: await learnedLifespans(user),
    openedDate: food.openedDate,
  });
  if (!next) return;
  // A rough guess is no reason to override a date the person chose.
  if (next.source === 'FALLBACK' && food.expirySource === 'USER') return;
  const fields = fromEstimate(food.addedDate, next);
  // Never later, even once the added date's whole days are rounded.
  if (fields.expiryDate >= food.expiryDate) return;
  Object.assign(food, fields);
}

/** A person-given number of days: the expected expiry the person chose, which may be later than the old one for a move. */
function setByUser(food: FoodItemDoc, expiryDate: DateString, explanation: string) {
  setExpiry(food, expiryDate);
  food.expirySource = 'USER';
  food.estimateExplanation = explanation;
}

/**
 * Marks an item as opened. Without `daysLeft`, the expected expiry is re-estimated (the catalog's
 * once-opened lifespan counted from the opened date) and only ever gets shorter. With `daysLeft`, the
 * person chose how long it lasts once opened (source USER), still only if that is earlier.
 */
export async function openFood(user: UserDoc, id: string, input: OpenFoodInput): Promise<FoodItem> {
  const today = clock.today(user.timeZone);
  const food = await findOwned(user, id);
  assertActive(food);
  if (food.openedDate) throw conflict(MESSAGES.alreadyOpened);
  const openedDate = input.openedDate ?? today;
  assertOpenedDate(openedDate, food.addedDate, today);

  food.lifespanBeforeOpened = food.lifespanDays;
  food.sourceBeforeOpened = food.expirySource;
  food.explanationBeforeOpened = food.estimateExplanation;
  food.openedDate = openedDate;
  if (input.daysLeft !== undefined) {
    const candidate = addDays(openedDate, input.daysLeft);
    if (candidate < food.expiryDate) setByUser(food, candidate, 'You set how long this lasts once opened.');
  } else {
    await recalculate(user, food, today);
  }
  await food.save();
  await scheduleForHousehold(food);
  return toFoodView(food, today);
}

/** Undoes "Opened": clears the opened date and restores the lifespan from before. */
export async function undoOpen(user: UserDoc, id: string): Promise<FoodItem> {
  const food = await findOwned(user, id);
  assertActive(food);
  if (!food.openedDate || food.lifespanBeforeOpened == null) throw conflict(MESSAGES.notOpened);
  food.lifespanDays = food.lifespanBeforeOpened;
  food.expiryDate = expiryFor(food.addedDate, food.lifespanDays);
  if (food.sourceBeforeOpened) food.expirySource = food.sourceBeforeOpened;
  if (food.explanationBeforeOpened != null) food.estimateExplanation = food.explanationBeforeOpened;
  food.openedDate = null;
  food.lifespanBeforeOpened = null;
  food.sourceBeforeOpened = null;
  food.explanationBeforeOpened = null;
  await food.save();
  await scheduleForHousehold(food);
  return toFoodView(food, clock.today(user.timeZone));
}

/**
 * Moves an item to another location. Without `daysLeft` the expected expiry is re-estimated for the new
 * place and only ever gets shorter. With `daysLeft` (counted from today) the person chose it (source USER),
 * and that may be later, for example when moving food to the freezer.
 */
export async function moveFood(user: UserDoc, id: string, input: MoveFoodInput): Promise<FoodItem> {
  const today = clock.today(user.timeZone);
  const food = await findOwned(user, id);
  assertActive(food);
  if (food.storage === input.storage) throw validationError(MESSAGES.sameStorage, 'storage');
  if (input.daysLeft !== undefined) assertLeftoverLifespan(food.leftover, input.storage, input.daysLeft, 'daysLeft');

  food.storage = input.storage;
  if (input.daysLeft !== undefined) {
    setByUser(food, addDays(today, input.daysLeft), 'You set how long this lasts in its new place.');
  } else {
    await recalculate(user, food, today);
  }
  await food.save();
  await scheduleForHousehold(food);
  return toFoodView(food, today);
}

/** How long "Snooze" on a push notification keeps an item out of push reminders. */
export const SNOOZE_DAYS = 1;

/**
 * Leaves an item out of push reminders until tomorrow, when it is reminded
 * about again. It stays in the FridgeStock list and in-app reminders as usual.
 */
export async function snoozeFood(user: UserDoc, id: string): Promise<FoodItem> {
  const today = clock.today(user.timeZone);
  const food = await findOwned(user, id);
  assertActive(food);
  food.snoozedUntil = addDays(today, SNOOZE_DAYS);
  await food.save();
  return toFoodView(food, today);
}
