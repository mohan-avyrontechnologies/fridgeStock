import { STORAGE_LOCATIONS, UNITS, type StorageLocation, type Unit } from '@fridgestock/shared';
import { Schema, Types, model, type HydratedDocument } from 'mongoose';

/** A food the user re-adds often; one tap creates a new item from it. */
export interface Favourite {
  userId: Types.ObjectId;
  name: string;
  /** Lower-case name, so "Milk" and "milk" can't both be favourites. */
  nameKey: string;
  quantity: number;
  unit: Unit;
  lifespanDays: number;
  storage: StorageLocation;
}

const favouriteSchema = new Schema<Favourite>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    nameKey: { type: String, required: true },
    quantity: { type: Number, required: true, validate: { validator: (n: number) => n > 0 } },
    unit: { type: String, required: true, enum: UNITS },
    lifespanDays: { type: Number, required: true, min: 0, max: 365 },
    storage: { type: String, required: true, enum: STORAGE_LOCATIONS, default: 'FRIDGE' },
  },
  { timestamps: true, shardKey: { userId: 1 } },
);

favouriteSchema.index({ userId: 1, nameKey: 1 }, { unique: true });

export type FavouriteDoc = HydratedDocument<Favourite>;
export const FavouriteModel = model<Favourite>('Favourite', favouriteSchema);
