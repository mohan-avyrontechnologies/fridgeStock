import { Schema, model, type HydratedDocument } from 'mongoose';

export interface NotificationPreferences {
  approachingExpiry: boolean;
  due: boolean;
  overdue: boolean;
}

export interface User {
  name: string;
  email: string;
  passwordHash: string;
  timeZone: string;
  notificationPreferences: NotificationPreferences;
}

const userSchema = new Schema<User>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // IANA zone used to decide which calendar day is "today" for this user.
    timeZone: { type: String, required: true, default: 'UTC' },
    notificationPreferences: {
      approachingExpiry: { type: Boolean, default: true },
      due: { type: Boolean, default: true },
      overdue: { type: Boolean, default: true },
    },
  },
  { timestamps: true },
);

export type UserDoc = HydratedDocument<User>;
export const UserModel = model<User>('User', userSchema);
