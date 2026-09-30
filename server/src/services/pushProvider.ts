import type { PushPayload } from '@cook-first/shared';
import webpush from 'web-push';
import { env } from '../config/env.js';

/** Where a push message goes. For Web Push this is the browser's subscription. */
export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * 'SENT': the push service accepted it.
 * 'GONE': the subscription no longer exists (HTTP 404 or 410) and should be deleted.
 * Any other failure is thrown.
 */
export type PushSendResult = 'SENT' | 'GONE';

/**
 * A way of delivering push messages. The notification service only ever talks
 * to this interface, so another provider (for example Firebase Cloud Messaging
 * for native apps) can be added without changing it.
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
      try {
        await webpush.sendNotification(target, JSON.stringify(payload), {
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

let provider: PushProvider | null = env.vapid ? createWebPushProvider(env.vapid) : null;

/** The active provider, or null when push isn't configured (reminders stay in-app only). */
export function pushProvider(): PushProvider | null {
  return provider;
}

/** Swaps the provider (tests use a fake one). */
export function setPushProvider(next: PushProvider | null): void {
  provider = next;
}
