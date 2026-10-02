import { MESSAGES, type AccountExport, type DeleteAccountInput } from '@cook-first/shared';
import { AiUsageModel } from '../models/AiUsage.js';
import { FavouriteModel } from '../models/Favourite.js';
import { FoodItemModel } from '../models/FoodItem.js';
import { MealPlanEntryModel } from '../models/MealPlanEntry.js';
import { NotificationModel } from '../models/Notification.js';
import { PushSubscriptionModel } from '../models/PushSubscription.js';
import { ShoppingItemModel } from '../models/ShoppingItem.js';
import { UsageRecordModel } from '../models/UsageRecord.js';
import { UserModel, type UserDoc } from '../models/User.js';
import { clock } from './clock.js';
import { validationError } from './errors.js';
import { passwordHashService } from './passwordHash.js';
import { toUserView } from './views.js';

type Raw = Record<string, unknown> & { _id: { toString(): string } };

/** A stored record as plain data: id as a string, no internal owner or version fields. */
function plain({ _id, userId: _userId, householdId: _householdId, __v: _version, ...rest }: Raw) {
  return { id: _id.toString(), ...rest };
}

const rows = async (query: PromiseLike<unknown[]>) => (await query).map((doc) => plain(doc as Raw));

/** Everything the app holds about the user, as one JSON document. Never includes the password hash or push keys. */
export async function exportAccount(user: UserDoc): Promise<AccountExport> {
  const owner = { userId: user._id };
  const [foods, history, reminders, favourites, shopping, mealPlan, pushDevices] = await Promise.all([
    rows(FoodItemModel.find(owner).sort({ _id: 1 }).lean()),
    rows(UsageRecordModel.find(owner).sort({ _id: 1 }).lean()),
    rows(NotificationModel.find(owner).sort({ _id: 1 }).lean()),
    rows(FavouriteModel.find(owner).sort({ _id: 1 }).lean()),
    rows(ShoppingItemModel.find(owner).sort({ _id: 1 }).lean()),
    rows(MealPlanEntryModel.find(owner).sort({ _id: 1 }).lean()),
    PushSubscriptionModel.countDocuments(owner),
  ]);
  return {
    exportedAt: clock.now().toISOString(),
    account: toUserView(user),
    pushDevices,
    foods,
    history,
    reminders,
    favourites,
    shopping,
    mealPlan,
  };
}

/**
 * Permanently deletes the account and everything it owns. The password is asked
 * for again; a wrong one is a 400 (not a 401, which would sign the person out).
 */
export async function deleteAccount(user: UserDoc, { password }: DeleteAccountInput): Promise<void> {
  if (!(await passwordHashService.verify(password, user.passwordHash))) {
    throw validationError(MESSAGES.passwordIncorrect, 'password');
  }
  const owner = { userId: user._id };
  await Promise.all([
    FoodItemModel.deleteMany(owner),
    UsageRecordModel.deleteMany(owner),
    NotificationModel.deleteMany(owner),
    PushSubscriptionModel.deleteMany(owner),
    FavouriteModel.deleteMany(owner),
    ShoppingItemModel.deleteMany(owner),
    MealPlanEntryModel.deleteMany(owner),
    AiUsageModel.deleteMany(owner),
  ]);
  await UserModel.deleteOne({ _id: user._id });
}
