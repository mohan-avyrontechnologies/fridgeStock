import {
  REMINDER_TYPES,
  addDays,
  diffDays,
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
import { reminderCopy } from '../copy.js';
import { FoodItemModel, type FoodItemDoc } from '../models/FoodItem.js';
import { MAX_DELIVERY_ATTEMPTS, NotificationModel, type NotificationDoc } from '../models/Notification.js';
import { UserModel, type UserDoc } from '../models/User.js';
import { clock } from './clock.js';
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
 * feed. Kept behind an object so a push channel (FCM) can be added later, and
 * so tests can simulate delivery failure.
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

async function rescheduleAllForUser(user: UserDoc): Promise<void> {
  const foods = await FoodItemModel.find({ userId: user._id, status: 'ACTIVE' });
  for (const food of foods) await scheduleForFood(food, user);
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
    const food = await FoodItemModel.findOne({ _id: notification.foodId, userId: user._id });
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

/**
 * Background sweep across every user with reminders waiting to go out. This
 * is the one query not scoped to a signed-in user (a system job has none); it
 * only collects user ids, and each user's reminders are then read by
 * dispatchDue with that user's id.
 */
export async function sweep(): Promise<void> {
  const horizon = clock.today(EARLIEST_ZONE);
  const userIds: Types.ObjectId[] = await NotificationModel.distinct('userId', {
    status: { $in: OPEN_STATUSES },
    attempts: { $lt: MAX_DELIVERY_ATTEMPTS },
    scheduledDate: { $lte: horizon },
  });
  for (const id of userIds) {
    const user = await UserModel.findById(id);
    if (user) await dispatchDue(user);
  }
}

// ---- Read and update operations used by the notification controller ----

/** The feed shows delivered reminders and ones whose delivery failed. */
const VISIBLE = { status: { $in: ['SENT', 'FAILED'] as NotificationStatus[] } };
export const FEED_LIMIT = 50;

/** Sends any reminders that are due, then returns up to 50 SENT or FAILED ones, newest first. */
export async function listFeed(user: UserDoc): Promise<NotificationFeed> {
  await dispatchDue(user);
  const filter = { userId: user._id, ...VISIBLE };
  const [items, unread] = await Promise.all([
    NotificationModel.find(filter).sort({ scheduledDate: -1, sentAt: -1, _id: -1 }).limit(FEED_LIMIT),
    NotificationModel.countDocuments({ ...filter, readAt: null }),
  ]);
  return { items: items.map(toNotificationView), unread };
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
