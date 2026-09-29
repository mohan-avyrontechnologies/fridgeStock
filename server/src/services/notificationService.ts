import {
  addDays,
  diffDays,
  formatDisplay,
  type AppNotification,
  type NotificationFeed,
  type NotificationPreferences,
  type Pagination,
  type PreferenceKey,
  type PreferencesInput,
  type ReminderType,
} from '@cook-first/shared';
import { isValidObjectId, type Types } from 'mongoose';
import { DEFAULT_THRESHOLDS } from '../config/urgency.js';
import { reminderCopy } from '../copy.js';
import { FoodItemModel, type FoodItemDoc } from '../models/FoodItem.js';
import { MAX_DELIVERY_ATTEMPTS, NotificationModel, type NotificationDoc } from '../models/Notification.js';
import { UserModel, type UserDoc } from '../models/User.js';
import { clock } from './clock.js';
import { AppError } from './errors.js';
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

function stagesFor(expiryDate: string) {
  return [
    {
      type: 'APPROACHING_EXPIRY' as const,
      starts: addDays(expiryDate, -DEFAULT_THRESHOLDS.useSoonDays),
      endsBefore: expiryDate,
    },
    { type: 'DUE' as const, starts: expiryDate, endsBefore: addDays(expiryDate, 1) },
    { type: 'OVERDUE' as const, starts: addDays(expiryDate, 1), endsBefore: null },
  ];
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
  for (const stage of stagesFor(food.expiryDate)) {
    if (!user.notificationPreferences[PREFERENCE_FOR[stage.type]]) continue;
    if (stage.endsBefore && stage.endsBefore <= today) continue;
    const scheduledDate = stage.starts > today ? stage.starts : today;
    await NotificationModel.updateOne(
      { userId: user._id, foodId: food._id, type: stage.type, expiryDate: food.expiryDate },
      { $setOnInsert: { scheduledDate, status: 'PENDING', attempts: 0 } },
      { upsert: true },
    );
  }
}

async function rescheduleAllForUser(user: UserDoc): Promise<void> {
  const foods = await FoodItemModel.find({ userId: user._id, status: 'ACTIVE' });
  for (const food of foods) await scheduleForFood(food, user);
}

function messageFor(type: ReminderType, food: FoodItemDoc, today: string): string {
  const expiryLabel = formatDisplay(food.expiryDate);
  switch (type) {
    case 'APPROACHING_EXPIRY':
      return reminderCopy.APPROACHING_EXPIRY(food.name, diffDays(today, food.expiryDate), expiryLabel);
    case 'DUE':
      return reminderCopy.DUE(food.name);
    case 'OVERDUE':
      return reminderCopy.OVERDUE(food.name, expiryLabel);
  }
}

/** Delivers every reminder for this user whose scheduled day has arrived. */
export async function dispatchForUser(user: UserDoc): Promise<void> {
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
 * dispatchForUser with that user's id.
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
    if (user) await dispatchForUser(user);
  }
}

// ---- Read and update operations used by the notification controller ----

const SENT = { status: 'SENT' as const };

export async function listFeed(user: UserDoc, { limit, offset }: Pagination): Promise<NotificationFeed> {
  await dispatchForUser(user);
  const filter = { userId: user._id, ...SENT };
  const [items, total, unread] = await Promise.all([
    NotificationModel.find(filter).sort({ sentAt: -1, _id: -1 }).skip(offset).limit(limit),
    NotificationModel.countDocuments(filter),
    NotificationModel.countDocuments({ ...filter, readAt: null }),
  ]);
  return { items: items.map(toNotificationView), total, unread };
}

export async function unreadCount(user: UserDoc): Promise<{ unread: number }> {
  await dispatchForUser(user);
  const unread = await NotificationModel.countDocuments({ userId: user._id, ...SENT, readAt: null });
  return { unread };
}

export async function markRead(user: UserDoc, id: string): Promise<AppNotification> {
  const notFound = new AppError(404, 'NOT_FOUND', 'Notification not found.');
  if (!isValidObjectId(id)) throw notFound;
  const n = await NotificationModel.findOneAndUpdate(
    { _id: id, userId: user._id, ...SENT },
    { $set: { readAt: clock.now() } },
    { returnDocument: 'after' },
  );
  if (!n) throw notFound;
  return toNotificationView(n);
}

export async function markAllRead(user: UserDoc): Promise<void> {
  await NotificationModel.updateMany({ userId: user._id, ...SENT, readAt: null }, { $set: { readAt: clock.now() } });
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
