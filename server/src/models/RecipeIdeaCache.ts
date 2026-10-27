import { isValidDate, MEAL_TYPES, type DateString, type MealRecipe, type MealType } from '@fridgestock/shared';
import { Schema, Types, model, type HydratedDocument } from 'mongoose';

/**
 * The recipe ideas generated for a household's meal on one day, kept so a meal reminder can use one without
 * asking the AI again. The ideas are built from the household's FridgeStock list, so they are shared by its
 * members. Cleared after three days.
 */
export interface RecipeIdeaCache {
  /** Who asked for them (the cache is shared, but the AI request counted against this person). */
  userId: Types.ObjectId;
  householdId: Types.ObjectId;
  /** The day it was made, in the asking person's time zone. */
  date: DateString;
  mealType: MealType;
  recipes: MealRecipe[];
}

const recipeIdeaCacheSchema = new Schema<RecipeIdeaCache>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    householdId: { type: Schema.Types.ObjectId, required: true },
    date: {
      type: String,
      required: true,
      validate: { validator: isValidDate, message: 'Must be a "YYYY-MM-DD" date.' },
    },
    mealType: { type: String, enum: MEAL_TYPES, required: true },
    recipes: { type: Schema.Types.Mixed, default: () => [] },
  },
  { timestamps: true, shardKey: { userId: 1 } },
);

recipeIdeaCacheSchema.index({ householdId: 1, date: 1, mealType: 1 }, { unique: true });
recipeIdeaCacheSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3 * 24 * 60 * 60 });

export type RecipeIdeaCacheDoc = HydratedDocument<RecipeIdeaCache>;
export const RecipeIdeaCacheModel = model<RecipeIdeaCache>('RecipeIdeaCache', recipeIdeaCacheSchema);
