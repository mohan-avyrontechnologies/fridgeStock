import type { DateString } from '@cook-first/shared';
import { Schema, Types, model } from 'mongoose';

/** How many AI requests a user has made on one of their calendar days (for the daily limit). */
export interface AiUsage {
  userId: Types.ObjectId;
  date: DateString;
  count: number;
}

const aiUsageSchema = new Schema<AiUsage>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
  },
  { timestamps: true, shardKey: { userId: 1 } },
);

aiUsageSchema.index({ userId: 1, date: 1 }, { unique: true });

export const AiUsageModel = model<AiUsage>('AiUsage', aiUsageSchema);
