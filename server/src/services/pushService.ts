import type { PushConfig, PushDevice, PushPayload, PushSubscriptionInput } from '@cook-first/shared';
import { PushSubscriptionModel, type PushSubscriptionDoc } from '../models/PushSubscription.js';
import type { UserDoc } from '../models/User.js';
import { clock } from './clock.js';
import { pushProvider } from './pushProvider.js';

/** Only the public key is shared with the client; the private key never leaves the server. */
export function config(): PushConfig {
  return { publicKey: pushProvider()?.publicKey ?? null };
}

function toDeviceView(doc: PushSubscriptionDoc): PushDevice {
  return {
    id: doc._id.toString(),
    browser: doc.browser,
    createdAt: doc.createdAt.toISOString(),
    lastUsedAt: doc.lastUsedAt?.toISOString() ?? null,
  };
}

/** Registers this browser for the signed-in user. Subscribing again just refreshes the keys. */
export async function subscribe(user: UserDoc, input: PushSubscriptionInput): Promise<PushDevice> {
  const doc = await PushSubscriptionModel.findOneAndUpdate(
    { userId: user._id, endpoint: input.endpoint },
    { $set: { keys: input.keys, browser: input.browser || null } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  return toDeviceView(doc);
}

/** Stops push reminders to this browser (turning them off, or logging out). */
export async function unsubscribe(user: UserDoc, endpoint: string): Promise<void> {
  await PushSubscriptionModel.deleteOne({ userId: user._id, endpoint });
}

export async function hasDevices(user: UserDoc): Promise<boolean> {
  return (await PushSubscriptionModel.countDocuments({ userId: user._id })) > 0;
}

/**
 * Sends one message to every browser the user has registered. Never throws:
 * push is an extra, and in-app reminders never depend on it.
 * - accepted: `lastUsedAt` is updated
 * - 404 or 410 from the push service: the subscription is deleted
 * - anything else: logged and kept, to try again next time
 * Returns how many browsers accepted it.
 */
export async function sendToUser(user: UserDoc, payload: PushPayload): Promise<number> {
  const provider = pushProvider();
  if (!provider) return 0;
  const subscriptions = await PushSubscriptionModel.find({ userId: user._id });
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      const result = await provider.send({ endpoint: subscription.endpoint, keys: subscription.keys }, payload);
      if (result === 'GONE') {
        await subscription.deleteOne();
        continue;
      }
      subscription.lastUsedAt = clock.now();
      await subscription.save();
      sent += 1;
    } catch (error) {
      console.error(`Push via ${provider.name} failed`, error instanceof Error ? error.message : error);
    }
  }
  return sent;
}
