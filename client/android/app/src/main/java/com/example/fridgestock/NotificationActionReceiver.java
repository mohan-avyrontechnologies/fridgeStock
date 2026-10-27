package com.example.fridgestock;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * Handles a tap on a notification's "Used" or "Snooze" button: it sends the action to the API with the
 * single-item token that came with the reminder (the same call the web app's service worker makes), without
 * opening the app. If that fails, for example offline, it opens the app at the item instead.
 */
public class NotificationActionReceiver extends BroadcastReceiver {

    public static final String EXTRA_TOKEN = "actionToken";
    public static final String EXTRA_ACTION = "action";
    public static final String EXTRA_API_URL = "actionUrl";
    public static final String EXTRA_PAGE = "page";
    public static final String EXTRA_NOTIFICATION_ID = "notificationId";

    private static final int TIMEOUT_MS = 10_000;

    @Override
    public void onReceive(Context context, Intent intent) {
        final PendingResult pending = goAsync();
        final Context app = context.getApplicationContext();
        final String token = intent.getStringExtra(EXTRA_TOKEN);
        final String action = intent.getStringExtra(EXTRA_ACTION);
        final String apiUrl = intent.getStringExtra(EXTRA_API_URL);
        final String page = intent.getStringExtra(EXTRA_PAGE);
        final int notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, 0);

        new Thread(() -> {
            try {
                boolean done = send(apiUrl, token, action);
                NotificationManager manager = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
                if (done) {
                    if (manager != null) manager.cancel(notificationId);
                } else {
                    // Could not complete it: open the item instead, like the web app does.
                    Intent open = new Intent(app, MainActivity.class);
                    open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    open.putExtra(MainActivity.EXTRA_PAGE, page == null ? "/" : page);
                    app.startActivity(open);
                    if (manager != null) manager.cancel(notificationId);
                }
            } finally {
                pending.finish();
            }
        }).start();
    }

    /** POST {token, action} to the API. True when it answered with a success status. */
    private static boolean send(String apiUrl, String token, String action) {
        if (apiUrl == null || token == null || action == null) return false;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(apiUrl).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            byte[] body = new JSONObject().put("token", token).put("action", action).toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body);
            }
            int status = connection.getResponseCode();
            return status >= 200 && status < 300;
        } catch (Exception e) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
