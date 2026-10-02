package com.example.cookfirst;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Receives Cook First's reminders from Firebase and shows them with their buttons.
 *
 * The server sends Android a data-only message (a "notification" message would be shown by the system
 * without buttons), with the title, body, page, the notification channel to use, and a single-use action token.
 * Everything shown comes from the server. The channel sets the sound and vibration (see ReminderChannels).
 *
 * Buttons: one that opens a page ("Cooked it", "Show recipe") carries its address and opens the app there; the
 * others ("Used", "Snooze", "Snooze 30 min") call the API from {@link NotificationActionReceiver} without
 * opening the app. Tapping the notification opens the app at the page ({@link MainActivity}).
 *
 * While the app is open the notification is put on the silent channel, because the app plays its own chime
 * (after the person has touched the screen). No full-screen alarms, nothing that rings until dismissed.
 *
 * The Capacitor push plugin's own service is replaced by this one (see AndroidManifest.xml). It extends it, so
 * the token refresh, and a message for the web layer, still reach the plugin.
 */
public class ActionMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        String title = data.get("title");
        String body = data.get("body");
        if (title != null && body != null) {
            show(data, title, body);
        }
        // Also tell the app, if it is open, so it can refresh its reminders and play its chime.
        super.onMessageReceived(message);
    }

    private void show(Map<String, String> data, String title, String body) {
        Context context = getApplicationContext();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        // The channel the server chose, or the silent one while the app is open (it plays its own chime).
        String channelId = ReminderChannels.resolve(data.get("channelId"));
        if (MainActivity.isVisible()) channelId = ReminderChannels.SILENT;
        ReminderChannels.ensure(context, channelId);

        String tag = data.get("tag");
        int id = tag == null ? 0 : tag.hashCode();
        String page = data.get("url") == null ? "/" : data.get("url");

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(openPage(context, page, id))
            .setAutoCancel(true)
            // The same tag replaces the earlier notification, and alerts again.
            .setOnlyAlertOnce(false)
            .setPriority(ReminderChannels.importance(channelId) >= 4 ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT);

        // Before Android 8 there are no channels: the sound and vibration are set on the notification itself.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            Uri sound = ReminderChannels.soundUri(context, channelId);
            if (sound != null) builder.setSound(sound);
            if (ReminderChannels.vibrates(channelId)) builder.setVibrate(new long[] { 0, 300, 120, 300, 120, 300 });
            if (ReminderChannels.importance(channelId) <= 2) builder.setPriority(NotificationCompat.PRIORITY_LOW);
        }

        // Buttons are only on a reminder that carries a token for them.
        String token = data.get("actionToken");
        String actionUrl = data.get("actionUrl");
        String actions = data.get("actions");
        if (token != null && actions != null) {
            try {
                JSONArray list = new JSONArray(actions);
                for (int i = 0; i < list.length(); i++) {
                    JSONObject item = list.getJSONObject(i);
                    String action = item.getString("action");
                    String buttonPage = item.optString("url", null);
                    PendingIntent button = null;
                    if (buttonPage != null && !buttonPage.isEmpty()) {
                        // A button that opens a page.
                        button = openPage(context, buttonPage, id * 31 + i);
                    } else if (actionUrl != null) {
                        // A button that calls the API without opening the app.
                        Intent send = new Intent(context, NotificationActionReceiver.class);
                        send.setAction("cookfirst.ACTION." + action + "." + id);
                        send.putExtra(NotificationActionReceiver.EXTRA_TOKEN, token);
                        send.putExtra(NotificationActionReceiver.EXTRA_ACTION, action);
                        send.putExtra(NotificationActionReceiver.EXTRA_API_URL, actionUrl);
                        send.putExtra(NotificationActionReceiver.EXTRA_PAGE, page);
                        send.putExtra(NotificationActionReceiver.EXTRA_NOTIFICATION_ID, id);
                        button = PendingIntent.getBroadcast(
                            context,
                            id * 31 + i,
                            send,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                        );
                    }
                    if (button != null) builder.addAction(0, item.getString("title"), button);
                }
            } catch (Exception ignored) {
                // A malformed list of buttons just means no buttons: the reminder is still shown.
            }
        }
        manager.notify(id, builder.build());
    }

    /** Opens the app at a page. */
    private PendingIntent openPage(Context context, String page, int requestCode) {
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra(MainActivity.EXTRA_PAGE, page);
        return PendingIntent.getActivity(context, requestCode, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
