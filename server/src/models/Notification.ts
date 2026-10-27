import {
  isValidDate,
  NOTIFICATION_STATUSES,
  REMINDER_TYPES,
  type DateString,
  type NotificationStatus,
  type ReminderType,
} from '@fridgestock/shared';
import { Schema, Types, model, type HydratedDocument } from 'mongoose';

export const MAX_DELIVERY_ATTEMPTS = 3;

export interface Notification {
  userId: Types.ObjectId;
  foodId: Types.ObjectId;
  type: ReminderType;
  /** The expected expiry this reminder was scheduled against. */
  expiryDate: DateString;
  /** The user's calendar day on which it should be delivered. */
  scheduledDate: DateString;
  status: NotificationStatus;
  attempts: number;
  lastError?: string;
  message?: string;
  sentAt?: Date;
  readAt?: Date;
  /** When it went out as a push notification (per-item mode or in a digest). */
  pushedAt?: Date;
}

const calendarDate = {
  type: String,
  required: true,
  validate: { validator: isValidDate, message: 'Must be a "YYYY-MM-DD" calendar date.' },
};

const notificationSchema = new Schema<Notification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    foodId: { type: Schema.Types.ObjectId, ref: 'FoodItem', required: true, index: true },
    type: { type: String, enum: REMINDER_TYPES, required: true },
    // If the item's dates are edited, a new expiry gets its own reminders.
    expiryDate: calendarDate,
    scheduledDate: calendarDate,
    status: { type: String, enum: NOTIFICATION_STATUSES, default: 'PENDING', required: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },
    message: { type: String },
    sentAt: { type: Date },
    readAt: { type: Date },
    pushedAt: { type: Date },
  },
  // shardKey adds userId to the filter of every save()/deleteOne() on a document.
  { timestamps: true, shardKey: { userId: 1 } },
);

notificationSchema.index({ userId: 1, foodId: 1, type: 1, expiryDate: 1 }, { unique: true });
notificationSchema.index({ userId: 1, status: 1, scheduledDate: 1 });
notificationSchema.index({ userId: 1, sentAt: -1 });

export type NotificationDoc = HydratedDocument<Notification>;
export const NotificationModel = model<Notification>('Notification', notificationSchema);
