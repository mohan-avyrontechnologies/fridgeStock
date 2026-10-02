import type { PushPlatform } from '@cook-first/shared';
import { Schema, Types, model, type HydratedDocument } from 'mongoose';

/**
 * A device that has turned on push reminders: a browser (Web Push, RFC 8030) or the Android or iOS app
 * (a Firebase Cloud Messaging device token).
 */
export interface PushSubscription {
  userId: Types.ObjectId;
  /** Which kind of device this is, and so who delivers to it. */
  platform: PushPlatform;
  /**
   * A stable id for the subscription, never returned by the API. For a browser it is the push service URL;
   * for an app it is "<platform>:<token>".
   */
  endpoint: string;
  /** Web Push only. */
  keys?: { p256dh: string; auth: string };
  /** Apps only: the Firebase device token. */
  token?: string;
  /** e.g. "Chrome on Android" or "Cook First app on iOS", for the user's own reference. */
  browser: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

const isWeb = (doc: { platform?: PushPlatform }) => (doc.platform ?? 'web') === 'web';

const pushSubscriptionSchema = new Schema<PushSubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    platform: { type: String, enum: ['web', 'android', 'ios'], default: 'web', required: true },
    endpoint: { type: String, required: true },
    keys: {
      p256dh: {
        type: String,
        required: function (this: { platform?: PushPlatform }) {
          return isWeb(this);
        },
      },
      auth: {
        type: String,
        required: function (this: { platform?: PushPlatform }) {
          return isWeb(this);
        },
      },
    },
    token: {
      type: String,
      required: function (this: { platform?: PushPlatform }) {
        return !isWeb(this);
      },
    },
    browser: { type: String, default: null },
    lastUsedAt: { type: Date, default: null },
  },
  // shardKey adds userId to the filter of every save()/deleteOne() on a document.
  { timestamps: true, shardKey: { userId: 1 } },
);

pushSubscriptionSchema.index({ userId: 1, endpoint: 1 }, { unique: true });
// Finding a native device by its id, to move it to whoever signs in on it.
pushSubscriptionSchema.index({ endpoint: 1 });

export type PushSubscriptionDoc = HydratedDocument<PushSubscription>;
export const PushSubscriptionModel = model<PushSubscription>('PushSubscription', pushSubscriptionSchema);
