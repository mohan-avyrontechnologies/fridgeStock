import type { TokenStorage } from '../types';

/**
 * The login token in the phone's secure storage: the iOS Keychain, or the Android Keystore (through
 * @aparajita/capacitor-secure-storage), instead of localStorage, which any script in the web view could read
 * and which is not encrypted.
 *
 * Values are text. The plugin is loaded on first use.
 */
let ready: Promise<typeof import('@aparajita/capacitor-secure-storage').SecureStorage> | null = null;

function storage() {
  ready ??= import('@aparajita/capacitor-secure-storage').then(async ({ SecureStorage }) => {
    // Keep the token on this phone: no iCloud Keychain sync to the person's other devices.
    await SecureStorage.setSynchronize(false).catch(() => {});
    return SecureStorage;
  });
  return ready;
}

export const nativeStorage: TokenStorage = {
  async getItem(name) {
    const value = await (await storage()).get(name, false, false);
    return typeof value === 'string' ? value : null;
  },
  async setItem(name, value) {
    await (await storage()).set(name, value, false, false);
  },
  async removeItem(name) {
    await (await storage()).remove(name, false);
  },
};
