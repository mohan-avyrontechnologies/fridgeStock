import type { NotificationChannelId } from '@fridgestock/shared';

/**
 * The Android notification channels. Android fixes a notification's sound, vibration and importance by its
 * channel, so each combination a person can choose (sound on or off, vibration on or off, quiet hours) has
 * one. The server names the channel in every push (`channel`); the sound files are android/.../res/raw.
 *
 * Keep in step with ReminderChannels.java, which makes any channel that is missing when a reminder arrives
 * (a test checks they agree).
 */
export interface ChannelSpec {
  id: NotificationChannelId;
  name: string;
  description: string;
  /** Android's importance: 2 low (no sound), 3 default, 4 high. */
  importance: 2 | 3 | 4;
  /** A file in res/raw, without its extension. Null for no sound. */
  sound: string | null;
  vibration: boolean;
}

export const ANDROID_CHANNELS: ChannelSpec[] = [
  {
    id: 'food-soon',
    name: 'Food coming up',
    description: 'A gentle sound for food coming up to use, and the daily summary.',
    importance: 3,
    sound: 'reminder_gentle',
    vibration: false,
  },
  {
    id: 'food-urgent',
    name: 'Food due or overdue',
    description: 'A stronger sound and vibration for food that is due or overdue.',
    importance: 4,
    sound: 'reminder_strong',
    vibration: true,
  },
  {
    id: 'meal-reminders',
    name: 'Meal reminders',
    description: 'Cooking reminders at breakfast, lunch and dinner time.',
    importance: 3,
    sound: 'reminder_meal',
    vibration: false,
  },
  {
    id: 'food-urgent-sound',
    name: 'Food due or overdue (sound only)',
    description: 'Used when vibration is switched off in FridgeStock.',
    importance: 4,
    sound: 'reminder_strong',
    vibration: false,
  },
  {
    id: 'reminders-vibrate',
    name: 'Vibration only',
    description: 'Used when sounds are switched off in FridgeStock.',
    importance: 3,
    sound: null,
    vibration: true,
  },
  {
    id: 'reminders-silent',
    name: 'Silent reminders',
    description: 'Used during quiet hours, or when sound and vibration are both off.',
    importance: 2,
    sound: null,
    vibration: false,
  },
];

/**
 * Creates the channels that have a sound, with @capacitor/push-notifications. (A channel with no sound can't be
 * made through the plugin, which would give it the default sound: MainActivity.java and the messaging
 * service make those two natively.) Creating a channel that exists is harmless, and Android never changes
 * an existing channel's sound, so a sound that is replaced later needs the app reinstalled or a new channel id.
 */
export async function createAndroidChannels(): Promise<void> {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  for (const channel of ANDROID_CHANNELS.filter((spec) => spec.sound)) {
    await PushNotifications.createChannel({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      importance: channel.importance,
      sound: channel.sound!,
      vibration: channel.vibration,
      visibility: 1,
    });
  }
}
