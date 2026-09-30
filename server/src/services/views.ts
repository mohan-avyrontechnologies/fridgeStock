import {
  diffDays,
  type Favourite,
  type AppNotification,
  type DateString,
  type FoodItem,
  type UsageRecord,
  type User,
} from '@cook-first/shared';
import type { FavouriteDoc } from '../models/Favourite.js';
import type { FoodItemDoc } from '../models/FoodItem.js';
import type { NotificationDoc } from '../models/Notification.js';
import type { UsageRecordDoc } from '../models/UsageRecord.js';
import type { UserDoc } from '../models/User.js';
import { classifyUrgency } from './priorityEngine.js';

/** Map documents to the API response shapes in @cook-first/shared. Never exposes passwordHash. */

export function toUserView(user: UserDoc): User {
  const prefs = user.notificationPreferences;
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    timeZone: user.timeZone,
    notificationPreferences: { approachingExpiry: prefs.approachingExpiry, due: prefs.due, overdue: prefs.overdue },
    reminderDelivery: { mode: user.reminderDelivery.mode, hour: user.reminderDelivery.hour },
  };
}

export function toFoodView(doc: FoodItemDoc, today: DateString): FoodItem {
  const remainingDays = doc.status === 'ACTIVE' ? diffDays(today, doc.expiryDate) : null;
  return {
    id: doc._id.toString(),
    name: doc.name,
    quantity: doc.quantity,
    unit: doc.unit,
    addedDate: doc.addedDate,
    lifespanDays: doc.lifespanDays,
    expiryDate: doc.expiryDate,
    notes: doc.notes ?? null,
    storage: doc.storage ?? 'FRIDGE',
    openedDate: doc.openedDate ?? null,
    leftover: doc.leftover ?? false,
    status: doc.status,
    remainingDays,
    urgency: remainingDays === null ? null : classifyUrgency(remainingDays),
    closedAt: doc.closedAt ? doc.closedAt.toISOString() : null,
    createdAt: (doc.get('createdAt') as Date).toISOString(),
    updatedAt: (doc.get('updatedAt') as Date).toISOString(),
  };
}

export function toUsageView(record: UsageRecordDoc): UsageRecord {
  return {
    id: record._id.toString(),
    foodId: record.foodId.toString(),
    foodName: record.foodName,
    unit: record.unit,
    action: record.action,
    date: record.date,
    recordedAt: record.createdAt.toISOString(),
    quantityUsed: record.quantityUsed,
    quantityRemaining: record.quantityRemaining,
  };
}

export function toNotificationView(n: NotificationDoc): AppNotification {
  return {
    id: n._id.toString(),
    foodId: n.foodId.toString(),
    type: n.type,
    message: n.message ?? '',
    scheduledDate: n.scheduledDate,
    status: n.status,
    sentAt: n.sentAt ? n.sentAt.toISOString() : null,
    readAt: n.readAt ? n.readAt.toISOString() : null,
  };
}

export function toFavouriteView(f: FavouriteDoc): Favourite {
  return {
    id: f._id.toString(),
    name: f.name,
    quantity: f.quantity,
    unit: f.unit,
    lifespanDays: f.lifespanDays,
    storage: f.storage,
  };
}
