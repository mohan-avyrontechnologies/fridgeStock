import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { PUSH_ACTIONS, PUSH_KINDS, type PushAction, type PushActionInput } from '@fridgestock/shared';
import { api } from '../../api/client';
import { openPage, PUSH_ACTION_DONE_EVENT, PUSH_RECEIVED_EVENT } from '../events';
import type { PushPlatform } from '../types';
import { createAndroidChannels } from './channels';
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
 *
 * Sounds: on Android a push names its notification channel (created below, at app start), which sets the
 * sound and vibration; on iOS the payload names a bundled sound file. While the app is open the in-app chime
 * (lib/chime.ts) is played instead, from the event this raises with the reminder's kind.
 */
const TOKEN_KEY = 'fridgestock-push-token';
/** How long to wait for the phone to hand over a token. */
const REGISTRATION_TIMEOUT_MS = 20_000;

const plugin = async () => (await import('@capacitor/push-notifications')).PushNotifications;

const deviceName = () => (Capacitor.getPlatform() === 'ios' ? 'FridgeStock app on iOS' : 'FridgeStock app on Android');

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

/** The API calls a button can make: Used and Snooze on food, and Snooze 30 min on a meal reminder. */
const API_ACTIONS: readonly string[] = [...PUSH_ACTIONS, 'SNOOZE_MEAL'];

/** The pages the buttons that open one go to, from the push's `actionUrls` (a JSON object as text). */
function pageActions(data: Record<string, unknown>): Record<string, string> {
  try {
    const parsed = JSON.parse(typeof data.actionUrls === 'string' ? data.actionUrls : '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** A tap on a notification button, or on the notification itself. */
async function handleAction(event: { actionId: string; notification: { data?: Record<string, unknown> } }) {
  const data = event.notification.data ?? {};
  const action = event.actionId as PushAction;
  const token = typeof data.actionToken === 'string' ? data.actionToken : null;
  // A button that opens a page ("Cooked it", "Show recipe") goes straight there.
  const page = pageActions(data)[action];
  if (page) {
    openPage(page);
    return;
  }
  if (token && API_ACTIONS.includes(action)) {
    try {
      await api.pushAction({ token, action: action as PushActionInput['action'] });
      window.dispatchEvent(new CustomEvent(PUSH_ACTION_DONE_EVENT, { detail: action }));
      return;
    } catch {
      // Offline, the API is down, or the token was refused (expired or already used): open the page instead,
      // like the web app's service worker does. The person stays signed in (api.pushAction sends no login).
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
    // The notification channels (their sounds) must exist before a reminder arrives. Android only.
    if (Capacitor.getPlatform() === 'android') void createAndroidChannels().catch(() => {});
    void plugin().then((push) => {
      // The reminder's kind says which chime to play (only if the person has touched the screen, and it isn't quiet hours).
      void push.addListener('pushNotificationReceived', (notification) => {
        const kind = (notification.data as Record<string, unknown> | undefined)?.kind;
        const known = (PUSH_KINDS as readonly unknown[]).includes(kind) ? kind : null;
        window.dispatchEvent(new CustomEvent(PUSH_RECEIVED_EVENT, { detail: { kind: known } }));
      });
      void push.addListener('pushNotificationActionPerformed', (event) => void handleAction(event));
    });
  },
};
