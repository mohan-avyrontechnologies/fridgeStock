import { MESSAGES, type Favourite, type FavouriteInput, type FoodItem } from '@cook-first/shared';
import { isValidObjectId } from 'mongoose';
import { FavouriteModel, type FavouriteDoc } from '../models/Favourite.js';
import type { UserDoc } from '../models/User.js';
import { clock } from './clock.js';
import { AppError, conflict } from './errors.js';
import { createFood } from './foodService.js';
import { toFavouriteView } from './views.js';

const favouriteNotFound = () => new AppError(404, 'NOT_FOUND', 'Favourite not found.');

/** Favourites are private to their owner; another user's favourite is a 404. */
async function findOwned(user: UserDoc, id: string): Promise<FavouriteDoc> {
  if (!isValidObjectId(id)) throw favouriteNotFound();
  const favourite = await FavouriteModel.findOne({ _id: id, userId: user._id });
  if (!favourite) throw favouriteNotFound();
  return favourite;
}

export async function listFavourites(user: UserDoc): Promise<Favourite[]> {
  const favourites = await FavouriteModel.find({ userId: user._id }).sort({ nameKey: 1 });
  return favourites.map(toFavouriteView);
}

export async function createFavourite(user: UserDoc, input: FavouriteInput): Promise<Favourite> {
  const nameKey = input.name.trim().toLowerCase();
  if (await FavouriteModel.exists({ userId: user._id, nameKey })) throw conflict(MESSAGES.favouriteExists, 'name');
  try {
    return toFavouriteView(await FavouriteModel.create({ ...input, userId: user._id, nameKey }));
  } catch (error) {
    // Two simultaneous saves can both pass the exists() check.
    if ((error as { code?: number }).code === 11000) throw conflict(MESSAGES.favouriteExists, 'name');
    throw error;
  }
}

export async function removeFavourite(user: UserDoc, id: string): Promise<void> {
  const favourite = await findOwned(user, id);
  await FavouriteModel.deleteOne({ _id: favourite._id, userId: user._id });
}

/** One-tap re-add: a new item from the favourite, added today in the user's time zone. */
export async function addFromFavourite(user: UserDoc, id: string): Promise<FoodItem> {
  const { name, quantity, unit, lifespanDays, storage } = await findOwned(user, id);
  return createFood(user, { name, quantity, unit, lifespanDays, storage, addedDate: clock.today(user.timeZone) });
}
