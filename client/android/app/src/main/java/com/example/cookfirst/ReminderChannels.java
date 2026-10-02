package com.example.cookfirst;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

/**
 * The notification channels for reminders. Android fixes a notification's sound and vibration by its channel,
 * so each choice a person can make in Cook First (sounds on or off, vibration on or off, quiet hours) has one,
 * and the server names the right one in every push (`channelId`).
 *
 * The app creates the four with sounds when it starts, with @capacitor/push-notifications
 * (client/src/platform/native/channels.ts), and MainActivity creates the two without a sound (that plugin
 * would give them the default sound). This class also creates any that is missing when a reminder arrives
 * before then. Keep the table in step with channels.ts (a test checks they agree).
 */
final class ReminderChannels {

    static final String DEFAULT = "food-soon";
    static final String SILENT = "reminders-silent";

    /** id, name, description, importance (2 low, 3 default, 4 high), sound (a file in res/raw, or null), vibration. */
    private static final Object[][] CHANNELS = {
        { "food-soon", "Food coming up", "A gentle sound for food coming up to use, and the daily summary.", 3, "reminder_gentle", false },
        { "food-urgent", "Food due or overdue", "A stronger sound and vibration for food that is due or overdue.", 4, "reminder_strong", true },
        { "meal-reminders", "Meal reminders", "Cooking reminders at breakfast, lunch and dinner time.", 3, "reminder_meal", false },
        { "food-urgent-sound", "Food due or overdue (sound only)", "Used when vibration is switched off in Cook First.", 4, "reminder_strong", false },
        { "reminders-vibrate", "Vibration only", "Used when sounds are switched off in Cook First.", 3, null, true },
        { "reminders-silent", "Silent reminders", "Used during quiet hours, or when sound and vibration are both off.", 2, null, false },
    };

    private ReminderChannels() {}

    private static Object[] find(String id) {
        for (Object[] channel : CHANNELS) {
            if (channel[0].equals(id)) return channel;
        }
        return null;
    }

    /** The channel to use: the one named, or the default if it is not one of ours. */
    static String resolve(String id) {
        return id != null && find(id) != null ? id : DEFAULT;
    }

    static boolean vibrates(String id) {
        Object[] channel = find(id);
        return channel != null && (Boolean) channel[5];
    }

    static int importance(String id) {
        Object[] channel = find(id);
        return channel == null ? 3 : (Integer) channel[3];
    }

    /** The sound file's address, or null for no sound (or a file that is not in the app). */
    static Uri soundUri(Context context, String id) {
        Object[] channel = find(id);
        if (channel == null || channel[4] == null) return null;
        String name = (String) channel[4];
        if (context.getResources().getIdentifier(name, "raw", context.getPackageName()) == 0) return null;
        return Uri.parse("android.resource://" + context.getPackageName() + "/raw/" + name);
    }

    /** Creates the channel if it does not exist yet. Android never changes an existing channel's sound. */
    static void ensure(Context context, String id) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        Object[] spec = find(id);
        if (manager == null || spec == null || manager.getNotificationChannel(id) != null) return;
        NotificationChannel channel = new NotificationChannel(id, (String) spec[1], (Integer) spec[3]);
        channel.setDescription((String) spec[2]);
        channel.enableVibration((Boolean) spec[5]);
        Uri sound = soundUri(context, id);
        if (sound != null) {
            channel.setSound(
                sound,
                new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .build()
            );
        } else {
            channel.setSound(null, null);
        }
        manager.createNotificationChannel(channel);
    }

    /** The two channels that have no sound, which the push plugin can not make. */
    static void ensureSoundless(Context context) {
        ensure(context, "reminders-vibrate");
        ensure(context, SILENT);
    }
}
