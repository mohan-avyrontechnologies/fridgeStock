import type { Platform } from '../types';
import { nativeBarcode } from './barcode';
import { nativeCamera } from './camera';
import { nativePush } from './push';
import { nativeStorage } from './storage';

/** The Android and iOS apps (Capacitor): the system camera, the ML Kit scanner, native push and secure storage. */
export function createNativePlatform(name: 'android' | 'ios'): Platform {
  return {
    name,
    native: true,
    storage: nativeStorage,
    camera: nativeCamera,
    barcode: nativeBarcode,
    push: nativePush,
  };
}
