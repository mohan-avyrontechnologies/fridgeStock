import { env } from './env.js';

let photoCheckOverride: boolean | null = null;

/** Photo Check is behind a feature flag (PHOTO_CHECK=on). It also needs AI to be enabled. */
export const photoCheckEnabled = (): boolean => photoCheckOverride ?? env.photoCheck;

/** Tests switch the flag on and off without touching the environment. */
export function setPhotoCheckEnabled(value: boolean | null): void {
  photoCheckOverride = value;
}
