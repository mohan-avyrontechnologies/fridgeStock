import { isValidDate, type DateString } from '@cook-first/shared';
import { Schema, Types, model, type HydratedDocument } from 'mongoose';

/** One planned meal on one day. */
export interface MealPlanEntry {
  /** Who first planned this day. */
  userId: Types.ObjectId;
  /** The plan is shared by everyone in the household: one meal per day. */
  householdId: Types.ObjectId;
  date: DateString;
  title: string;
  /** Food items it uses (the household's). */
  foodIds: Types.ObjectId[];
}

const mealPlanEntrySchema = new Schema<MealPlanEntry>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    householdId: { type: Schema.Types.ObjectId, required: true },
    date: {
      type: String,
      required: true,
      validate: { validator: isValidDate, message: 'Must be a "YYYY-MM-DD" date.' },
    },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    foodIds: [{ type: Schema.Types.ObjectId, ref: 'FoodItem' }],
  },
  { timestamps: true, shardKey: { userId: 1 } },
);

mealPlanEntrySchema.index({ householdId: 1, date: 1 }, { unique: true });

export type MealPlanEntryDoc = HydratedDocument<MealPlanEntry>;
export const MealPlanEntryModel = model<MealPlanEntry>('MealPlanEntry', mealPlanEntrySchema);
