import {
  alertFor,
  isQuietHours,
  MEAL_PUSH_ACTIONS,
  PUSH_ACTIONS,
  type DateString,
  type MealContent,
  type MealType,
  type PushKind,
  type PushPayload,
} from '@cook-first/shared';
import { mealCopy, pushCopy } from '../copy.js';
import type { FoodItemDoc } from '../models/FoodItem.js';
import type { UserDoc } from '../models/User.js';
import { clock } from './clock.js';
import { prioritise } from './priorityEngine.js';
import { signActionToken, signMealActionToken } from './token.js';
import { alertsOf } from './userSettings.js';

/** How many items the daily summary names before "and N more". */
export const DIGEST_LINES = 4;

/** Whether it is quiet hours for this person right now (in their time zone). */
export function inQuietHours(user: UserDoc): boolean {
  return isQuietHours(user.timeZone, clock.now(), alertsOf(user).quietHours);
}

/** The sound, vibration, channel and stay-on-screen fields for a push of this kind, sent to this person now. */
export function alertFields(user: UserDoc, kind: PushKind) {
  return alertFor(kind, alertsOf(user), inQuietHours(user));
}

/** A push about one item, with "Used" and "Snooze" buttons. Tapping it opens Food Details. */
export function itemPush(user: UserDoc, food: FoodItemDoc, title: string, body: string, kind: PushKind): PushPayload {
  const id = food._id.toString();
  return {
    title,
    body,
    tag: `food-${id}`,
    url: `/food/${id}`,
    actions: PUSH_ACTIONS.map((action) => ({ action, title: pushCopy.actions[action] })),
    actionToken: signActionToken(user._id.toString(), id),
    kind,
    ...alertFields(user, kind),
  };
}

export interface DigestSummary {
  /** How many items are in Cook First. */
  count: number;
  /** One line each, in Cook First order, then "and N more". */
  lines: string[];
  /** The item, when there is exactly one. */
  only: FoodItemDoc | null;
}

/** The Cook First list, in Cook First order (read, never changed), as lines. Null when there is nothing in it. */
export function digestSummary(foods: FoodItemDoc[], today: DateString): DigestSummary | null {
  const { cookFirst } = prioritise(
    foods.map((doc) => ({
      doc,
      id: doc._id.toString(),
      status: doc.status,
      addedDate: doc.addedDate,
      expiryDate: doc.expiryDate,
    })),
    today,
  );
  if (cookFirst.length === 0) return null;
  const lines = cookFirst.slice(0, DIGEST_LINES).map((item) => pushCopy.digestLine(item.doc.name, item.remainingDays));
  if (cookFirst.length > DIGEST_LINES) lines.push(pushCopy.digestMore(cookFirst.length - DIGEST_LINES));
  return { count: cookFirst.length, lines, only: cookFirst.length === 1 ? cookFirst[0]!.doc : null };
}

/**
 * The daily summary: the Cook First list. With one item it has that item's buttons; with more it opens the
 * Cook First screen.
 */
export function digestPush(user: UserDoc, foods: FoodItemDoc[], today: DateString): PushPayload | null {
  const summary = digestSummary(foods, today);
  if (!summary) return null;
  const title = pushCopy.digestTitle(summary.count);
  if (summary.only) return itemPush(user, summary.only, title, summary.lines.join('\n'), 'DIGEST');
  return {
    title,
    body: summary.lines.join('\n'),
    tag: 'digest',
    url: '/cook-first',
    actions: [],
    kind: 'DIGEST',
    ...alertFields(user, 'DIGEST'),
  };
}

/** The wording of a meal reminder's body. */
export function mealBody(content: MealContent): string {
  switch (content.source) {
    case 'plan':
      return mealCopy.plan(
        content.title,
        content.foods.map((food) => food.name),
      );
    case 'recipe':
      return mealCopy.recipe(
        content.recipe.title,
        content.recipe.minutes,
        content.recipe.uses.map((food) => food.name),
      );
    case 'items':
      return [
        mealCopy.itemsIntro,
        ...content.items.map((item) => pushCopy.digestLine(item.name, item.remainingDays)),
      ].join('\n');
  }
}

/** What the "Cooked it" form is pre-filled from: the planned meal's or the recipe's title. */
function cookedFrom(content: MealContent): string | null {
  return content.source === 'plan' ? content.title : content.source === 'recipe' ? content.recipe.title : null;
}

/**
 * The cooking reminder for one meal. "Cooked it" opens the leftovers form pre-filled, "Show recipe" opens the
 * reminder's page, and "Snooze 30 min" asks the server to remind again (it has no page to open).
 * `summary` is the daily summary, added when the two were within 30 minutes of each other.
 */
export function mealPush(
  user: UserDoc,
  meal: MealType,
  date: DateString,
  content: MealContent,
  summary: DigestSummary | null = null,
): PushPayload {
  const page = `/meal/${meal}`;
  const from = cookedFrom(content);
  const urls: Record<(typeof MEAL_PUSH_ACTIONS)[number], string | undefined> = {
    COOKED: from ? `/add?leftover=1&from=${encodeURIComponent(from)}` : '/add?leftover=1',
    RECIPE: page,
    SNOOZE_MEAL: undefined,
  };
  // The summary repeats the items a plain message already names, so it is only added to the other kinds.
  const body =
    summary && content.source !== 'items'
      ? [mealBody(content), '', pushCopy.digestTitle(summary.count), ...summary.lines].join('\n')
      : mealBody(content);
  return {
    title: mealCopy.title[meal],
    body,
    tag: `meal-${meal}-${date}`,
    url: page,
    actions: MEAL_PUSH_ACTIONS.map((action) => {
      const url = urls[action];
      return { action, title: mealCopy.actions[action], ...(url && { url }) };
    }),
    actionToken: signMealActionToken(user._id.toString(), meal, date),
    kind: 'MEAL',
    ...alertFields(user, 'MEAL'),
  };
}
