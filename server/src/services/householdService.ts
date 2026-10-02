import { randomInt } from 'node:crypto';
import {
  MESSAGES,
  type ActivityEvent,
  type ActivityLog,
  type Household,
  type HouseholdInvite,
  type JoinHouseholdInput,
  type Pagination,
} from '@cook-first/shared';
import { Types } from 'mongoose';
import { HOUSEHOLD_MAX_MEMBERS, INVITE_DAYS, MAX_OPEN_INVITES } from '../config/household.js';
import { FoodItemModel } from '../models/FoodItem.js';
import { movePhotos } from '../models/FoodPhoto.js';
import { HouseholdEventModel } from '../models/HouseholdEvent.js';
import { InviteModel, type InviteDoc } from '../models/Invite.js';
import { MealPlanEntryModel } from '../models/MealPlanEntry.js';
import { NotificationModel } from '../models/Notification.js';
import { ShoppingItemModel } from '../models/ShoppingItem.js';
import { UsageRecordModel } from '../models/UsageRecord.js';
import { UserModel, type UserDoc } from '../models/User.js';
import { clock } from './clock.js';
import { AppError, conflict, validationError } from './errors.js';
import { scheduleForHousehold } from './notificationService.js';

/** No I, L, O, 0 or 1, so a code read aloud or from a screenshot can't be mistyped. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const FORMER_MEMBER = 'A former member';

const newCode = () =>
  Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
const showCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

const members = (householdId: Types.ObjectId) => UserModel.find({ householdId }).sort({ createdAt: 1, _id: 1 });

/** Names of everyone in the household, by id. Someone who left isn't in it. */
async function nameMap(householdId: Types.ObjectId): Promise<Map<string, string>> {
  return new Map((await members(householdId)).map((m) => [m._id.toString(), m.name]));
}

function inviteView(invite: InviteDoc, names: Map<string, string>): HouseholdInvite {
  return {
    code: showCode(invite.code),
    expiresAt: invite.expiresAt.toISOString(),
    createdBy: names.get(invite.createdBy.toString()) ?? FORMER_MEMBER,
  };
}

/** The signed-in user's household: who is in it and the invites still open. */
export async function getHousehold(user: UserDoc): Promise<Household> {
  const householdId = user.householdId;
  await InviteModel.deleteMany({ householdId, expiresAt: { $lte: clock.now() } });
  const [people, invites] = await Promise.all([
    members(householdId),
    InviteModel.find({ householdId }).sort({ createdAt: 1 }),
  ]);
  const names = new Map(people.map((m) => [m._id.toString(), m.name]));
  return {
    members: people.map((m) => ({ id: m._id.toString(), name: m.name, isYou: m._id.equals(user._id) })),
    invites: invites.map((invite) => inviteView(invite, names)),
    maxMembers: HOUSEHOLD_MAX_MEMBERS,
  };
}

/** Creates a single-use code that works for a week. Anyone in the household can make one. */
export async function createInvite(user: UserDoc): Promise<HouseholdInvite> {
  const householdId = user.householdId;
  await InviteModel.deleteMany({ householdId, expiresAt: { $lte: clock.now() } });
  if ((await UserModel.countDocuments({ householdId })) >= HOUSEHOLD_MAX_MEMBERS) {
    throw conflict(MESSAGES.householdFull);
  }
  if ((await InviteModel.countDocuments({ householdId })) >= MAX_OPEN_INVITES) {
    throw conflict(MESSAGES.tooManyInvites);
  }
  const expiresAt = new Date(clock.now().getTime() + INVITE_DAYS * DAY_MS);
  for (let attempt = 0; ; attempt++) {
    try {
      const invite = await InviteModel.create({ householdId, code: newCode(), createdBy: user._id, expiresAt });
      return inviteView(invite, await nameMap(householdId));
    } catch (error) {
      // A code that already exists (vanishingly rare): try another.
      if ((error as { code?: number }).code !== 11000 || attempt >= 4) throw error;
    }
  }
}

export async function cancelInvite(user: UserDoc, code: string): Promise<void> {
  const normal = code.replace(/[\s-]/g, '').toUpperCase();
  const { deletedCount } = await InviteModel.deleteOne({ householdId: user.householdId, code: normal });
  if (deletedCount === 0) throw new AppError(404, 'NOT_FOUND', 'That invite was not found.');
}

/**
 * Joins the household the code belongs to. Only someone who is on their own can
 * join; their food, history, shopping list and meal plan come with them and
 * become shared. Each code works once.
 */
export async function joinHousehold(user: UserDoc, { code }: JoinHouseholdInput): Promise<Household> {
  const now = clock.now();
  const invite = await InviteModel.findOne({ code, expiresAt: { $gt: now } });
  if (!invite) throw validationError(MESSAGES.inviteInvalid, 'code');
  const target = invite.householdId;
  const from = user.householdId;
  if (target.equals(from)) throw validationError(MESSAGES.inviteOwn, 'code');
  if ((await UserModel.countDocuments({ householdId: from })) > 1) throw conflict(MESSAGES.alreadyShared);
  if ((await UserModel.countDocuments({ householdId: target })) >= HOUSEHOLD_MAX_MEMBERS) {
    throw conflict(MESSAGES.householdFull);
  }
  // Claim the code atomically so two people can't use it at once.
  if (!(await InviteModel.findOneAndDelete({ _id: invite._id, expiresAt: { $gt: now } }))) {
    throw validationError(MESSAGES.inviteInvalid, 'code');
  }

  await movePhotos({ householdId: from }, target); // their food's photos come along
  // The meal plan has one entry per meal per day: where both have one, the household's stays.
  const taken = await MealPlanEntryModel.find({ householdId: target }, { date: 1, meal: 1 });
  if (taken.length > 0) {
    await MealPlanEntryModel.deleteMany({
      householdId: from,
      $or: taken.map((entry) => ({ date: entry.date, meal: entry.meal })),
    });
  }
  await Promise.all([
    FoodItemModel.updateMany({ householdId: from }, { $set: { householdId: target } }),
    UsageRecordModel.updateMany({ householdId: from }, { $set: { householdId: target } }),
    ShoppingItemModel.updateMany({ householdId: from }, { $set: { householdId: target } }),
    MealPlanEntryModel.updateMany({ householdId: from }, { $set: { householdId: target } }),
  ]);
  user.householdId = target;
  await user.save();
  await HouseholdEventModel.create({
    householdId: target,
    userId: user._id,
    actorName: user.name,
    type: 'MEMBER_JOINED',
  });

  // Everyone gets reminders for everything now shared.
  const foods = await FoodItemModel.find({ householdId: target, status: 'ACTIVE' });
  for (const food of foods) await scheduleForHousehold(food);
  return getHousehold(user);
}

/**
 * Leaves a shared household and starts a new one alone. The food, shopping
 * items and meal plans you added go with you, along with the history of that
 * food; everything else stays with the others.
 */
export async function leaveHousehold(user: UserDoc): Promise<Household> {
  const from = user.householdId;
  if ((await UserModel.countDocuments({ householdId: from })) <= 1) throw conflict(MESSAGES.notShared);
  const to = new Types.ObjectId();

  const mine = await FoodItemModel.find({ householdId: from, userId: user._id }, { _id: 1 });
  const foodIds: Types.ObjectId[] = mine.map((food) => food._id as Types.ObjectId);
  await movePhotos({ foodIds }, to); // and so do the photos of what they added
  await Promise.all([
    FoodItemModel.updateMany({ householdId: from, userId: user._id }, { $set: { householdId: to } }),
    UsageRecordModel.updateMany({ householdId: from, foodId: { $in: foodIds } }, { $set: { householdId: to } }),
    ShoppingItemModel.updateMany({ householdId: from, userId: user._id }, { $set: { householdId: to } }),
    MealPlanEntryModel.updateMany({ householdId: from, userId: user._id }, { $set: { householdId: to } }),
  ]);
  user.householdId = to;
  await user.save();
  await HouseholdEventModel.create({ householdId: from, userId: user._id, actorName: user.name, type: 'MEMBER_LEFT' });

  // Reminders for food that stayed behind no longer apply to this person.
  await NotificationModel.deleteMany({ userId: user._id, foodId: { $nin: foodIds } });
  return getHousehold(user);
}

/** Who did what in the household, newest first: food added, used, wasted or removed, and people joining or leaving. */
export async function getActivity(user: UserDoc, { limit, offset }: Pagination): Promise<ActivityLog> {
  const householdId = user.householdId;
  const names = await nameMap(householdId);
  const nameOf = (id: Types.ObjectId) => names.get(id.toString()) ?? FORMER_MEMBER;
  // Enough from each source that the merged page is right whichever source it comes from.
  const take = offset + limit + 1;
  const [added, actions, events] = await Promise.all([
    FoodItemModel.find({ householdId }, { name: 1, userId: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(take),
    UsageRecordModel.find({ householdId }).sort({ createdAt: -1 }).limit(take),
    HouseholdEventModel.find({ householdId }).sort({ createdAt: -1 }).limit(take),
  ]);

  const all: ActivityEvent[] = [
    ...added.map((food) => ({
      id: `food:${food._id}`,
      type: 'FOOD_ADDED' as const,
      actor: nameOf(food.userId),
      foodName: food.name,
      at: (food.get('createdAt') as Date).toISOString(),
    })),
    ...actions.map((record) => ({
      id: `usage:${record._id}`,
      type: record.action,
      actor: nameOf(record.userId),
      foodName: record.foodName,
      at: record.createdAt.toISOString(),
    })),
    ...events.map((event) => ({
      id: `event:${event._id}`,
      type: event.type,
      actor: event.actorName,
      foodName: event.foodName ?? null,
      at: (event.get('createdAt') as Date).toISOString(),
    })),
  ].sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));

  return { items: all.slice(offset, offset + limit), hasMore: all.length > offset + limit };
}
