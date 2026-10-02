package com.example.cookfirst;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Receives Cook First's reminders from Firebase and shows them with their "Used" and "Snooze" buttons.
 *
 * The server sends Android a data-only message (a "notification" message would be shown by the system
 * without buttons), with the title, body, page, and a single-item action token. Everything shown comes from
 * the server. A button calls the API from {@link NotificationActionReceiver} without opening the app; tapping
 * the notification opens the app at the page ({@link MainActivity}).
 *
 * The Capacitor push plugin's own service is replaced by this one (see AndroidManifest.xml). It extends it, so
 * anything that is not one of our reminders, and the token refresh, still reach the plugin.
 */
public class ActionMessagingService extends MessagingService {

    public static final String CHANNEL_ID = "reminders";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        String title = data.get("title");
        String body = data.get("body");
        if (title != null && body != null) {
            show(data, title, body);
        }
        // Also tell the app, if it is open, so it can refresh its reminders.
        super.onMessageReceived(message);
    }

    private void show(Map<String, String> data, String title, String body) {
        Context context = getApplicationContext();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        ensureChannel(manager);

        String tag = data.get("tag");
        int id = tag == null ? 0 : tag.hashCode();
        String page = data.get("url") == null ? "/" : data.get("url");

        // Tapping the notification opens the app at the page.
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra(MainActivity.EXTRA_PAGE, page);
        PendingIntent tap = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);

        // Buttons only for a single-item reminder, and only when the server told us where to send them.
        String token = data.get("actionToken");
        String actionUrl = data.get("actionUrl");
        String actions = data.get("actions");
        if (token != null && actionUrl != null && actions != null) {
            try {
                JSONArray list = new JSONArray(actions);
                for (int i = 0; i < list.length(); i++) {
                    JSONObject item = list.getJSONObject(i);
                    String action = item.getString("action");
                    Intent send = new Intent(context, NotificationActionReceiver.class);
                    send.setAction("cookfirst.ACTION." + action + "." + id);
                    send.putExtra(NotificationActionReceiver.EXTRA_TOKEN, token);
                    send.putExtra(NotificationActionReceiver.EXTRA_ACTION, action);
                    send.putExtra(NotificationActionReceiver.EXTRA_API_URL, actionUrl);
                    send.putExtra(NotificationActionReceiver.EXTRA_PAGE, page);
                    send.putExtra(NotificationActionReceiver.EXTRA_NOTIFICATION_ID, id);
                    PendingIntent button = PendingIntent.getBroadcast(
                        context,
                        id * 31 + i,
                        send,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    );
                    builder.addAction(0, item.getString("title"), button);
                }
            } catch (Exception ignored) {
                // A malformed list of buttons just means no buttons: the reminder is still shown.
            }
        }
        manager.notify(id, builder.build());
    }

    private void ensureChannel(NotificationManager manager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.reminders_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription(getString(R.string.reminders_channel_description));
        manager.createNotificationChannel(channel);
    }
}
