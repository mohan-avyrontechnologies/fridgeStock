import { fillTemplate } from '@fridgestock/shared';
import { SERVER_MESSAGES as copy } from '@fridgestock/shared/server-messages';

/**
 * Every user-facing sentence the server produces about expiry comes from here, and
 * nowhere else (tests/foodSafetyCopy.test.ts checks). The sentences themselves live
 * in shared/data/messages.json, which the Python server reads too; this file only
 * fills them in.
 * Food-safety boundary (BRD §10.3): dates are planning estimates. Never claim
 * food is fit to eat; use "expected expiry" wording only.
 */

/** "1 day", "2 days". */
function days(n: number): string {
  return n === 1 ? copy.days.one : fillTemplate(copy.days.other, { n });
}

const lines = (text: readonly string[], values?: Record<string, string | number>) =>
  text.map((line) => fillTemplate(line, values)).join('\n');

/** Reminder messages. {n} is worked out at the moment the reminder is sent. */
export const reminderCopy = {
  APPROACHING_EXPIRY: (name: string, remainingDays: number) =>
    fillTemplate(copy.reminder.APPROACHING_EXPIRY, { name, days: days(remainingDays) }),
  DUE: (name: string) => fillTemplate(copy.reminder.DUE, { name }),
  OVERDUE: (name: string) => fillTemplate(copy.reminder.OVERDUE, { name }),
};

/** Push notifications (Phase 3). Per-item pushes reuse reminderCopy for their text. */
export const pushCopy = {
  title: copy.push.title,
  digestTitle: (count: number) =>
    count === 1 ? copy.push.digestTitle.one : fillTemplate(copy.push.digestTitle.other, { count }),
  /** One line of the daily summary, in FridgeStock order. */
  digestLine: (name: string, remainingDays: number) => {
    if (remainingDays > 0) return fillTemplate(copy.push.digestLine.future, { name, days: days(remainingDays) });
    if (remainingDays === 0) return fillTemplate(copy.push.digestLine.today, { name });
    return fillTemplate(copy.push.digestLine.past, { name });
  },
  digestMore: (count: number) => fillTemplate(copy.push.digestMore, { count }),
  actions: copy.push.actions,
};

/** Sentences stored with an expected expiry that the app changed because the person asked it to. */
export const adjustedCopy = copy.adjusted;

/** AI features (Phase 4): messages shown to the user. */
export const aiCopy = {
  notEnabled: copy.ai.notEnabled,
  failed: copy.ai.failed,
  busy: copy.ai.busy,
  limitReached: (limit: number) => fillTemplate(copy.ai.limitReached, { limit }),
};

/** One line describing an item for an AI prompt, e.g. "F1: Chicken (500 g), expected expiry today". */
export function promptLine(code: string, name: string, quantity: number, unit: string, remainingDays: number): string {
  return fillTemplate(copy.promptLine, {
    code,
    line: pushCopy.digestLine(`${name} (${quantity} ${unit})`, remainingDays),
  });
}

const prompts = copy.aiPrompts;

/**
 * Instructions sent to the AI model. They live with the other expiry
 * wording. They must never contain a banned phrase or comment on food condition.
 */
export const aiPrompts = {
  system: lines(prompts.system),

  /** Receipt scanning. It reads text off a photo and says nothing about food. */
  receiptSystem: lines(prompts.receiptSystem),

  receipt: (knownNames: string[], today: string) =>
    lines(prompts.receipt, { knownNames: knownNames.join(', '), today }),

  /** Photo Check. It may only report visible problems, never anything good. */
  photoSystem: lines(prompts.photoSystem),

  photo: (knownNames: string[]) => lines(prompts.photo, { knownNames: knownNames.join(', ') }),

  /** Reading a date off a pack. It copies text and names the date; it never works out how long food lasts. */
  dateSystem: lines(prompts.dateSystem),

  date: () => prompts.date,

  recipes: (fridgeStock: string[], others: string[], mealType?: string, avoid: string[] = []) =>
    [
      prompts.recipes.intro,
      ...fridgeStock,
      ...(others.length ? ['', prompts.recipes.othersHeading, ...others] : []),
      '',
      prompts.recipes.ask,
      ...(mealType ? [fillTemplate(prompts.recipes.mealType, { mealType })] : []),
      ...(avoid.length ? [fillTemplate(prompts.recipes.avoid, { avoid: avoid.join('; ') })] : []),
      ...prompts.recipes.rules,
    ].join('\n'),

  mealPlan: (dates: string[], items: string[]) =>
    [prompts.mealPlan.intro, ...items, '', lines(prompts.mealPlan.rules, { dates: dates.join(', ') })].join('\n'),

  fixFormat: prompts.fixFormat,
  fixWording: prompts.fixWording,
};

/** "a", "a and b", "a, b and c". */
function list(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Meal-time cooking reminders. The lines naming items reuse pushCopy.digestLine, so they carry the expected-expiry wording. */
export const mealCopy = {
  title: copy.meal.title,
  plan: (title: string, foods: string[]) =>
    foods.length
      ? fillTemplate(copy.meal.plan.withFoods, { title, foods: list(foods) })
      : fillTemplate(copy.meal.plan.withoutFoods, { title }),
  recipe: (title: string, minutes: number, uses: string[]) =>
    fillTemplate(copy.meal.recipe, { title, minutes, uses: list(uses) }),
  itemsIntro: copy.meal.itemsIntro,
  actions: copy.meal.actions,
};
