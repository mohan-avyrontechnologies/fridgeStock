import mongoose, { type Types } from 'mongoose';

/**
 * Product photos live in a MongoDB GridFS bucket named "foodPhotos": never in a folder on disk and never
 * behind a public URL. Each food item has at most one photo, stored in two sizes (the files "full" and
 * "thumb"), each tagged with the household that owns it, the food item, and who uploaded it.
 *
 * This is the only place that talks to GridFS directly, like the other models.
 */
const BUCKET = 'foodPhotos';

export type PhotoSize = 'thumb' | 'full';

export interface PhotoOwner {
  householdId: Types.ObjectId;
  foodId: Types.ObjectId;
  uploadedBy: Types.ObjectId;
}

const database = () => mongoose.connection.db!;
const bucket = () => new mongoose.mongo.GridFSBucket(database(), { bucketName: BUCKET });
const files = () => database().collection(`${BUCKET}.files`);

function upload(name: string, data: Buffer, metadata: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = bucket().openUploadStream(name, { metadata });
    stream.once('error', reject);
    stream.once('finish', () => resolve());
    stream.end(data);
  });
}

async function remove(filter: object): Promise<number> {
  const found = await files()
    .find(filter, { projection: { _id: 1 } })
    .toArray();
  await Promise.all(found.map((file) => bucket().delete(file._id)));
  return found.length;
}

/**
 * Stores a photo as the item's only one. The new files are written first and the old ones removed after,
 * so the item is never left without a photo if a write fails.
 */
export async function storePhoto(owner: PhotoOwner, images: Record<PhotoSize, Buffer>): Promise<void> {
  const old = await files()
    .find({ 'metadata.foodId': owner.foodId }, { projection: { _id: 1 } })
    .toArray();
  for (const size of ['full', 'thumb'] as const) {
    await upload(`${owner.foodId}-${size}`, images[size], { ...owner, size });
  }
  await Promise.all(old.map((file) => bucket().delete(file._id)));
}

/** One size of an item's photo, if the household has one for it. */
export async function readPhoto(
  householdId: Types.ObjectId,
  foodId: Types.ObjectId,
  size: PhotoSize,
): Promise<Buffer | null> {
  const file = await files().findOne({
    'metadata.householdId': householdId,
    'metadata.foodId': foodId,
    'metadata.size': size,
  });
  if (!file) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of bucket().openDownloadStream(file._id)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export const deletePhotosForFood = (foodId: Types.ObjectId) => remove({ 'metadata.foodId': foodId });
export const deletePhotosForFoods = (foodIds: Types.ObjectId[]) => remove({ 'metadata.foodId': { $in: foodIds } });
export const deletePhotosForHousehold = (householdId: Types.ObjectId) =>
  remove({ 'metadata.householdId': householdId });
export const deletePhotosUploadedBy = (userId: Types.ObjectId) => remove({ 'metadata.uploadedBy': userId });

/** Every food item that has a photo (the cleanup job checks these against their items). */
export async function foodIdsWithPhotos(): Promise<Types.ObjectId[]> {
  return (await files().distinct('metadata.foodId')) as Types.ObjectId[];
}

/** When food moves to another household (someone joins or leaves), its photos move with it. */
export async function movePhotos(
  filter: { householdId?: Types.ObjectId; foodIds?: Types.ObjectId[] },
  to: Types.ObjectId,
) {
  const query: Record<string, unknown> = {};
  if (filter.householdId) query['metadata.householdId'] = filter.householdId;
  if (filter.foodIds) query['metadata.foodId'] = { $in: filter.foodIds };
  await files().updateMany(query, { $set: { 'metadata.householdId': to } });
}
