import {
  CURRENCIES,
  DEFAULT_ALERTS,
  DEFAULT_MEAL_REMINDERS,
  REMINDER_MODES,
  type AlertSettings,
  type Currency,
  type DateString,
  type MealReminders,
  type ReminderMode,
} from '@cook-first/shared';
import { Schema, Types, model, type HydratedDocument } from 'mongoose';

export interface NotificationPreferences {
  approachingExpiry: boolean;
  due: boolean;
  overdue: boolean;
}

export interface ReminderDelivery {
  mode: ReminderMode;
  hour: number;
}

export interface User {
  name: string;
  email: string;
  passwordHash: string;
  timeZone: string;
  currency: Currency;
  /** Keep a photo with each food item added by camera. */
  savePhotos: boolean;
  /** The first-run guide has been seen or skipped. Accounts that predate it have no value, which reads as done. */
  firstRunDone: boolean;
  notificationPreferences: NotificationPreferences;
  /** Every user starts in their own household; shared households (a later phase) will reuse it. */
  householdId: Types.ObjectId;
  reminderDelivery: ReminderDelivery;
  /** Sound, vibration and quiet hours for push reminders. */
  alerts: AlertSettings;
  /** Breakfast, lunch and dinner cooking reminders. */
  mealReminders: MealReminders;
  /** The user's calendar day the last daily digest was pushed on. */
  lastDigestDate: DateString | null;
}

const userSchema = new Schema<User>(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 50 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // IANA zone used to decide which calendar day is "today" for this user.
    timeZone: { type: String, required: true, default: 'UTC' },
    currency: { type: String, enum: CURRENCIES, default: 'USD' },
    savePhotos: { type: Boolean, default: true },
    firstRunDone: { type: Boolean, default: true },
    notificationPreferences: {
      approachingExpiry: { type: Boolean, default: true },
      due: { type: Boolean, default: true },
      overdue: { type: Boolean, default: true },
    },
    householdId: { type: Schema.Types.ObjectId, required: true, default: () => new Types.ObjectId(), index: true },
    // Push reminders: a daily summary by default, at 8:00 in the user's time zone.
    reminderDelivery: {
      mode: { type: String, enum: REMINDER_MODES, default: 'DIGEST' },
      hour: { type: Number, min: 0, max: 23, default: 8 },
    },
    lastDigestDate: { type: String, default: null },
    alerts: {
      sound: { type: Boolean, default: DEFAULT_ALERTS.sound },
      vibration: { type: Boolean, default: DEFAULT_ALERTS.vibration },
      quietHours: {
        enabled: { type: Boolean, default: DEFAULT_ALERTS.quietHours.enabled },
        start: { type: String, default: DEFAULT_ALERTS.quietHours.start },
        end: { type: String, default: DEFAULT_ALERTS.quietHours.end },
      },
    },
    mealReminders: {
      breakfast: {
        enabled: { type: Boolean, default: DEFAULT_MEAL_REMINDERS.breakfast.enabled },
        time: { type: String, default: DEFAULT_MEAL_REMINDERS.breakfast.time },
      },
      lunch: {
        enabled: { type: Boolean, default: DEFAULT_MEAL_REMINDERS.lunch.enabled },
        time: { type: String, default: DEFAULT_MEAL_REMINDERS.lunch.time },
      },
      dinner: {
        enabled: { type: Boolean, default: DEFAULT_MEAL_REMINDERS.dinner.enabled },
        time: { type: String, default: DEFAULT_MEAL_REMINDERS.dinner.time },
      },
    },
  },
  { timestamps: true },
);

export type UserDoc = HydratedDocument<User>;
export const UserModel = model<User>('User', userSchema);
