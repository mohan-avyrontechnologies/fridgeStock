import { MESSAGES, type AccountExport, type DeleteAccountInput } from '@cook-first/shared';
import type { Types } from 'mongoose';
import { AiUsageModel } from '../models/AiUsage.js';
import { FavouriteModel } from '../models/Favourite.js';
import { FoodItemModel } from '../models/FoodItem.js';
import { deletePhotosForFoods, deletePhotosForHousehold, deletePhotosUploadedBy } from '../models/FoodPhoto.js';
import { HouseholdEventModel } from '../models/HouseholdEvent.js';
import { InviteModel } from '../models/Invite.js';
import { MealPlanEntryModel } from '../models/MealPlanEntry.js';
import { NotificationModel } from '../models/Notification.js';
import { PushSubscriptionModel } from '../models/PushSubscription.js';
import { ShoppingItemModel } from '../models/ShoppingItem.js';
import { UsageRecordModel } from '../models/UsageRecord.js';
import { UserModel, type UserDoc } from '../models/User.js';
import { clock } from './clock.js';
import { validationError } from './errors.js';
import { leaveHousehold } from './householdService.js';
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
 *
 * In a shared household they leave first: what they added goes with them and is
 * deleted, while everyone else keeps their food, shopping list and meal plan.
 * What they did to other people's food stays in that household's history, with
 * no name on it.
 */
export async function deleteAccount(user: UserDoc, { password }: DeleteAccountInput): Promise<void> {
  if (!(await passwordHashService.verify(password, user.passwordHash))) {
    throw validationError(MESSAGES.passwordIncorrect, 'password');
  }
  if ((await UserModel.countDocuments({ householdId: user.householdId })) > 1) await leaveHousehold(user);
  const owner = { userId: user._id };
  // Photos go at once: those of the food they added, any they uploaded, and those of their own household.
  const added = await FoodItemModel.find(owner, { _id: 1 });
  await deletePhotosForFoods(added.map((food) => food._id as Types.ObjectId));
  await deletePhotosUploadedBy(user._id);
  await deletePhotosForHousehold(user.householdId);
  await Promise.all([
    FoodItemModel.deleteMany(owner),
    UsageRecordModel.deleteMany({ ...owner, householdId: user.householdId }),
    InviteModel.deleteMany({ createdBy: user._id }),
    HouseholdEventModel.deleteMany(owner),
    NotificationModel.deleteMany(owner),
    PushSubscriptionModel.deleteMany(owner),
    FavouriteModel.deleteMany(owner),
    ShoppingItemModel.deleteMany(owner),
    MealPlanEntryModel.deleteMany(owner),
    AiUsageModel.deleteMany(owner),
  ]);
  await UserModel.deleteOne({ _id: user._id });
}
