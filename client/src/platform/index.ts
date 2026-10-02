import { Capacitor } from '@capacitor/core';
import { createNativePlatform } from './native';
import type { Platform } from './types';
import { webPlatform } from './web';

export type { Platform } from './types';

/**
 * The platform the app is running on: the Capacitor apps for Android and iOS, or a browser. Chosen once, when
 * the app starts, with `Capacitor.isNativePlatform()`.
 */
export const platform: Platform = Capacitor.isNativePlatform()
  ? createNativePlatform(Capacitor.getPlatform() === 'ios' ? 'ios' : 'android')
  : webPlatform;
