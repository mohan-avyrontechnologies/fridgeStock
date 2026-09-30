import {
  FOOD_STATUSES,
  isValidDate,
  STORAGE_LOCATIONS,
  UNITS,
  type DateString,
  type FoodStatus,
  type StorageLocation,
  type Unit,
} from '@cook-first/shared';
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
  /** The owner's household; shared households (a later phase) will list items by it. */
  householdId: Types.ObjectId;
  name: string;
  quantity: number;
  unit: Unit;
  addedDate: DateString;
  lifespanDays: number;
  expiryDate: DateString;
  notes?: string;
  storage: StorageLocation;
  /** When the item was opened, if it has been. */
  openedDate?: DateString | null;
  /** The lifespan before "Opened" shortened it, so opening can be undone. */
  lifespanBeforeOpened?: number | null;
  /** Snoozed from a push notification: left out of push reminders until this day. */
  snoozedUntil?: DateString | null;
  /** What the user chose when adding or editing (not changed by Move or Opened); used to learn their usual lifespans. */
  enteredLifespanDays: number;
  enteredStorage: StorageLocation;
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
    householdId: { type: Schema.Types.ObjectId, required: true, index: true },
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
    storage: { type: String, enum: STORAGE_LOCATIONS, default: 'FRIDGE', required: true },
    openedDate: {
      type: String,
      default: null,
      validate: {
        validator: (v: string | null) => v === null || isValidDate(v),
        message: 'Must be a "YYYY-MM-DD" calendar date.',
      },
    },
    lifespanBeforeOpened: { type: Number, default: null },
    snoozedUntil: { type: String, default: null },
    enteredLifespanDays: { type: Number, required: true, min: 0, max: 365 },
    enteredStorage: { type: String, enum: STORAGE_LOCATIONS, required: true },
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
