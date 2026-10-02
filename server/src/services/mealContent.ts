import type { FoodRef, MealContent, MealRecipe } from '@cook-first/shared';

/** What is known when a meal reminder is due. */
export interface MealContentInput {
  /** Today's planned meal for this meal, or null. */
  plan: { title: string; foods: FoodRef[] } | null;
  /** Today's cached recipe ideas for this meal type. Empty when AI is off or nothing was made. */
  ideas: MealRecipe[];
  /** Titles of the recipes already sent today for other meals (so none is suggested twice). */
  usedRecipeTitles: Iterable<string>;
  /** The Cook First list, most urgent first, with the days left (what the plain message names). */
  cookFirst: { id: string; name: string; remainingDays: number }[];
}

/** How many Cook First items a plain message names. */
export const MEAL_ITEMS = 3;

/** Recipe titles are compared ignoring case, spaces and punctuation, so "Tomato Soup!" and "tomato  soup" are one. */
export const recipeKey = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Chooses what a meal reminder says, in this order:
 * 1. today's planned meal for that meal;
 * 2. otherwise one of today's cached recipe ideas for that meal type, never one already used for another
 *    meal today (the caller passes no ideas when AI is off);
 * 3. otherwise the top Cook First items with their days left;
 * 4. otherwise nothing: when Cook First is empty and no meal is planned there is nothing to say (and a
 *    cached idea built from food that has since been used up isn't one worth sending).
 * Pure: no database, no clock, no AI.
 */
export function chooseMealContent(input: MealContentInput): MealContent | null {
  if (input.plan) return { source: 'plan', title: input.plan.title, foods: input.plan.foods };
  if (input.cookFirst.length === 0) return null;

  const used = new Set([...input.usedRecipeTitles].map(recipeKey));
  const recipe = input.ideas.find((idea) => !used.has(recipeKey(idea.title)));
  if (recipe) return { source: 'recipe', recipe };

  return { source: 'items', items: input.cookFirst.slice(0, MEAL_ITEMS) };
}
