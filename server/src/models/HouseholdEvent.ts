import { Schema, Types, model, type HydratedDocument } from 'mongoose';

/** Someone joined or left a household. Food and usage events are read from the food and usage records. */
export interface HouseholdEvent {
  householdId: Types.ObjectId;
  userId: Types.ObjectId;
  /** The name at the time, so the log still reads correctly after they leave or delete their account. */
  actorName: string;
  type: 'MEMBER_JOINED' | 'MEMBER_LEFT';
}

const householdEventSchema = new Schema<HouseholdEvent>(
  {
    householdId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorName: { type: String, required: true },
    type: { type: String, enum: ['MEMBER_JOINED', 'MEMBER_LEFT'], required: true },
  },
  { timestamps: true },
);

householdEventSchema.index({ householdId: 1, createdAt: -1 });

export type HouseholdEventDoc = HydratedDocument<HouseholdEvent>;
export const HouseholdEventModel = model<HouseholdEvent>('HouseholdEvent', householdEventSchema);
