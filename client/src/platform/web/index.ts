import * as push from '../../lib/push';
import type { BarcodePlatform, CameraPlatform, HapticsPlatform, Platform, PushPlatform, TokenStorage } from '../types';

/** The web app: exactly what it did before the apps existed. */

/** The login token in the browser's localStorage (read when used, not when this file loads). */
export const webStorage: TokenStorage = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => localStorage.setItem(name, value),
  removeItem: (name) => localStorage.removeItem(name),
};

/** A browser takes photos through a file input (`capture` opens the camera on a phone), so there is nothing to do here. */
export const webCamera: CameraPlatform = {
  native: false,
  async takePhoto() {
    return null;
  },
};

/** A browser reads barcodes live from the camera view (BarcodeDetector, or @zxing/browser), see lib/barcodeCamera. */
export const webBarcode: BarcodePlatform = {
  native: false,
  async scan() {
    return null;
  },
};

/** A browser has no haptic engine to use here, so completed actions are silent and still. */
export const webHaptics: HapticsPlatform = {
  success() {},
  warning() {},
};

/** Web Push, through the service worker (lib/push). */
export const webPush: PushPlatform = {
  native: false,
  support: () => push.pushSupport(),
  isAvailable: (config) => Boolean(config.publicKey),
  isBlocked: () => Notification.permission === 'denied',
  async isOn() {
    return Boolean(await push.currentSubscription());
  },
  async turnOn(config) {
    return push.turnOn(config.publicKey!);
  },
  turnOff: (token) => push.turnOff(token),
  start() {
    // The service worker is registered from main.tsx; there is nothing else to listen for in a browser.
  },
};

export const webPlatform: Platform = {
  name: 'web',
  native: false,
  storage: webStorage,
  camera: webCamera,
  barcode: webBarcode,
  push: webPush,
  haptics: webHaptics,
};
