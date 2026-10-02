import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { PUSH_ACTIONS, type PushAction } from '@cook-first/shared';
import { api } from '../../api/client';
import { openPage, PUSH_ACTION_DONE_EVENT, PUSH_RECEIVED_EVENT } from '../events';
import type { PushPlatform } from '../types';
import { nativeStorage } from './storage';

/**
 * Push in the Android and iOS apps, through @capacitor/push-notifications and Firebase Cloud Messaging. The
 * device token is registered with the server, stored with the platform, and kept (in secure storage) so the
 * app knows it is on and can turn it off.
 *
 * - **iOS:** the token is a Firebase one, handed over by AppDelegate.swift (the plugin alone returns an APNs
 *   token). The "Used" and "Snooze" buttons are an iOS notification category registered there too; tapping
 *   one comes back here as an action.
 * - **Android:** the server sends data-only messages, and ActionMessagingService.java builds the notification
 *   with its buttons, which call the API themselves. A plain tap comes back here and opens the page.
 */
const TOKEN_KEY = 'cook-first-push-token';
/** How long to wait for the phone to hand over a token. */
const REGISTRATION_TIMEOUT_MS = 20_000;

const plugin = async () => (await import('@capacitor/push-notifications')).PushNotifications;

const deviceName = () => (Capacitor.getPlatform() === 'ios' ? 'Cook First app on iOS' : 'Cook First app on Android');

/** Registers with the system and resolves with the device token. */
async function registerForToken(): Promise<string> {
  const push = await plugin();
  const handles: Promise<PluginListenerHandle>[] = [];
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('The phone did not give a push token.')),
        REGISTRATION_TIMEOUT_MS,
      );
      const done =
        <T>(finish: (value: T) => void) =>
        (value: T) => {
          clearTimeout(timer);
          finish(value);
        };
      handles.push(
        push.addListener(
          'registration',
          done((token) => resolve(token.value)),
        ),
      );
      handles.push(
        push.addListener(
          'registrationError',
          done((error) => reject(new Error(error.error))),
        ),
      );
      push.register().catch(done(reject));
    });
  } finally {
    // Only the listeners made here are removed; the app-wide ones (started at launch) stay.
    for (const handle of handles) void handle.then((h) => h.remove());
  }
}

/** A tap on a notification button, or on the notification itself. */
async function handleAction(event: { actionId: string; notification: { data?: Record<string, unknown> } }) {
  const data = event.notification.data ?? {};
  const action = event.actionId as PushAction;
  const token = typeof data.actionToken === 'string' ? data.actionToken : null;
  if (token && (PUSH_ACTIONS as readonly string[]).includes(action)) {
    try {
      await api.pushAction({ token, action });
      window.dispatchEvent(new CustomEvent(PUSH_ACTION_DONE_EVENT, { detail: action }));
      return;
    } catch {
      // Offline or the API is down: open the page instead, like the web app's service worker does.
    }
  }
  openPage(typeof data.url === 'string' ? data.url : '/');
}

let started = false;

export const nativePush: PushPlatform = {
  native: true,
  support: () => 'supported',
  isAvailable: (config) => config.native,
  async isBlocked() {
    return (await (await plugin()).checkPermissions()).receive === 'denied';
  },
  async isOn() {
    if (!(await nativeStorage.getItem(TOKEN_KEY))) return false;
    return (await (await plugin()).checkPermissions()).receive === 'granted';
  },
  async turnOn() {
    const push = await plugin();
    let permission = await push.checkPermissions();
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await push.requestPermissions();
    }
    if (permission.receive === 'denied') return 'blocked';
    if (permission.receive !== 'granted') return 'dismissed';

    const token = await registerForToken();
    await api.subscribePush({ platform: Capacitor.getPlatform() as 'android' | 'ios', token, browser: deviceName() });
    await nativeStorage.setItem(TOKEN_KEY, token);
    return 'on';
  },
  async turnOff(authToken) {
    const device = await nativeStorage.getItem(TOKEN_KEY);
    if (!device) return;
    try {
      await api.unsubscribePush({ token: device }, authToken);
    } finally {
      await nativeStorage.removeItem(TOKEN_KEY);
      await (await plugin()).unregister().catch(() => {});
    }
  },
  start() {
    if (started) return;
    started = true;
    void plugin().then((push) => {
      void push.addListener('pushNotificationReceived', () => window.dispatchEvent(new Event(PUSH_RECEIVED_EVENT)));
      void push.addListener('pushNotificationActionPerformed', (event) => void handleAction(event));
    });
  },
};
