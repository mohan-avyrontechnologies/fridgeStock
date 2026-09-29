import { Schema, Types, model, type HydratedDocument } from 'mongoose';

export const REMINDER_TYPES = ['APPROACHING_EXPIRY', 'DUE', 'OVERDUE'] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

export const NOTIFICATION_STATUS = ['PENDING', 'SENT', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUS)[number];

export const MAX_DELIVERY_ATTEMPTS = 3;

export interface Notification {
  userId: Types.ObjectId;
  foodId: Types.ObjectId;
  type: ReminderType;
  expiryDate: Date;
  scheduledDate: Date;
  status: NotificationStatus;
  attempts: number;
  lastError?: string;
  message?: string;
  sentAt?: Date;
  readAt?: Date;
}

const notificationSchema = new Schema<Notification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    foodId: { type: Schema.Types.ObjectId, ref: 'FoodItem', required: true, index: true },
    type: { type: String, enum: REMINDER_TYPES, required: true },
    // The expected expiry this reminder was scheduled against. If the item's
    // dates are edited, a new expiry gets its own reminders.
    expiryDate: { type: Date, required: true },
    scheduledDate: { type: Date, required: true },
    status: { type: String, enum: NOTIFICATION_STATUS, default: 'PENDING', required: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },
    message: { type: String },
    sentAt: { type: Date },
    readAt: { type: Date },
  },
  { timestamps: true },
);

notificationSchema.index({ foodId: 1, type: 1, expiryDate: 1 }, { unique: true });
notificationSchema.index({ userId: 1, status: 1, scheduledDate: 1 });
notificationSchema.index({ userId: 1, sentAt: -1 });

export type NotificationDoc = HydratedDocument<Notification>;
export const NotificationModel = model<Notification>('Notification', notificationSchema);
