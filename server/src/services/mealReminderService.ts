import {
  clockMinutes,
  MEAL_TYPES,
  mergesWithDigest,
  minutesInTz,
  type DateString,
  type MealContent,
  type MealRecipe,
  type MealReminderView,
  type MealType,
} from '@fridgestock/shared';
import { FoodItemModel, type FoodItemDoc } from '../models/FoodItem.js';
import { MealPlanEntryModel } from '../models/MealPlanEntry.js';
import { MealReminderLogModel } from '../models/MealReminderLog.js';
import { RecipeIdeaCacheModel } from '../models/RecipeIdeaCache.js';
import type { UserDoc } from '../models/User.js';
import { aiClient } from './aiClient.js';
import { clock } from './clock.js';
import { markDigestSent } from './digest.js';
import { AppError } from './errors.js';
import { chooseMealContent } from './mealContent.js';
import * as planningService from './planningService.js';
import { prioritise } from './priorityEngine.js';
import { anyPushProvider } from './pushProvider.js';
import { digestSummary, mealPush } from './pushPayloads.js';
import * as pushService from './pushService.js';
import { mealRemindersOf } from './userSettings.js';

/**
 * A meal reminder is sent when its time arrives, and still sent if the job was a few minutes late (it runs
 * every 5 minutes), but not hours later: a dinner reminder at midnight would only be noise.
 */
export const MEAL_CATCH_UP_MINUTES = 30;
/** "Snooze 30 min". */
export const MEAL_SNOOZE_MINUTES = 30;

export const isMeal = (value: string): value is MealType => (MEAL_TYPES as readonly string[]).includes(value);

const notFound = () => new AppError(404, 'NOT_FOUND', 'There is no reminder for that meal today.');

/** Items that aren't snoozed until a later day: snoozed food is left out of reminders, like the daily summary. */
const awake = (food: FoodItemDoc, today: DateString) => !(food.snoozedUntil && food.snoozedUntil > today);

/** Today's cached recipe ideas for this meal, or null when none were made yet. */
async function cachedIdeas(user: UserDoc, meal: MealType, today: DateString): Promise<MealRecipe[] | null> {
  const cached = await RecipeIdeaCacheModel.findOne({ householdId: user.householdId, date: today, mealType: meal });
  return cached ? cached.recipes : null;
}

/**
 * The ideas to choose from: today's cached ones for this meal. When there are none yet and AI is on, they are
 * asked for once and kept, even if the answer is empty or fails, so a busy sweep never asks again and again.
 */
async function ideasFor(user: UserDoc, meal: MealType, today: DateString): Promise<MealRecipe[]> {
  const cached = await cachedIdeas(user, meal, today);
  if (cached) return cached;
  if (!aiClient()) return [];
  try {
    return (await planningService.suggestRecipes(user, meal)).recipes;
  } catch {
    await RecipeIdeaCacheModel.updateOne(
      { householdId: user.householdId, date: today, mealType: meal },
      { $setOnInsert: { userId: user._id, recipes: [] } },
      { upsert: true },
    );
    return [];
  }
}

/** What this meal's reminder should say right now, or null when there is nothing to say. */
async function contentFor(user: UserDoc, meal: MealType, today: DateString): Promise<MealContent | null> {
  const [entry, foods, sentToday] = await Promise.all([
    MealPlanEntryModel.findOne({ householdId: user.householdId, date: today, meal }),
    FoodItemModel.find({ householdId: user.householdId, status: 'ACTIVE' }),
    MealReminderLogModel.find({ userId: user._id, date: today, meal: { $ne: meal } }),
  ]);
  const { fridgeStock } = prioritise(
    foods
      .filter((doc) => awake(doc, today))
      .map((doc) => ({
        doc,
        id: doc._id.toString(),
        status: doc.status,
        addedDate: doc.addedDate,
        expiryDate: doc.expiryDate,
      })),
    today,
  );
  const names = new Map(foods.map((doc) => [doc._id.toString(), doc.name]));
  const plan = entry
    ? {
        title: entry.title,
        foods: entry.foodIds
          .map(String)
          .filter((id) => names.has(id))
          .map((id) => ({ id, name: names.get(id)! })),
      }
    : null;
  // Ideas are only needed when nothing is planned and there is something in FridgeStock to cook.
  const ideas = !plan && fridgeStock.length > 0 ? await ideasFor(user, meal, today) : [];
  return chooseMealContent({
    plan,
    ideas,
    usedRecipeTitles: sentToday.flatMap((log) => (log.recipeTitle ? [log.recipeTitle] : [])),
    fridgeStock: fridgeStock.map((item) => ({ id: item.id, name: item.doc.name, remainingDays: item.remainingDays })),
  });
}

/**
 * Whether the daily summary should wait for a meal reminder that will carry it: some enabled meal reminder is
 * within 30 minutes of the summary's time, hasn't been sent yet, and can still be sent today.
 */
export async function carriesDigest(user: UserDoc): Promise<boolean> {
  const now = minutesInTz(user.timeZone, clock.now());
  const settings = mealRemindersOf(user);
  const sent = await MealReminderLogModel.find({ userId: user._id, date: clock.today(user.timeZone) });
  return MEAL_TYPES.some((meal) => {
    const time = clockMinutes(settings[meal].time);
    return (
      settings[meal].enabled &&
      time !== null &&
      mergesWithDigest(settings[meal].time, user.reminderDelivery.hour) &&
      !sent.some((log) => log.meal === meal) &&
      now < time + MEAL_CATCH_UP_MINUTES
    );
  });
}

/** Sends one meal reminder and records it. Returns false when nothing reached a device (so it can be tried again). */
async function send(
  user: UserDoc,
  meal: MealType,
  today: DateString,
  content: MealContent,
  carryDigest: boolean,
): Promise<boolean> {
  const now = clock.now();
  try {
    await MealReminderLogModel.create({
      userId: user._id,
      householdId: user.householdId,
      date: today,
      meal,
      sentAt: now,
      content,
      recipeTitle: content.source === 'recipe' ? content.recipe.title : null,
    });
  } catch (error) {
    // Already recorded for today (a second sweep got there first): nothing more to do.
    if ((error as { code?: number }).code === 11000) return false;
    throw error;
  }

  let summary = null;
  if (carryDigest) {
    const foods = await FoodItemModel.find({ householdId: user.householdId, status: 'ACTIVE' });
    summary = digestSummary(
      foods.filter((food) => awake(food, today)),
      today,
    );
  }
  const reached = await pushService.sendToUser(user, mealPush(user, meal, today, content, summary));
  if (reached === 0) {
    await MealReminderLogModel.deleteOne({ userId: user._id, date: today, meal });
    return false;
  }
  if (carryDigest) await markDigestSent(user, today, now);
  return true;
}

/**
 * Sends this person's meal reminders that are due, from the 5-minute job:
 * - a reminder whose time has come (within the last 30 minutes) and wasn't sent today, if there is anything
 *   to say (see chooseMealContent);
 * - a reminder snoozed with "Snooze 30 min", once the 30 minutes are up.
 * A reminder within 30 minutes of the daily summary carries the summary, and the summary isn't sent separately.
 */
export async function mealDue(user: UserDoc): Promise<void> {
  if (!anyPushProvider()) return;
  const settings = mealRemindersOf(user);
  if (!MEAL_TYPES.some((meal) => settings[meal].enabled) && !(await hasSnoozed(user))) return;
  if (!(await pushService.hasDevices(user))) return;

  const now = clock.now();
  const today = clock.today(user.timeZone);
  const minutes = minutesInTz(user.timeZone, now);
  const logs = await MealReminderLogModel.find({ userId: user._id, date: today });

  for (const meal of MEAL_TYPES) {
    const log = logs.find((entry) => entry.meal === meal);
    if (log) {
      if (log.snoozedUntil && log.snoozedUntil <= now) {
        log.snoozedUntil = null;
        log.sentAt = now;
        await log.save();
        await pushService.sendToUser(user, mealPush(user, meal, today, log.content));
      }
      continue;
    }

    const setting = settings[meal];
    const time = clockMinutes(setting.time);
    if (!setting.enabled || time === null) continue;
    if (minutes < time || minutes - time >= MEAL_CATCH_UP_MINUTES) continue;

    const content = await contentFor(user, meal, today);
    if (!content) continue;
    const carryDigest =
      user.reminderDelivery.mode === 'DIGEST' &&
      user.lastDigestDate !== today &&
      mergesWithDigest(setting.time, user.reminderDelivery.hour);
    await send(user, meal, today, content, carryDigest);
  }
}

async function hasSnoozed(user: UserDoc): Promise<boolean> {
  return (await MealReminderLogModel.countDocuments({ userId: user._id, snoozedUntil: { $ne: null } })) > 0;
}

/** "Snooze 30 min" on a meal reminder: it is sent again in 30 minutes. */
export async function snoozeMeal(user: UserDoc, meal: MealType, date: DateString): Promise<void> {
  const log = await MealReminderLogModel.findOne({ userId: user._id, date, meal });
  if (!log) throw notFound();
  log.snoozedUntil = new Date(clock.now().getTime() + MEAL_SNOOZE_MINUTES * 60_000);
  await log.save();
}

/** What today's reminder for this meal showed, for the "Show recipe" screen. */
export async function getReminder(user: UserDoc, meal: MealType): Promise<MealReminderView> {
  const date = clock.today(user.timeZone);
  const log = await MealReminderLogModel.findOne({ userId: user._id, date, meal });
  if (!log) throw notFound();
  return { meal, date, content: log.content };
}
