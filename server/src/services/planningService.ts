import {
  addDays,
  isValidDate,
  MESSAGES,
  type DateString,
  type FoodRef,
  type MealPlan,
  type MealPlanDraft,
  type MealPlanEntry,
  type MealPlanEntryInput,
  type MealType,
  type RecipeIdeas,
} from '@cook-first/shared';
import { aiPrompts, promptLine } from '../copy.js';
import { FoodItemModel, type FoodItemDoc } from '../models/FoodItem.js';
import { MealPlanEntryModel } from '../models/MealPlanEntry.js';
import { RecipeIdeaCacheModel } from '../models/RecipeIdeaCache.js';
import type { UserDoc } from '../models/User.js';
import * as aiService from './aiService.js';
import { mealPlanOutput, mealPlanSchema, recipeOutput, recipeSchema } from './aiOutputs.js';
import { clock } from './clock.js';
import { validationError } from './errors.js';
import { prioritise } from './priorityEngine.js';

/** How many items (most urgent first) are described to the AI. */
const PROMPT_ITEMS = 25;
/** The meal plan covers today and the next six days. */
const PLAN_DAYS = 7;
const MAX_RECIPES = 3;

const ref = (doc: FoodItemDoc): FoodRef => ({ id: doc._id.toString(), name: doc.name });

/**
 * The user's active food in Cook First order, each with a short code (F1, F2…)
 * for the AI to refer to. The AI only ever reads this order; nothing it
 * returns is used to change it.
 */
async function codedFood(user: UserDoc, today: DateString) {
  const foods = await FoodItemModel.find({ householdId: user.householdId, status: 'ACTIVE' });
  const { items, cookFirst } = prioritise(
    foods.map((doc) => ({
      doc,
      id: doc._id.toString(),
      status: doc.status,
      addedDate: doc.addedDate,
      expiryDate: doc.expiryDate,
    })),
    today,
  );
  // Urgent items have the earliest expected expiry, so Cook First is always the start of the full list.
  const listed = items.slice(0, PROMPT_ITEMS).map((item, rank) => ({
    ...item,
    rank,
    code: `F${rank + 1}`,
    line: promptLine(`F${rank + 1}`, item.doc.name, item.doc.quantity, item.doc.unit, item.remainingDays),
  }));
  const byCode = new Map(listed.map((item) => [item.code, item]));
  /** Known codes only, each once, in Cook First order. */
  const resolve = (codes: string[]) =>
    [...new Set(codes.map((code) => code.trim().toUpperCase()))]
      .map((code) => byCode.get(code))
      .filter((item) => item !== undefined)
      .sort((a, b) => a.rank - b.rank);
  return { listed, cookFirstCount: Math.min(cookFirst.length, listed.length), cookFirst, resolve };
}

// ---- Recipe ideas ----

/**
 * Up to three recipe ideas built from the Cook First list. Each must use at
 * least one Cook First item; ideas are listed by the most urgent item they
 * use. With nothing in Cook First, no AI request is made (and none counted).
 */
export async function suggestRecipes(user: UserDoc, mealType?: MealType): Promise<RecipeIdeas> {
  const today = clock.today(user.timeZone);
  const { listed, cookFirstCount, cookFirst, resolve } = await codedFood(user, today);
  if (cookFirstCount === 0) return { basedOn: [], recipes: [] };

  // For a meal: ideas already made for the household's other meals today, which are not to be repeated.
  const avoid = mealType
    ? (
        await RecipeIdeaCacheModel.find({
          householdId: user.householdId,
          date: today,
          mealType: { $ne: mealType },
        })
      ).flatMap((cached) => cached.recipes.map((recipe) => recipe.title))
    : [];
  const result = await aiService.generate(user, {
    prompt: aiPrompts.recipes(
      listed.slice(0, cookFirstCount).map((item) => item.line),
      listed.slice(cookFirstCount).map((item) => item.line),
      mealType,
      avoid,
    ),
    schema: recipeSchema,
    output: recipeOutput,
    texts: (r) => r.recipes.flatMap((recipe) => [recipe.title, ...recipe.steps]),
    maxTokens: 3000,
  });

  const recipes = result.recipes
    .map((recipe) => ({ recipe, used: resolve(recipe.uses) }))
    .filter(({ used }) => used.some((item) => item.rank < cookFirstCount))
    .sort((a, b) => a.used[0]!.rank - b.used[0]!.rank)
    .slice(0, MAX_RECIPES)
    .map(({ recipe, used }) => ({
      title: recipe.title,
      minutes: recipe.minutes,
      steps: recipe.steps,
      uses: used.map((item) => ref(item.doc)),
    }));
  // Ideas made for a meal are kept for the day, so that meal's reminder can use one without asking again.
  if (mealType) {
    await RecipeIdeaCacheModel.updateOne(
      { householdId: user.householdId, date: today, mealType },
      { $set: { userId: user._id, recipes } },
      { upsert: true },
    );
  }
  return { basedOn: cookFirst.map((item) => ref(item.doc)), recipes };
}

// ---- Weekly meal plan ----

const planDates = (today: DateString) => Array.from({ length: PLAN_DAYS }, (_, i) => addDays(today, i));

async function foodsById(user: UserDoc, ids: string[]) {
  const foods = await FoodItemModel.find({ householdId: user.householdId, _id: { $in: ids } });
  return new Map(foods.map((doc) => [doc._id.toString(), doc]));
}

function toEntry(meal: MealType, title: string, ids: string[], foods: Map<string, FoodItemDoc>): MealPlanEntry {
  return {
    meal,
    title,
    foods: ids
      .map((id) => foods.get(id))
      .filter((doc) => doc !== undefined)
      .map((doc) => ({ ...ref(doc), status: doc.status })),
  };
}

export async function getPlan(user: UserDoc): Promise<MealPlan> {
  const today = clock.today(user.timeZone);
  const dates = planDates(today);
  const entries = await MealPlanEntryModel.find({ householdId: user.householdId, date: { $in: dates } });
  const ids = entries.flatMap((entry) => entry.foodIds.map(String));
  const foods = await foodsById(user, ids);
  const byDay = (date: string) => entries.filter((entry) => entry.date === date);
  return {
    today,
    days: dates.map((date) => {
      const meals: Partial<Record<MealType, MealPlanEntry>> = {};
      for (const entry of byDay(date)) {
        meals[entry.meal] = toEntry(entry.meal, entry.title, entry.foodIds.map(String), foods);
      }
      return { date, entry: meals.dinner ?? null, meals };
    }),
  };
}

/** Sets one meal (dinner unless another is given) for one day (today to six days ahead), using only the household's food. */
export async function setEntry(user: UserDoc, date: string, input: MealPlanEntryInput): Promise<MealPlanEntry> {
  const today = clock.today(user.timeZone);
  if (!isValidDate(date) || !planDates(today).includes(date)) throw validationError(MESSAGES.mealDate, 'date');
  const ids = [...new Set(input.foodIds)];
  const foods = await foodsById(user, ids);
  if (foods.size !== ids.length) throw validationError(MESSAGES.mealFoods, 'foodIds');
  await MealPlanEntryModel.updateOne(
    { householdId: user.householdId, date, meal: input.meal },
    { $set: { title: input.title, foodIds: ids }, $setOnInsert: { userId: user._id } },
    { upsert: true },
  );
  return toEntry(input.meal, input.title, ids, foods);
}

export async function clearEntry(user: UserDoc, date: string, meal: MealType = 'dinner'): Promise<void> {
  await MealPlanEntryModel.deleteOne({ householdId: user.householdId, date, meal });
}

/**
 * A draft for the days that have nothing planned yet. Nothing is saved: the
 * user reviews it and adds it to the plan themselves.
 */
export async function suggestPlan(user: UserDoc): Promise<MealPlanDraft> {
  const today = clock.today(user.timeZone);
  const dates = planDates(today);
  const planned = await MealPlanEntryModel.find({
    householdId: user.householdId,
    date: { $in: dates },
    meal: 'dinner',
  });
  const taken = new Set(planned.map((entry) => entry.date));
  const open = dates.filter((date) => !taken.has(date));
  if (open.length === 0) return { days: [] };

  const { listed, resolve } = await codedFood(user, today);
  const result = await aiService.generate(user, {
    prompt: aiPrompts.mealPlan(
      open,
      listed.map((item) => item.line),
    ),
    schema: mealPlanSchema,
    output: mealPlanOutput,
    texts: (r) => r.days.map((day) => day.title),
    maxTokens: 2000,
  });

  const seen = new Set<string>();
  const days = result.days
    .filter((day) => open.includes(day.date) && !seen.has(day.date) && seen.add(day.date))
    .map((day) => ({ date: day.date, title: day.title, foods: resolve(day.uses).map((item) => ref(item.doc)) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return { days };
}
