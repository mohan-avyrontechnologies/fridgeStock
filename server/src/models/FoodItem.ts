import { Schema, Types, model, type HydratedDocument } from 'mongoose';

/**
 * Only the lifecycle status is stored. Time-based urgency (use soon, due,
 * past expected expiry) is derived on every read so it can never go stale.
 * A partly used item stays ACTIVE while quantity remains (FRD FR-FOOD-05).
 */
export const FOOD_STATUS = ['ACTIVE', 'USED', 'WASTED', 'REMOVED'] as const;
export type FoodStatus = (typeof FOOD_STATUS)[number];

export interface FoodItem {
  userId: Types.ObjectId;
  name: string;
  quantity: number;
  unit: string;
  addedDate: Date;
  lifespanDays: number;
  expiryDate: Date;
  status: FoodStatus;
  closedAt?: Date;
}

const foodItemSchema = new Schema<FoodItem>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, trim: true },
    addedDate: { type: Date, required: true },
    lifespanDays: { type: Number, required: true, min: 0 },
    // Derived: addedDate + lifespanDays. Kept in sync by the pre-validate hook.
    expiryDate: { type: Date, required: true },
    status: { type: String, enum: FOOD_STATUS, default: 'ACTIVE', required: true },
    closedAt: { type: Date },
  },
  { timestamps: true },
);

foodItemSchema.pre('validate', function () {
  if (this.addedDate && this.lifespanDays != null) {
    this.expiryDate = new Date(this.addedDate.getTime() + this.lifespanDays * 86_400_000);
  }
});

foodItemSchema.index({ userId: 1, status: 1 });
foodItemSchema.index({ userId: 1, expiryDate: 1 });

export type FoodItemDoc = HydratedDocument<FoodItem>;
export const FoodItemModel = model<FoodItem>('FoodItem', foodItemSchema);
