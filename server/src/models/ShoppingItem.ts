import { UNITS, type Unit } from '@cook-first/shared';
import { Schema, Types, model, type HydratedDocument } from 'mongoose';

export interface ShoppingItem {
  userId: Types.ObjectId;
  name: string;
  quantity: number | null;
  unit: Unit | null;
  checked: boolean;
  createdAt: Date;
}

const shoppingItemSchema = new Schema<ShoppingItem>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    quantity: { type: Number, default: null },
    unit: { type: String, enum: UNITS, default: null },
    checked: { type: Boolean, default: false },
  },
  // shardKey adds userId to the filter of every save()/deleteOne() on a document.
  { timestamps: true, shardKey: { userId: 1 } },
);

shoppingItemSchema.index({ userId: 1, checked: 1, createdAt: 1 });

export type ShoppingItemDoc = HydratedDocument<ShoppingItem>;
export const ShoppingItemModel = model<ShoppingItem>('ShoppingItem', shoppingItemSchema);
