import type { PushConfig } from '@cook-first/shared';
import type { PushSupport, TurnOnResult } from '../lib/push';

/**
 * Everything that differs between the web app and the Capacitor apps for Android and iOS lives behind these
 * interfaces. The web implementations (platform/web) are what the app has always done, and are chosen in a
 * browser, so the web app and its tests are unchanged. The native ones (platform/native) are chosen by
 * `Capacitor.isNativePlatform()`. Native code loads the Capacitor plugins on demand, so a browser never
 * downloads them.
 */

/** Where the login token is kept. Same shape as zustand's storage, so the auth store can use either. */
export interface TokenStorage {
  getItem(name: string): string | null | Promise<string | null>;
  setItem(name: string, value: string): void | Promise<void>;
  removeItem(name: string): void | Promise<void>;
}

export interface CameraPlatform {
  /** True in the apps: the camera is opened by the system camera plugin. In a browser a file input does it. */
  readonly native: boolean;
  /** Native only: the system camera or photo library. Resolves with the photo, or null if cancelled. */
  takePhoto(): Promise<File | null>;
}

export interface BarcodePlatform {
  /** True in the apps: the ML Kit scanner opens over the app. In a browser the live camera view does it. */
  readonly native: boolean;
  /** Native only: scans one barcode. Resolves with its number, or null if cancelled. Rejects if the camera is refused. */
  scan(): Promise<string | null>;
}

export interface PushPlatform {
  readonly native: boolean;
  /** What this device can do about push reminders. */
  support(): PushSupport | Promise<PushSupport>;
  /** Whether the server is set up to send to this kind of device. */
  isAvailable(config: PushConfig): boolean;
  /** The person has refused notifications for this app or site. */
  isBlocked(): boolean | Promise<boolean>;
  /** This device is registered for reminders. */
  isOn(): Promise<boolean>;
  /** Asks for permission (so call it from a tap) and registers this device with the server. */
  turnOn(config: PushConfig): Promise<TurnOnResult>;
  /** Stops reminders to this device, on the server and on the device. `token` is for calls made while signing out. */
  turnOff(token?: string): Promise<void>;
  /** Called once when the app starts: listeners for notifications and their buttons (apps only). */
  start(): void;
}

/** A short physical tap to confirm a completed action. Only the apps have one; a browser does nothing. */
export interface HapticsPlatform {
  /** An action went through (marked as used, undone). */
  success(): void;
  /** An action that closes food as lost went through (marked as wasted). */
  warning(): void;
}

export interface Platform {
  readonly name: 'web' | 'android' | 'ios';
  readonly native: boolean;
  readonly storage: TokenStorage;
  readonly camera: CameraPlatform;
  readonly barcode: BarcodePlatform;
  readonly push: PushPlatform;
  readonly haptics: HapticsPlatform;
}
