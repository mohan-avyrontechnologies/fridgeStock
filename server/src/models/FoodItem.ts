import { addDays, FOOD_STATUSES, isValidDate, type DateString, type FoodStatus } from '@cook-first/shared';
import { Schema, Types, model, type HydratedDocument } from 'mongoose';

/**
 * Only the lifecycle status is stored. Time-based urgency (use soon, due,
 * past expected expiry) is derived on every read so it can never go stale.
 * A partly used item stays ACTIVE while quantity remains (FRD FR-FOOD-05).
 *
 * Food dates are "YYYY-MM-DD" strings, never timestamps. They sort correctly
 * as strings, so indexes and range queries work unchanged.
 */
export interface FoodItem {
  userId: Types.ObjectId;
  name: string;
  quantity: number;
  unit: string;
  addedDate: DateString;
  lifespanDays: number;
  expiryDate: DateString;
  status: FoodStatus;
  closedAt?: Date;
}

const calendarDate = {
  type: String,
  required: true,
  validate: { validator: isValidDate, message: 'Must be a "YYYY-MM-DD" calendar date.' },
};

const foodItemSchema = new Schema<FoodItem>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, trim: true },
    addedDate: calendarDate,
    lifespanDays: { type: Number, required: true, min: 0 },
    // Derived: addedDate + lifespanDays. Kept in sync by the pre-validate hook.
    expiryDate: calendarDate,
    status: { type: String, enum: FOOD_STATUSES, default: 'ACTIVE', required: true },
    closedAt: { type: Date },
  },
  // shardKey adds userId to the filter of every save()/deleteOne() on a document.
  { timestamps: true, shardKey: { userId: 1 } },
);

foodItemSchema.pre('validate', function () {
  if (isValidDate(this.addedDate) && this.lifespanDays != null) {
    this.expiryDate = addDays(this.addedDate, this.lifespanDays);
  }
});

foodItemSchema.index({ userId: 1, status: 1 });
foodItemSchema.index({ userId: 1, expiryDate: 1 });

export type FoodItemDoc = HydratedDocument<FoodItem>;
export const FoodItemModel = model<FoodItem>('FoodItem', foodItemSchema);
