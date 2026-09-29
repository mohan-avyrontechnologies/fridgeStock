import { Schema, Types, model, type HydratedDocument } from 'mongoose';

export const USAGE_ACTIONS = ['USED', 'PARTIALLY_USED', 'WASTED', 'REMOVED'] as const;
export type UsageAction = (typeof USAGE_ACTIONS)[number];

export interface UsageRecord {
  userId: Types.ObjectId;
  foodId: Types.ObjectId;
  action: UsageAction;
  date: Date;
  quantityUsed: number;
  foodName: string;
  unit: string;
  quantityRemaining: number;
}

const usageRecordSchema = new Schema<UsageRecord>(
  {
    // userId is not in the TDD entity, but history is listed per user and every
    // query must be scoped to its owner, so it is stored rather than joined.
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    foodId: { type: Schema.Types.ObjectId, ref: 'FoodItem', required: true, index: true },
    action: { type: String, enum: USAGE_ACTIONS, required: true },
    date: { type: Date, required: true },
    quantityUsed: { type: Number, required: true, min: 0 },
    // Snapshots so history still reads correctly after later edits.
    foodName: { type: String, required: true },
    unit: { type: String, required: true },
    quantityRemaining: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

usageRecordSchema.index({ userId: 1, date: -1, _id: -1 });

export type UsageRecordDoc = HydratedDocument<UsageRecord>;
export const UsageRecordModel = model<UsageRecord>('UsageRecord', usageRecordSchema);
