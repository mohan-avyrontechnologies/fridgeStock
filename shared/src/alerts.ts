import type { AlertSettings, MealReminders, PushPayload } from './api.js';
import type { MealType, NotificationChannelId, PushKind, ReminderType, SoundName } from './enums.js';

/**
 * How a reminder should sound, shared by the server (which decides what to send) and the app (which plays a
 * chime when it is open). Everything here is pure: the time is always passed in.
 *
 * Not used, on purpose: full-screen alarms, notifications that ring until dismissed, and iOS critical alerts.
 */

export const DEFAULT_ALERTS: AlertSettings = {
  sound: true,
  vibration: true,
  quietHours: { enabled: true, start: '22:00', end: '07:00' },
};

/** Meal reminders are off until a person turns them on; the times are where they start. */
export const DEFAULT_MEAL_REMINDERS: MealReminders = {
  breakfast: { enabled: false, time: '07:30' },
  lunch: { enabled: false, time: '12:30' },
  dinner: { enabled: false, time: '19:30' },
};

/** A meal reminder and the daily summary closer than this are sent as one (the meal reminder, with the summary in it). */
export const DIGEST_MERGE_MINUTES = 30;

/** Minutes from midnight for "HH:mm", or null if it isn't a time. */
export function clockMinutes(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Minutes since midnight it is now in the given IANA time zone. */
export function minutesInTz(timeZone: string, now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now)
    .reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {});
  return Number(parts.hour) * 60 + Number(parts.minute);
}

/**
 * Whether it is quiet hours now, in the person's time zone. The start is included and the end is not, and a
 * period like 22:00 to 07:00 crosses midnight. Switched off, or a start equal to the end, means never.
 */
export function isQuietHours(timeZone: string, now: Date, quiet: AlertSettings['quietHours']): boolean {
  if (!quiet.enabled) return false;
  const start = clockMinutes(quiet.start);
  const end = clockMinutes(quiet.end);
  if (start === null || end === null || start === end) return false;
  const minutes = minutesInTz(timeZone, now);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** The reminder kind for an item reminder type. */
export const kindOfReminder = (type: ReminderType): PushKind => type;

const URGENT: readonly PushKind[] = ['DUE', 'OVERDUE'];
/** Due and overdue reminders are the urgent ones: a stronger sound, vibration, and they stay until acted on. */
export const isUrgent = (kind: PushKind): boolean => URGENT.includes(kind);

/** Gentle for approaching expiry and the summary, strong for due and overdue, and its own for meals. */
export function soundFor(kind: PushKind): SoundName {
  return kind === 'MEAL' ? 'meal' : isUrgent(kind) ? 'strong' : 'gentle';
}

/** Vibration patterns, in milliseconds (on, off, on…). */
export function vibrationFor(kind: PushKind): number[] {
  if (isUrgent(kind)) return [300, 120, 300, 120, 300];
  return kind === 'MEAL' ? [160, 80, 160] : [120];
}

/**
 * The Android channel. Sound and vibration belong to the channel, so each combination of the person's
 * switches needs its own: urgent reminders have all four, the others sound or are silent.
 */
export function channelFor(kind: PushKind, sound: boolean, vibrate: boolean): NotificationChannelId {
  if (isUrgent(kind)) {
    if (sound && vibrate) return 'food-urgent';
    if (sound) return 'food-urgent-sound';
    return vibrate ? 'reminders-vibrate' : 'reminders-silent';
  }
  if (!sound) return 'reminders-silent';
  return kind === 'MEAL' ? 'meal-reminders' : 'food-soon';
}

export type PushAlert = Pick<PushPayload, 'channel' | 'sound' | 'vibrate' | 'requireInteraction' | 'silent'>;

/**
 * Sound, vibration, channel and whether it stays on screen, for one reminder.
 * During quiet hours it is delivered silently: no sound and no vibration (it still arrives).
 */
export function alertFor(kind: PushKind, settings: AlertSettings, quiet: boolean): PushAlert {
  const sound = settings.sound && !quiet;
  const vibrate = settings.vibration && !quiet;
  return {
    channel: channelFor(kind, sound, vibrate),
    sound: sound ? soundFor(kind) : null,
    vibrate: vibrate ? vibrationFor(kind) : [],
    requireInteraction: isUrgent(kind),
    silent: !sound && !vibrate,
  };
}

/** True when a meal reminder at `time` ("HH:mm") and the summary at `digestHour` are within 30 minutes of each other. */
export function mergesWithDigest(time: string, digestHour: number): boolean {
  const minutes = clockMinutes(time);
  return minutes !== null && Math.abs(minutes - digestHour * 60) <= DIGEST_MERGE_MINUTES;
}

export const MEAL_LABELS: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
