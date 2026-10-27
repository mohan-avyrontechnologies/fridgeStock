import {
  DEFAULT_ALERTS,
  DEFAULT_MEAL_REMINDERS,
  MEAL_TYPES,
  type AlertSettings,
  type MealReminders,
} from '@fridgestock/shared';
import type { UserDoc } from '../models/User.js';

/**
 * A person's sound, vibration and quiet-hours settings. Anyone who has never changed them (including
 * accounts made before they existed) gets the defaults.
 */
export function alertsOf(user: UserDoc): AlertSettings {
  const saved = user.alerts;
  if (!saved) return DEFAULT_ALERTS;
  return {
    sound: saved.sound ?? DEFAULT_ALERTS.sound,
    vibration: saved.vibration ?? DEFAULT_ALERTS.vibration,
    quietHours: {
      enabled: saved.quietHours?.enabled ?? DEFAULT_ALERTS.quietHours.enabled,
      start: saved.quietHours?.start ?? DEFAULT_ALERTS.quietHours.start,
      end: saved.quietHours?.end ?? DEFAULT_ALERTS.quietHours.end,
    },
  };
}

/** A person's breakfast, lunch and dinner cooking reminders (off, at 07:30, 12:30 and 19:30, until changed). */
export function mealRemindersOf(user: UserDoc): MealReminders {
  const saved = user.mealReminders;
  const read = (meal: (typeof MEAL_TYPES)[number]) => ({
    enabled: saved?.[meal]?.enabled ?? DEFAULT_MEAL_REMINDERS[meal].enabled,
    time: saved?.[meal]?.time ?? DEFAULT_MEAL_REMINDERS[meal].time,
  });
  return { breakfast: read('breakfast'), lunch: read('lunch'), dinner: read('dinner') };
}
