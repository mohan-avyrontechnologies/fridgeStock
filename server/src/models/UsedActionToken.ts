import { Schema, model } from 'mongoose';

/**
 * A notification button's action token that has been used. Each token has its own id, so a token can carry
 * out one action once; the record is dropped when the token would have expired anyway.
 */
export interface UsedActionToken {
  jti: string;
  expiresAt: Date;
}

const usedActionTokenSchema = new Schema<UsedActionToken>({
  jti: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});

usedActionTokenSchema.index({ jti: 1 }, { unique: true });
usedActionTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const UsedActionTokenModel = model<UsedActionToken>('UsedActionToken', usedActionTokenSchema);
