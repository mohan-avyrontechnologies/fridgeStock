import { FOOD_STATUSES, isValidDate, UNITS, type DateString, type FoodStatus, type Unit } from '@cook-first/shared';
import { Schema, Types, model, type HydratedDocument } from 'mongoose';

/**
 * Only the lifecycle status is stored. Urgency (NOT_URGENT, APPROACHING_EXPIRY,
 * DUE, OVERDUE) is calculated every time items are read. A partly used item
 * stays ACTIVE while quantity remains (FRD FR-FOOD-05).
 *
 * Food dates are "YYYY-MM-DD" strings, never timestamps. expiryDate is always
 * addedDate + lifespanDays, calculated in services/foodService.ts. There is
 * deliberately no Mongoose hook for it: hooks don't run on update queries.
 */
export interface FoodItem {
  userId: Types.ObjectId;
  name: string;
  quantity: number;
  unit: Unit;
  addedDate: DateString;
  lifespanDays: number;
  expiryDate: DateString;
  notes?: string;
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
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    quantity: {
      type: Number,
      required: true,
      validate: { validator: (n: number) => n > 0, message: 'Quantity must be greater than zero.' },
    },
    unit: { type: String, required: true, enum: UNITS },
    addedDate: calendarDate,
    lifespanDays: {
      type: Number,
      required: true,
      min: 0,
      max: 365,
      validate: { validator: Number.isInteger, message: 'Lifespan must be a whole number of days.' },
    },
    expiryDate: calendarDate,
    notes: { type: String, trim: true, maxlength: 200 },
    status: { type: String, enum: FOOD_STATUSES, default: 'ACTIVE', required: true },
    closedAt: { type: Date },
  },
  // shardKey adds userId to the filter of every save()/deleteOne() on a document.
  { timestamps: true, shardKey: { userId: 1 } },
);

foodItemSchema.index({ userId: 1, status: 1 });
foodItemSchema.index({ userId: 1, expiryDate: 1 });

export type FoodItemDoc = HydratedDocument<FoodItem>;
export const FoodItemModel = model<FoodItem>('FoodItem', foodItemSchema);
