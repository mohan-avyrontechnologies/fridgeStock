import { Schema, Types, model, type HydratedDocument } from 'mongoose';

/** A single-use code that lets one person join a household. Shared by hand: nothing is emailed. */
export interface Invite {
  householdId: Types.ObjectId;
  /** Eight letters and digits, stored without the dash, in capitals. */
  code: string;
  createdBy: Types.ObjectId;
  expiresAt: Date;
}

const inviteSchema = new Schema<Invite>(
  {
    householdId: { type: Schema.Types.ObjectId, required: true, index: true },
    code: { type: String, required: true, unique: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

export type InviteDoc = HydratedDocument<Invite>;
export const InviteModel = model<Invite>('Invite', inviteSchema);
