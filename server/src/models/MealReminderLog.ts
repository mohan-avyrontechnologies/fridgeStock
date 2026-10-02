import { isValidDate, MEAL_TYPES, type DateString, type MealContent, type MealType } from '@cook-first/shared';
import { Schema, Types, model, type HydratedDocument } from 'mongoose';

/**
 * One meal reminder that was sent to one person on one day. It records that the reminder went out (so it
 * isn't sent twice), what it showed (for "Show recipe", and so the same recipe isn't suggested for two
 * meals in a day), and a pending "Snooze 30 min".
 */
export interface MealReminderLog {
  userId: Types.ObjectId;
  householdId: Types.ObjectId;
  /** The person's calendar day (in their time zone). */
  date: DateString;
  meal: MealType;
  sentAt: Date;
  /** What the reminder said. */
  content: MealContent;
  /** The recipe's title when it was a recipe idea, else null. */
  recipeTitle: string | null;
  /** When to remind again after "Snooze 30 min"; null when nothing is waiting. */
  snoozedUntil: Date | null;
}

const mealReminderLogSchema = new Schema<MealReminderLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    householdId: { type: Schema.Types.ObjectId, required: true },
    date: {
      type: String,
      required: true,
      validate: { validator: isValidDate, message: 'Must be a "YYYY-MM-DD" date.' },
    },
    meal: { type: String, enum: MEAL_TYPES, required: true },
    sentAt: { type: Date, required: true },
    content: { type: Schema.Types.Mixed, required: true },
    recipeTitle: { type: String, default: null },
    snoozedUntil: { type: Date, default: null },
  },
  { timestamps: true, shardKey: { userId: 1 } },
);

mealReminderLogSchema.index({ userId: 1, date: 1, meal: 1 }, { unique: true });
// Only today's matter: older ones are cleared after a week.
mealReminderLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export type MealReminderLogDoc = HydratedDocument<MealReminderLog>;
export const MealReminderLogModel = model<MealReminderLog>('MealReminderLog', mealReminderLogSchema);
