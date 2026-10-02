import { FoodItemModel } from './FoodItem.js';
import { NotificationModel } from './Notification.js';
import { UsageRecordModel } from './UsageRecord.js';
import { UserModel } from './User.js';
import { FavouriteModel } from './Favourite.js';
import { Types } from 'mongoose';
import { MealPlanEntryModel } from './MealPlanEntry.js';
import { MealReminderLogModel } from './MealReminderLog.js';
import { RecipeIdeaCacheModel } from './RecipeIdeaCache.js';
import { ShoppingItemModel } from './ShoppingItem.js';

/**
 * Data written before v2.0 stored food dates as BSON dates at UTC midnight.
 * Rewrite any that remain as "YYYY-MM-DD" strings. Safe to run repeatedly:
 * each update only matches values that are still dates.
 */
async function datesToStrings(
  collection: { updateMany: typeof FoodItemModel.collection.updateMany },
  fields: string[],
) {
  for (const field of fields) {
    await collection.updateMany({ [field]: { $type: 'date' } }, [
      { $set: { [field]: { $dateToString: { format: '%Y-%m-%d', date: `$${field}`, timezone: 'UTC' } } } },
    ]);
  }
}

/**
 * v2.5 added householdId, storage and openedDate. Give existing users their
 * own household, copy it onto their food items, and default storage to FRIDGE.
 */
async function backfillHouseholdAndStorage() {
  for (const user of await UserModel.collection.find({ householdId: { $exists: false } }).toArray()) {
    await UserModel.collection.updateOne({ _id: user._id }, { $set: { householdId: new Types.ObjectId() } });
  }
  const missing = await FoodItemModel.collection.distinct('userId', { householdId: { $exists: false } });
  for (const userId of missing) {
    const user = await UserModel.collection.findOne({ _id: userId });
    if (user)
      await FoodItemModel.collection.updateMany(
        { userId, householdId: { $exists: false } },
        { $set: { householdId: user.householdId } },
      );
  }
  await FoodItemModel.collection.updateMany({ storage: { $exists: false } }, { $set: { storage: 'FRIDGE' } });
  await FoodItemModel.collection.updateMany({ openedDate: { $exists: false } }, { $set: { openedDate: null } });
  // v2.6: what the user entered, used to learn their usual lifespans.
  await FoodItemModel.collection.updateMany({ enteredLifespanDays: { $exists: false } }, [
    { $set: { enteredLifespanDays: '$lifespanDays', enteredStorage: '$storage' } },
  ]);
}

/**
 * v2.11 shares usage history, the shopping list and the meal plan within a
 * household. Give existing records the household of the user who made them.
 */
async function backfillSharedHouseholds() {
  for (const model of [UsageRecordModel, ShoppingItemModel, MealPlanEntryModel]) {
    const missing = await model.collection.distinct('userId', { householdId: { $exists: false } });
    for (const userId of missing) {
      const user = await UserModel.collection.findOne({ _id: userId });
      if (user) {
        await model.collection.updateMany(
          { userId, householdId: { $exists: false } },
          { $set: { householdId: user.householdId } },
        );
      }
    }
  }
}

export async function runMigrations(): Promise<void> {
  await backfillHouseholdAndStorage();
  await backfillSharedHouseholds();
  // v2.17 added a meal to each plan entry: the ones made before it were all dinners.
  await MealPlanEntryModel.collection.updateMany({ meal: { $exists: false } }, { $set: { meal: 'dinner' } });
  await datesToStrings(FoodItemModel.collection, ['addedDate', 'expiryDate']);
  await datesToStrings(NotificationModel.collection, ['expiryDate', 'scheduledDate']);
  await datesToStrings(UsageRecordModel.collection, ['date']);
  // Drops indexes no longer in the schemas (e.g. the pre-v1.3 reminder index).
  await Promise.all([
    FoodItemModel.syncIndexes(),
    NotificationModel.syncIndexes(),
    UsageRecordModel.syncIndexes(),
    ShoppingItemModel.syncIndexes(),
    MealPlanEntryModel.syncIndexes(),
    UserModel.syncIndexes(),
    FavouriteModel.syncIndexes(),
    MealReminderLogModel.syncIndexes(),
    RecipeIdeaCacheModel.syncIndexes(),
  ]);
}
