import { FoodItemModel } from './FoodItem.js';
import { NotificationModel } from './Notification.js';
import { UsageRecordModel } from './UsageRecord.js';

/**
 * Data written before v2.0 stored food dates as BSON dates at UTC midnight.
 * Rewrite any that remain as "YYYY-MM-DD" strings. Safe to run repeatedly:
 * each update only matches values that are still dates.
 */
async function datesToStrings(collection: { updateMany: typeof FoodItemModel.collection.updateMany }, fields: string[]) {
  for (const field of fields) {
    await collection.updateMany({ [field]: { $type: 'date' } }, [
      { $set: { [field]: { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: 'UTC' } } } },
    ]);
  }
}

export async function runMigrations(): Promise<void> {
  await datesToStrings(FoodItemModel.collection, ['addedDate', 'expiryDate']);
  await datesToStrings(NotificationModel.collection, ['expiryDate', 'scheduledDate']);
  await datesToStrings(UsageRecordModel.collection, ['date']);
  // Drops indexes no longer in the schemas (e.g. the pre-v1.3 reminder index).
  await Promise.all([FoodItemModel.syncIndexes(), NotificationModel.syncIndexes(), UsageRecordModel.syncIndexes()]);
}
