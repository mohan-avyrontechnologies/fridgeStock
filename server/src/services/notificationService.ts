import {
  PUSH_ACTIONS,
  REMINDER_TYPES,
  addDays,
  diffDays,
  hourInTz,
  type DeliveryInput,
  type PushPayload,
  type ReminderDelivery,
  type DateString,
  type NotificationFeed,
  type NotificationStatus,
  type NotificationPreferences,
  type PreferenceKey,
  type PreferencesInput,
  type ReminderType,
} from '@cook-first/shared';
import type { Types } from 'mongoose';
import { APPROACHING_EXPIRY_DAYS } from '../config/urgency.js';
import { pushCopy, reminderCopy } from '../copy.js';
import { FoodItemModel, type FoodItemDoc } from '../models/FoodItem.js';
import { MAX_DELIVERY_ATTEMPTS, NotificationModel, type NotificationDoc } from '../models/Notification.js';
import { PushSubscriptionModel } from '../models/PushSubscription.js';
import { UserModel, type UserDoc } from '../models/User.js';
import { clock } from './clock.js';
import { prioritise } from './priorityEngine.js';
import { pushProvider } from './pushProvider.js';
import * as pushService from './pushService.js';
import { signActionToken } from './token.js';
import { toNotificationView, toUserView } from './views.js';

const PREFERENCE_FOR: Record<ReminderType, PreferenceKey> = {
  APPROACHING_EXPIRY: 'approachingExpiry',
  DUE: 'due',
  OVERDUE: 'overdue',
};

const OPEN_STATUSES = ['PENDING', 'FAILED'] as const;

/** The IANA zone whose calendar day starts first, so no user is ever "ahead" of it. */
const EARLIEST_ZONE = 'Pacific/Kiritimati';

/**
 * In-app delivery: a reminder is delivered by making it visible in the user's
 * feed. Kept behind an object so tests can simulate delivery failure. Push
 * notifications are a separate, optional layer (see pushDue below) and never
 * affect in-app delivery.
 */
export const deliveryChannel = {
  async deliver(_notification: NotificationDoc): Promise<void> {},
};

/**
 * When each reminder type is scheduled, for an item with this expiry date:
 * - APPROACHING_EXPIRY: 3 days before expiry, or today if that has passed;
 *   only if that date is before the expiry date.
 * - DUE: on the expiry date, only if that is today or later.
 * - OVERDUE: the day after expiry, or today if that has passed.
 * Returns null when the type shouldn't be created.
 */
export function scheduledDateFor(type: ReminderType, expiryDate: DateString, today: DateString): DateString | null {
  const notBefore = (date: DateString) => (date < today ? today : date);
  switch (type) {
    case 'APPROACHING_EXPIRY': {
      const date = notBefore(addDays(expiryDate, -APPROACHING_EXPIRY_DAYS));
      return date < expiryDate ? date : null;
    }
    case 'DUE':
      return expiryDate >= today ? expiryDate : null;
    case 'OVERDUE':
      return notBefore(addDays(expiryDate, 1));
  }
}

export async function cancelForFood(userId: Types.ObjectId, foodId: Types.ObjectId): Promise<void> {
  await NotificationModel.deleteMany({ userId, foodId, status: { $in: OPEN_STATUSES } });
}

/**
 * (Re)creates the reminders for one item. A stage the item has already moved
 * past is skipped; the stage it is currently in is scheduled for today, so a
 * backdated item gets one relevant reminder rather than a burst of stale ones.
 */
export async function scheduleForFood(food: FoodItemDoc, user: UserDoc): Promise<void> {
  await cancelForFood(user._id, food._id);
  if (food.status !== 'ACTIVE') return;

  const today = clock.today(user.timeZone);
  for (const type of REMINDER_TYPES) {
    if (!user.notificationPreferences[PREFERENCE_FOR[type]]) continue;
    const scheduledDate = scheduledDateFor(type, food.expiryDate, today);
    if (!scheduledDate) continue;
    await NotificationModel.updateOne(
      { userId: user._id, foodId: food._id, type, expiryDate: food.expiryDate },
      { $setOnInsert: { scheduledDate, status: 'PENDING', attempts: 0 } },
      { upsert: true },
    );
  }
}

/**
 * Schedules an item's reminders for everyone in its household (each member has
 * their own reminders, settings and time zone). A household of one is just the owner.
 */
export async function scheduleForHousehold(food: FoodItemDoc): Promise<void> {
  const members = await UserModel.find({ householdId: food.householdId });
  for (const member of members) await scheduleForFood(food, member);
}

async function rescheduleAllForUser(user: UserDoc): Promise<void> {
  const foods = await FoodItemModel.find({ householdId: user.householdId, status: 'ACTIVE' });
  for (const food of foods) await scheduleForFood(food, user);
}

/** The reminder stage an item is in today, from its remaining days. */
function stageFor(food: FoodItemDoc, today: string): ReminderType {
  const remaining = diffDays(today, food.expiryDate);
  return remaining > 0 ? 'APPROACHING_EXPIRY' : remaining === 0 ? 'DUE' : 'OVERDUE';
}

/** Fills in the message from the server copy file; {n} is calculated now, at the moment of sending. */
function messageFor(type: ReminderType, food: FoodItemDoc, today: string): string {
  switch (type) {
    case 'APPROACHING_EXPIRY':
      return reminderCopy.APPROACHING_EXPIRY(food.name, diffDays(today, food.expiryDate));
    case 'DUE':
      return reminderCopy.DUE(food.name);
    case 'OVERDUE':
      return reminderCopy.OVERDUE(food.name);
  }
}

/**
 * Marks this user's pending reminders as sent once their scheduled date has
 * arrived in the user's time zone, provided the item is still active and the
 * reminder type is still enabled. A failed send is marked FAILED and retried
 * on later runs until it has been attempted MAX_DELIVERY_ATTEMPTS (3) times.
 * Runs at the start of GET /notifications and GET /foods, and hourly.
 */
export async function dispatchDue(user: UserDoc): Promise<void> {
  const today = clock.today(user.timeZone);
  const due = await NotificationModel.find({
    userId: user._id,
    scheduledDate: { $lte: today },
    $or: [{ status: 'PENDING' }, { status: 'FAILED', attempts: { $lt: MAX_DELIVERY_ATTEMPTS } }],
  });

  for (const notification of due) {
    const food = await FoodItemModel.findOne({ _id: notification.foodId, householdId: user.householdId });
    const stillRelevant =
      food &&
      food.status === 'ACTIVE' &&
      food.expiryDate === notification.expiryDate &&
      user.notificationPreferences[PREFERENCE_FOR[notification.type]];
    if (!stillRelevant) {
      await notification.deleteOne();
      continue;
    }

    notification.attempts += 1;
    notification.message = messageFor(notification.type, food, today);
    try {
      await deliveryChannel.deliver(notification);
      notification.status = 'SENT';
      notification.sentAt = clock.now();
      notification.lastError = undefined;
    } catch (error) {
      // Failures stay visible as FAILED and are retried on later sweeps, up to
      // MAX_DELIVERY_ATTEMPTS. Inventory views never depend on this.
      notification.status = 'FAILED';
      notification.lastError = error instanceof Error ? error.message : String(error);
    }
    await notification.save();
  }
}

// ---- Push notifications (Phase 3) ----

/** A push about one item, with "Used" and "Snooze" buttons. Tapping it opens Food Details. */
function itemPush(user: UserDoc, food: FoodItemDoc, title: string, body: string): PushPayload {
  const id = food._id.toString();
  return {
    title,
    body,
    tag: `food-${id}`,
    url: `/food/${id}`,
    actions: PUSH_ACTIONS.map((action) => ({ action, title: pushCopy.actions[action] })),
    actionToken: signActionToken(user._id.toString(), id),
  };
}

/** How many items the daily summary names before "and N more". */
export const DIGEST_LINES = 4;

/**
 * The daily summary: the Cook First list, in Cook First order (read, never
 * changed). With one item it has that item's buttons; with more it opens the
 * Cook First screen.
 */
function digestPush(user: UserDoc, foods: FoodItemDoc[], today: string): PushPayload | null {
  const { cookFirst } = prioritise(
    foods.map((doc) => ({
      doc,
      id: doc._id.toString(),
      status: doc.status,
      addedDate: doc.addedDate,
      expiryDate: doc.expiryDate,
    })),
    today,
  );
  if (cookFirst.length === 0) return null;
  const lines = cookFirst.slice(0, DIGEST_LINES).map((item) => pushCopy.digestLine(item.doc.name, item.remainingDays));
  if (cookFirst.length > DIGEST_LINES) lines.push(pushCopy.digestMore(cookFirst.length - DIGEST_LINES));
  const title = pushCopy.digestTitle(cookFirst.length);
  if (cookFirst.length === 1) return itemPush(user, cookFirst[0]!.doc, title, lines.join('\n'));
  return { title, body: lines.join('\n'), tag: 'digest', url: '/cook-first', actions: [] };
}

/**
 * Sends this user's push notifications once their chosen hour has arrived in
 * their time zone. Runs from the hourly job, after dispatchDue, so in-app
 * reminders are always delivered first and never depend on push.
 * - DIGEST: one summary a day of the Cook First list (snoozed items left out).
 * - EACH_ITEM: one push per reminder delivered today.
 * - An item snoozed until today is reminded about again (EACH_ITEM), or simply
 *   appears in the summary again (DIGEST).
 */
export async function pushDue(user: UserDoc): Promise<void> {
  if (!pushProvider()) return;
  const now = clock.now();
  if (hourInTz(user.timeZone, now) < user.reminderDelivery.hour) return;
  if (!(await pushService.hasDevices(user))) return;

  const today = clock.today(user.timeZone);
  const snoozed = (food: FoodItemDoc) => Boolean(food.snoozedUntil && food.snoozedUntil > today);
  const eachItem = user.reminderDelivery.mode === 'EACH_ITEM';
  const pushedFoods = new Set<string>();

  if (!eachItem && user.lastDigestDate !== today) {
    const foods = await FoodItemModel.find({ householdId: user.householdId, status: 'ACTIVE' });
    const payload = digestPush(
      user,
      foods.filter((food) => !snoozed(food)),
      today,
    );
    if (payload) await pushService.sendToUser(user, payload);
    user.lastDigestDate = today;
    await user.save();
    await NotificationModel.updateMany(
      { userId: user._id, status: 'SENT', scheduledDate: today, pushedAt: null },
      { $set: { pushedAt: now } },
    );
  }

  if (eachItem) {
    const delivered = await NotificationModel.find({
      userId: user._id,
      status: 'SENT',
      scheduledDate: today,
      pushedAt: null,
    });
    for (const notification of delivered) {
      const food = await FoodItemModel.findOne({ _id: notification.foodId, householdId: user.householdId });
      if (food?.status === 'ACTIVE' && !snoozed(food) && notification.message) {
        await pushService.sendToUser(user, itemPush(user, food, pushCopy.title, notification.message));
        pushedFoods.add(food._id.toString());
      }
      notification.pushedAt = now;
      await notification.save();
    }
  }

  const wokeUp = await FoodItemModel.find({
    userId: user._id,
    status: 'ACTIVE',
    snoozedUntil: { $ne: null, $lte: today },
  });
  for (const food of wokeUp) {
    if (eachItem && !pushedFoods.has(food._id.toString())) {
      const message = messageFor(stageFor(food, today), food, today);
      await pushService.sendToUser(user, itemPush(user, food, pushCopy.title, message));
    }
    food.snoozedUntil = null;
    await food.save();
  }
}

/**
 * Background sweep across every user with reminders waiting to go out or with
 * a browser registered for push. These are the only queries not scoped to a
 * signed-in user (a system job has none); they only collect user ids, and
 * each user's data is then read with that user's id.
 */
export async function sweep(): Promise<void> {
  const horizon = clock.today(EARLIEST_ZONE);
  const [withReminders, withDevices] = await Promise.all([
    NotificationModel.distinct('userId', {
      status: { $in: OPEN_STATUSES },
      attempts: { $lt: MAX_DELIVERY_ATTEMPTS },
      scheduledDate: { $lte: horizon },
    }) as Promise<Types.ObjectId[]>,
    pushProvider() ? (PushSubscriptionModel.distinct('userId') as Promise<Types.ObjectId[]>) : [],
  ]);
  const userIds = [...new Set([...withReminders, ...withDevices].map(String))];
  for (const id of userIds) {
    const user = await UserModel.findById(id);
    if (!user) continue;
    await dispatchDue(user);
    try {
      await pushDue(user);
    } catch (error) {
      // Push is an extra: a failure here never stops in-app reminders or other users.
      console.error('Push reminders failed', error instanceof Error ? error.message : error);
    }
  }
}

// ---- Read and update operations used by the notification controller ----

/** The feed shows delivered reminders and ones whose delivery failed. */
const VISIBLE = { status: { $in: ['SENT', 'FAILED'] as NotificationStatus[] } };
/** Sends any reminders that are due, then returns a page (up to 50) of SENT or FAILED ones, newest first. */
export async function listFeed(
  user: UserDoc,
  { limit, offset }: { limit: number; offset: number },
): Promise<NotificationFeed> {
  await dispatchDue(user);
  const filter = { userId: user._id, ...VISIBLE };
  const [items, total, unread] = await Promise.all([
    NotificationModel.find(filter).sort({ scheduledDate: -1, sentAt: -1, _id: -1 }).skip(offset).limit(limit),
    NotificationModel.countDocuments(filter),
    NotificationModel.countDocuments({ ...filter, readAt: null }),
  ]);
  return { items: items.map(toNotificationView), total, unread };
}

export async function unreadCount(user: UserDoc): Promise<{ unread: number }> {
  await dispatchDue(user);
  const unread = await NotificationModel.countDocuments({ userId: user._id, ...VISIBLE, readAt: null });
  return { unread };
}

/** Marks every reminder in the feed as read (called when the Reminders screen opens). */
export async function markAllRead(user: UserDoc): Promise<void> {
  await NotificationModel.updateMany({ userId: user._id, ...VISIBLE, readAt: null }, { $set: { readAt: clock.now() } });
}

export function getPreferences(user: UserDoc): NotificationPreferences {
  return toUserView(user).notificationPreferences;
}

/** A disabled preference stops that reminder type being generated at all. */
export async function updatePreferences(user: UserDoc, updates: PreferencesInput): Promise<NotificationPreferences> {
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) user.notificationPreferences[key as PreferenceKey] = value;
  }
  await user.save();
  await rescheduleAllForUser(user);
  return getPreferences(user);
}

export function getDelivery(user: UserDoc): ReminderDelivery {
  return toUserView(user).reminderDelivery;
}

/** Daily summary or one per item, and the hour push reminders go out. */
export async function updateDelivery(user: UserDoc, updates: DeliveryInput): Promise<ReminderDelivery> {
  if (updates.mode !== undefined) user.reminderDelivery.mode = updates.mode;
  if (updates.hour !== undefined) user.reminderDelivery.hour = updates.hour;
  await user.save();
  return getDelivery(user);
}
