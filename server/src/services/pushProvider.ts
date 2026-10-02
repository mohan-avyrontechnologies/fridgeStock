import type { PushPayload, PushPlatform } from '@cook-first/shared';
import webpush from 'web-push';
import { env } from '../config/env.js';
import { createFcmPushProvider, createFirebaseMessaging } from './fcmProvider.js';

/**
 * Where a push message goes. A browser is reached through its Web Push subscription; the Android and iOS
 * apps through their Firebase device token. `endpoint` is a stable id for the subscription either way.
 */
export type PushTarget =
  | { platform: 'web'; endpoint: string; keys: { p256dh: string; auth: string } }
  | { platform: 'android' | 'ios'; endpoint: string; token: string };

/**
 * 'SENT': the push service accepted it.
 * 'GONE': the subscription no longer exists (HTTP 404 or 410, or an unregistered token) and should be deleted.
 * Any other failure is thrown.
 */
export type PushSendResult = 'SENT' | 'GONE';

/**
 * A way of delivering push messages. The notification service only ever talks to this interface, so each
 * provider can change without it: Web Push for browsers (below), Firebase Cloud Messaging for the apps
 * (`fcmProvider.ts`).
 */
export interface PushProvider {
  readonly name: string;
  /** The public key the browser needs to subscribe, or null if the provider has none. */
  readonly publicKey: string | null;
  send(target: PushTarget, payload: PushPayload): Promise<PushSendResult>;
}

/** How long a push service keeps trying to reach an offline device: one day. */
const TTL_SECONDS = 24 * 60 * 60;

/** Self-hosted Web Push with VAPID keys, via the web-push library. */
export function createWebPushProvider(vapid: { publicKey: string; privateKey: string; subject: string }): PushProvider {
  return {
    name: 'web-push',
    publicKey: vapid.publicKey,
    async send(target, payload) {
      if (target.platform !== 'web') throw new Error('Web Push can only send to a browser.');
      try {
        await webpush.sendNotification({ endpoint: target.endpoint, keys: target.keys }, JSON.stringify(payload), {
          vapidDetails: vapid,
          TTL: TTL_SECONDS,
          timeout: 10_000,
        });
        return 'SENT';
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return 'GONE';
        throw error;
      }
    },
  };
}

let web: PushProvider | null = env.vapid ? createWebPushProvider(env.vapid) : null;
let native: PushProvider | null = env.fcm
  ? createFcmPushProvider(createFirebaseMessaging(env.fcm), {
      apnsBundleId: env.apnsBundleId,
      actionUrl: env.publicApiUrl ? `${env.publicApiUrl}/push/actions` : null,
    })
  : null;

/** The Web Push provider (browsers), or null when it isn't configured. */
export function pushProvider(): PushProvider | null {
  return web;
}

/** The provider for the Android and iOS apps (Firebase), or null when it isn't configured. */
export function nativePushProvider(): PushProvider | null {
  return native;
}

/** Whether any push is set up (reminders stay in-app only when nothing is). */
export function anyPushProvider(): PushProvider | null {
  return web ?? native;
}

/** Who delivers to this kind of subscription. */
export function providerFor(platform: PushPlatform): PushProvider | null {
  return platform === 'web' ? web : native;
}

/** Swaps the Web Push provider (tests use a fake one). */
export function setPushProvider(next: PushProvider | null): void {
  web = next;
}

/** Swaps the native provider (tests use a fake one). */
export function setNativePushProvider(next: PushProvider | null): void {
  native = next;
}
