import { Schema, Types, model, type HydratedDocument } from 'mongoose';

/** A browser that has turned on push reminders (Web Push, RFC 8030). */
export interface PushSubscription {
  userId: Types.ObjectId;
  /** The push service URL for this browser; secret, never returned by the API. */
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** e.g. "Chrome on Android", for the user's own reference. */
  browser: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

const pushSubscriptionSchema = new Schema<PushSubscription>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    endpoint: { type: String, required: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    browser: { type: String, default: null },
    lastUsedAt: { type: Date, default: null },
  },
  // shardKey adds userId to the filter of every save()/deleteOne() on a document.
  { timestamps: true, shardKey: { userId: 1 } },
);

pushSubscriptionSchema.index({ userId: 1, endpoint: 1 }, { unique: true });

export type PushSubscriptionDoc = HydratedDocument<PushSubscription>;
export const PushSubscriptionModel = model<PushSubscription>('PushSubscription', pushSubscriptionSchema);
