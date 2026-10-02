package com.example.cookfirst;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

/**
 * The app's one screen: Capacitor's web view. It also opens a page when a reminder is tapped (see
 * {@link ActionMessagingService}): the address is handed to the web app, which navigates to it.
 */
public class MainActivity extends BridgeActivity {

    /** The page a tapped notification should open, like "/food/123". */
    public static final String EXTRA_PAGE = "cookFirstPage";

    /** The page may be handed over before the web app has finished loading, so it is offered again a little later. */
    private static final long[] RETRY_DELAYS_MS = { 300, 1500, 4000 };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        openPageFrom(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openPageFrom(intent);
    }

    private void openPageFrom(Intent intent) {
        final String page = intent == null ? null : intent.getStringExtra(EXTRA_PAGE);
        if (page == null) return;
        intent.removeExtra(EXTRA_PAGE);
        // JSONObject.quote makes the address a safe JavaScript string. The nonce makes each tap handled once,
        // however many times it is offered, while a later tap on the same page still works.
        final String address = JSONObject.quote(page);
        final String nonce = JSONObject.quote(String.valueOf(System.nanoTime()));
        // The web app reads window.__cookFirstPendingUrl when it starts, and listens for the event once it is running.
        final String script =
            "(function(u,n){if(window.__cookFirstHandled===n){return;}window.__cookFirstHandled=n;" +
            "window.__cookFirstPendingUrl=u;" +
            "window.dispatchEvent(new CustomEvent('cook-first:open-page',{detail:u}));})(" +
            address +
            "," +
            nonce +
            ");";
        Handler handler = new Handler(Looper.getMainLooper());
        for (long delay : RETRY_DELAYS_MS) {
            handler.postDelayed(
                () -> {
                    if (getBridge() != null) getBridge().eval(script, null);
                },
                delay
            );
        }
    }
}
