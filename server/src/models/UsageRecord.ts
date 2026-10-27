import { isValidDate, USAGE_ACTIONS, type DateString, type UsageAction } from '@fridgestock/shared';
import { Schema, Types, model, type HydratedDocument } from 'mongoose';
import { clock } from '../services/clock.js';

export interface UsageRecord {
  // userId is not in the TDD entity, but history is listed per user and every
  // query must be scoped to its owner, so it is stored rather than joined.
  /** Who did it. */
  userId: Types.ObjectId;
  /** The household that owns the food; history is shared by everyone in it. */
  householdId: Types.ObjectId;
  foodId: Types.ObjectId;
  action: UsageAction;
  /** The user's calendar day when the action was recorded. */
  date: DateString;
  quantityUsed: number;
  // Snapshots so history still reads correctly after later edits.
  foodName: string;
  unit: string;
  quantityRemaining: number;
  /** The price of quantityUsed when the item had a price, else null. */
  value?: number | null;
  /** Exact time of the action (set by timestamps). */
  createdAt: Date;
}

const usageRecordSchema = new Schema<UsageRecord>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    householdId: { type: Schema.Types.ObjectId, required: true, index: true },
    foodId: { type: Schema.Types.ObjectId, ref: 'FoodItem', required: true, index: true },
    action: { type: String, enum: USAGE_ACTIONS, required: true },
    date: {
      type: String,
      required: true,
      validate: { validator: isValidDate, message: 'Must be a "YYYY-MM-DD" calendar date.' },
    },
    quantityUsed: { type: Number, required: true, min: 0 },
    foodName: { type: String, required: true },
    unit: { type: String, required: true },
    quantityRemaining: { type: Number, required: true, min: 0 },
    value: { type: Number, default: null, min: 0 },
  },
  // Timestamps come from the app clock, so "Undo" windows are measured on the same clock as everything else.
  { timestamps: { currentTime: () => clock.now() }, shardKey: { userId: 1 } },
);

usageRecordSchema.index({ userId: 1, date: -1, createdAt: -1 });
usageRecordSchema.index({ householdId: 1, date: -1, createdAt: -1 });

export type UsageRecordDoc = HydratedDocument<UsageRecord>;
export const UsageRecordModel = model<UsageRecord>('UsageRecord', usageRecordSchema);
