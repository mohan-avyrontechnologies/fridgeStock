import {
  MESSAGES,
  PHOTO_FULL_PIXELS,
  PHOTO_RETENTION_DAYS,
  PHOTO_THUMB_PIXELS,
  type FoodItem,
} from '@cook-first/shared';
import { isValidObjectId, type Types } from 'mongoose';
import sharp from 'sharp';
import { FoodItemModel, type FoodItemDoc } from '../models/FoodItem.js';
import {
  deletePhotosForFood,
  deletePhotosForFoods,
  foodIdsWithPhotos,
  readPhoto,
  storePhoto,
  type PhotoSize,
} from '../models/FoodPhoto.js';
import type { UserDoc } from '../models/User.js';
import { clock } from './clock.js';
import { conflict, foodNotFound, validationError } from './errors.js';
import { toFoodView } from './views.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Refuses a decompression bomb: a small file that would open into an enormous picture. */
const MAX_INPUT_PIXELS = 50_000_000;
const WEBP_QUALITY = 80;

type ImageKind = 'jpeg' | 'png' | 'webp';

const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Whether `bytes` starts with `prefix`, at `offset`. */
const startsWith = (bytes: Buffer, prefix: Buffer, offset = 0) =>
  bytes.subarray(offset, offset + prefix.length).equals(prefix);

/** What the file really is, from its first bytes. The type the browser claims is never trusted. */
export function detectImageType(bytes: Buffer): ImageKind | null {
  if (startsWith(bytes, JPEG)) return 'jpeg';
  if (startsWith(bytes, PNG)) return 'png';
  if (startsWith(bytes, Buffer.from('RIFF', 'latin1')) && startsWith(bytes, Buffer.from('WEBP', 'latin1'), 8))
    return 'webp';
  return null;
}

/**
 * Re-encodes a photo as WebP in two sizes. Decoding and re-encoding is what makes it safe to keep: the output
 * is a new file made only from the pixels, so EXIF data (including the GPS location, camera details and
 * any text) is gone, and anything hidden in the original file does not survive. The photo's orientation is
 * applied first so it still looks the right way up.
 */
export async function processPhoto(input: Buffer): Promise<Record<PhotoSize, Buffer>> {
  const render = (pixels: number) =>
    sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate()
      .resize({ width: pixels, height: pixels, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  try {
    const [full, thumb] = await Promise.all([render(PHOTO_FULL_PIXELS), render(PHOTO_THUMB_PIXELS)]);
    return { full, thumb };
  } catch {
    throw validationError(MESSAGES.photoUnreadable, 'photo');
  }
}

/** One of the household's items: any other household's is a 404, like a missing one. */
async function findOwned(user: UserDoc, id: string): Promise<FoodItemDoc> {
  if (!isValidObjectId(id)) throw foodNotFound();
  const food = await FoodItemModel.findOne({ _id: id, householdId: user.householdId });
  if (!food) throw foodNotFound();
  return food;
}

/** Sets (or replaces) the item's photo. One photo per item: a new one replaces the old. */
export async function uploadPhoto(user: UserDoc, id: string, file: Buffer | undefined): Promise<FoodItem> {
  if (!user.savePhotos) throw conflict(MESSAGES.photosOff);
  const food = await findOwned(user, id);
  if (food.status !== 'ACTIVE') throw conflict(MESSAGES.photoClosed);
  if (!file || file.length === 0) throw validationError(MESSAGES.photoMissing, 'photo');
  if (detectImageType(file) === null) throw validationError(MESSAGES.photoType, 'photo');

  const images = await processPhoto(file);
  await storePhoto({ householdId: food.householdId, foodId: food._id, uploadedBy: user._id }, images);
  food.photoAt = clock.now();
  await food.save();
  return toFoodView(food, clock.today(user.timeZone));
}

/** An item's photo bytes, for the signed-in household only. */
export async function getPhoto(user: UserDoc, id: string, size: PhotoSize): Promise<Buffer> {
  const food = await findOwned(user, id);
  const bytes = food.photoAt ? await readPhoto(user.householdId, food._id, size) : null;
  if (!bytes) throw foodNotFound();
  return bytes;
}

export async function removePhoto(user: UserDoc, id: string): Promise<void> {
  const food = await findOwned(user, id);
  await deletePhotosForFood(food._id);
  food.photoAt = null;
  await food.save();
}

/**
 * Deletes the photo of every item that was closed (used, wasted or removed) more than PHOTO_RETENTION_DAYS
 * ago, and any photo whose item no longer exists. Runs daily. Undoing a closed item within the day it was
 * closed keeps its photo, because it only goes after the full 30 days.
 */
export async function purgeClosedPhotos(now: Date = clock.now()): Promise<number> {
  const cutoff = new Date(now.getTime() - PHOTO_RETENTION_DAYS * DAY_MS);
  const withPhotos = await foodIdsWithPhotos();
  if (withPhotos.length === 0) return 0;

  const [existing, closedLong] = await Promise.all([
    FoodItemModel.find({ _id: { $in: withPhotos } }, { _id: 1 }),
    FoodItemModel.find({ _id: { $in: withPhotos }, status: { $ne: 'ACTIVE' }, closedAt: { $lt: cutoff } }, { _id: 1 }),
  ]);
  const known = new Set(existing.map((food) => String(food._id)));
  const orphans = withPhotos.filter((id) => !known.has(id.toString()));
  const closedIds = closedLong.map((food) => food._id as Types.ObjectId);

  const doomed = [...closedIds, ...orphans];
  if (doomed.length === 0) return 0;
  const removed = await deletePhotosForFoods(doomed);
  await FoodItemModel.updateMany({ _id: { $in: closedIds } }, { $set: { photoAt: null } });
  return removed;
}
