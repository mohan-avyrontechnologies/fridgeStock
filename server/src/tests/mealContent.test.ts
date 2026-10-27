import type { MealRecipe } from '@fridgestock/shared';
import { describe, expect, it } from 'vitest';
import { chooseMealContent, MEAL_ITEMS, recipeKey, type MealContentInput } from '../services/mealContent.js';

/** The pure function that decides what a meal reminder says. No database, no clock, no AI. */

const recipe = (title: string): MealRecipe => ({
  title,
  minutes: 20,
  steps: ['Cook it.'],
  uses: [{ id: 'f1', name: 'Bread' }],
});
const item = (name: string, remainingDays: number) => ({ id: name.toLowerCase(), name, remainingDays });

const base: MealContentInput = {
  plan: null,
  ideas: [],
  usedRecipeTitles: [],
  fridgeStock: [item('Bread', 0), item('Chicken', 1)],
};

describe('chooseMealContent', () => {
  it('1. uses the planned meal when there is one, before anything else', () => {
    const plan = { title: 'Porridge', foods: [{ id: 'f1', name: 'Oats' }] };
    expect(chooseMealContent({ ...base, plan, ideas: [recipe('Toast')] })).toEqual({ source: 'plan', ...plan });
  });

  it('a planned meal is sent even when FridgeStock is empty', () => {
    const plan = { title: 'Porridge', foods: [] };
    expect(chooseMealContent({ ...base, plan, fridgeStock: [] })).toEqual({
      source: 'plan',
      title: 'Porridge',
      foods: [],
    });
  });

  it('2. otherwise uses the first of today’s cached recipe ideas', () => {
    const content = chooseMealContent({ ...base, ideas: [recipe('Toast'), recipe('Soup')] });
    expect(content).toEqual({ source: 'recipe', recipe: recipe('Toast') });
  });

  it('skips an idea already used for another meal today, and takes the next', () => {
    const content = chooseMealContent({
      ...base,
      ideas: [recipe('Toast'), recipe('Soup')],
      usedRecipeTitles: ['Toast'],
    });
    expect(content).toEqual({ source: 'recipe', recipe: recipe('Soup') });
  });

  it('compares recipe titles ignoring case, spacing and punctuation', () => {
    expect(recipeKey('  Tomato   Soup! ')).toBe(recipeKey('tomato soup'));
    expect(recipeKey('Mac & Cheese')).toBe(recipeKey('mac cheese'));
    const content = chooseMealContent({
      ...base,
      ideas: [recipe('Tomato Soup!')],
      usedRecipeTitles: ['tomato  soup'],
    });
    expect(content?.source).toBe('items');
  });

  it('3. otherwise names the top FridgeStock items with their days left', () => {
    expect(chooseMealContent(base)).toEqual({ source: 'items', items: [item('Bread', 0), item('Chicken', 1)] });
  });

  it('falls back to the items when every idea has been used', () => {
    const content = chooseMealContent({
      ...base,
      ideas: [recipe('Toast'), recipe('Soup')],
      usedRecipeTitles: ['Toast', 'Soup'],
    });
    expect(content?.source).toBe('items');
  });

  it('names at most three items, in the order given (most urgent first)', () => {
    const fridgeStock = ['A', 'B', 'C', 'D', 'E'].map((name, i) => item(name, i));
    const content = chooseMealContent({ ...base, fridgeStock });
    expect(MEAL_ITEMS).toBe(3);
    expect(content).toEqual({ source: 'items', items: fridgeStock.slice(0, 3) });
  });

  it('4. sends nothing when FridgeStock is empty and no meal is planned', () => {
    expect(chooseMealContent({ ...base, fridgeStock: [] })).toBeNull();
  });

  it('sends nothing for an idea built from food that has since gone, when FridgeStock is empty', () => {
    expect(chooseMealContent({ ...base, fridgeStock: [], ideas: [recipe('Toast')] })).toBeNull();
  });

  it('does not change what it is given', () => {
    const input = structuredClone(base);
    chooseMealContent(input);
    expect(input).toEqual(base);
  });
});
