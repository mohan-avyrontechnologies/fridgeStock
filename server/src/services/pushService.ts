import type { PushConfig, PushDevice, PushPayload, PushSubscriptionInput } from '@cook-first/shared';
import { PushSubscriptionModel, type PushSubscriptionDoc } from '../models/PushSubscription.js';
import type { UserDoc } from '../models/User.js';
import { clock } from './clock.js';
import { nativePushProvider, providerFor, pushProvider, type PushTarget } from './pushProvider.js';

/** Only the public key is shared with the client; the private key never leaves the server. */
export function config(): PushConfig {
  return { publicKey: pushProvider()?.publicKey ?? null, native: nativePushProvider() !== null };
}

function toDeviceView(doc: PushSubscriptionDoc): PushDevice {
  return {
    id: doc._id.toString(),
    platform: doc.platform ?? 'web',
    browser: doc.browser,
    createdAt: doc.createdAt.toISOString(),
    lastUsedAt: doc.lastUsedAt?.toISOString() ?? null,
  };
}

/** The id an app's subscription is stored under. */
const nativeId = (platform: 'android' | 'ios', token: string) => `${platform}:${token}`;

/**
 * Registers this browser or app for the signed-in user. Subscribing again just refreshes it. A phone belongs
 * to whoever is signed in on it: registering an app's token takes it away from anyone else who had it, so
 * reminders for one account never arrive on a phone another person now uses.
 */
export async function subscribe(user: UserDoc, input: PushSubscriptionInput): Promise<PushDevice> {
  if ('token' in input) {
    const endpoint = nativeId(input.platform, input.token);
    await PushSubscriptionModel.deleteMany({ endpoint, userId: { $ne: user._id } });
    const doc = await PushSubscriptionModel.findOneAndUpdate(
      { userId: user._id, endpoint },
      { $set: { platform: input.platform, token: input.token, browser: input.browser || null } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    return toDeviceView(doc);
  }
  const doc = await PushSubscriptionModel.findOneAndUpdate(
    { userId: user._id, endpoint: input.endpoint },
    { $set: { platform: 'web', keys: input.keys, browser: input.browser || null } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  return toDeviceView(doc);
}

/** Stops push reminders to this browser or app (turning them off, or logging out). */
export async function unsubscribe(user: UserDoc, which: { endpoint: string } | { token: string }): Promise<void> {
  if ('endpoint' in which) {
    await PushSubscriptionModel.deleteOne({ userId: user._id, endpoint: which.endpoint });
    return;
  }
  await PushSubscriptionModel.deleteMany({ userId: user._id, token: which.token });
}

export async function hasDevices(user: UserDoc): Promise<boolean> {
  return (await PushSubscriptionModel.countDocuments({ userId: user._id })) > 0;
}

function targetFor(doc: PushSubscriptionDoc): PushTarget | null {
  const platform = doc.platform ?? 'web';
  if (platform === 'web') return doc.keys ? { platform, endpoint: doc.endpoint, keys: doc.keys } : null;
  return doc.token ? { platform, endpoint: doc.endpoint, token: doc.token } : null;
}

/**
 * Sends one message to every device the user has registered: browsers through Web Push, the apps through
 * Firebase. Never throws: push is an extra, and in-app reminders never depend on it.
 * - accepted: `lastUsedAt` is updated
 * - the device is gone (404 or 410, or an unregistered token): the subscription is deleted
 * - anything else: logged and kept, to try again next time
 * - a kind of device with no provider set up is skipped
 * Returns how many devices accepted it.
 */
export async function sendToUser(user: UserDoc, payload: PushPayload): Promise<number> {
  const subscriptions = await PushSubscriptionModel.find({ userId: user._id });
  let sent = 0;
  for (const subscription of subscriptions) {
    const provider = providerFor(subscription.platform ?? 'web');
    const target = targetFor(subscription);
    if (!provider || !target) continue;
    try {
      const result = await provider.send(target, payload);
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
