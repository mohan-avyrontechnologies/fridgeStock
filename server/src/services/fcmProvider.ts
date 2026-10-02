import type { PushPayload } from '@cook-first/shared';
import { clock } from './clock.js';
import type { PushProvider } from './pushProvider.js';

/** The slice of Firebase Cloud Messaging this provider uses (a fake one is used in tests). */
export interface FcmMessaging {
  send(message: Record<string, unknown>): Promise<string>;
}

/** The notification category the iOS app registers, with its Used and Snooze buttons. Keep in step with AppDelegate.swift. */
export const IOS_ACTION_CATEGORY = 'FOOD_ITEM';
/** The category for a meal reminder, with Cooked it, Show recipe and Snooze 30 min. Keep in step with AppDelegate.swift. */
export const IOS_MEAL_CATEGORY = 'MEAL_REMINDER';

/** The sound files bundled with the iOS app (client/ios/App/App/*.caf), by sound name. */
export const iosSoundFile = (sound: string) => `${sound}.caf`;

/** Firebase's error codes for a device token that is no longer valid: the app was removed or reinstalled. */
const GONE_CODES = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Push to the Android and iOS apps through Firebase Cloud Messaging (FCM). iOS goes through FCM too, using an
 * APNs key uploaded to the Firebase console.
 *
 * - **Android** gets a data-only message: the app's own messaging service builds the notification, so it can
 *   add the Used and Snooze buttons (a notification message is shown by the system, without buttons).
 * - **iOS** gets a notification message with a category, which is what makes its buttons appear.
 *
 * Every word shown still comes from the server payload, as with Web Push.
 *
 * Sound: Android sets it with the notification **channel** the payload names (food-soon, food-urgent,
 * meal-reminders, or a silent one), created by the app at start; iOS names a bundled sound file, or none
 * for a silent delivery (quiet hours, or sounds off), which is also marked "passive" so it doesn't light the
 * screen. Never a full-screen alarm, a notification that rings until dismissed, or an iOS critical alert.
 */
export function createFcmPushProvider(
  messaging: FcmMessaging,
  options: { apnsBundleId?: string | null; actionUrl?: string | null } = {},
): PushProvider {
  return {
    name: 'fcm',
    publicKey: null,
    async send(target, payload: PushPayload) {
      if (target.platform === 'web') throw new Error('Firebase can only send to the Android and iOS apps.');
      const common = {
        url: payload.url,
        tag: payload.tag,
        kind: payload.kind,
        silent: String(payload.silent),
        // Where each button that opens a page goes. The app opens it when the button is tapped.
        actionUrls: JSON.stringify(
          Object.fromEntries(payload.actions.flatMap((action) => (action.url ? [[action.action, action.url]] : []))),
        ),
        ...(payload.actionToken && { actionToken: payload.actionToken }),
      };
      const message =
        target.platform === 'android'
          ? {
              token: target.token,
              // Data only: all values must be text.
              data: {
                ...common,
                title: payload.title,
                body: payload.body,
                channelId: payload.channel,
                actions: JSON.stringify(payload.actions),
                ...(options.actionUrl && payload.actionToken && { actionUrl: options.actionUrl }),
              },
              android: { priority: 'high', ttl: DAY_MS },
            }
          : {
              token: target.token,
              notification: { title: payload.title, body: payload.body },
              data: common,
              apns: {
                headers: {
                  'apns-priority': '10',
                  'apns-expiration': String(Math.floor((clock.now().getTime() + DAY_MS) / 1000)),
                  ...(options.apnsBundleId && { 'apns-topic': options.apnsBundleId }),
                },
                payload: {
                  aps: {
                    // No sound key at all for a silent delivery.
                    ...(payload.sound && { sound: iosSoundFile(payload.sound) }),
                    // "passive" delivers quietly into the list without lighting the screen. Never "critical".
                    'interruption-level': payload.silent ? 'passive' : 'active',
                    'thread-id': payload.tag,
                    // Single-item and meal reminders have buttons; the daily summary has none.
                    ...(payload.actionToken && {
                      category: payload.kind === 'MEAL' ? IOS_MEAL_CATEGORY : IOS_ACTION_CATEGORY,
                    }),
                  },
                },
              },
            };
      try {
        await messaging.send(message);
        return 'SENT';
      } catch (error) {
        const code =
          (error as { code?: string; errorInfo?: { code?: string } }).code ??
          (error as { errorInfo?: { code?: string } }).errorInfo?.code;
        if (code && GONE_CODES.has(code)) return 'GONE';
        throw error;
      }
    },
  };
}

/**
 * The real Firebase connection, from a service account. It is created on first use, so a server that never
 * sends a native push never loads Firebase.
 */
export function createFirebaseMessaging(credentials: {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}): FcmMessaging {
  let ready: Promise<{ send(message: Record<string, unknown>): Promise<string> }> | null = null;
  return {
    async send(message) {
      ready ??= (async () => {
        const [{ initializeApp, cert, getApps }, { getMessaging }] = await Promise.all([
          import('firebase-admin/app'),
          import('firebase-admin/messaging'),
        ]);
        const app =
          getApps().find((existing) => existing.name === 'cook-first') ??
          initializeApp({ credential: cert(credentials) }, 'cook-first');
        return getMessaging(app) as unknown as { send(message: Record<string, unknown>): Promise<string> };
      })();
      return (await ready).send(message);
    },
  };
}
