import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Choosing between the web and native platforms, the web one being exactly what the app did before, and the
 * login token living in secure storage in the apps. The Capacitor plugins are replaced by fakes.
 */

/** A pretend secure storage (Keychain or Keystore) that holds text. */
const secure = vi.hoisted(() => ({
  values: new Map<string, string>(),
  synchronize: vi.fn(async (_on: boolean) => {}),
  delay: 0,
}));

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    setSynchronize: secure.synchronize,
    async get(key: string) {
      if (secure.delay) await new Promise((resolve) => setTimeout(resolve, secure.delay));
      return secure.values.get(key) ?? null;
    },
    async set(key: string, value: string) {
      secure.values.set(key, value);
    },
    async remove(key: string) {
      return secure.values.delete(key);
    },
  },
}));

/** Loads the platform fresh, as if the app had just started in a browser or in a native app. */
async function loadPlatform(native: false | 'ios' | 'android') {
  vi.resetModules();
  vi.doMock('@capacitor/core', () => ({
    Capacitor: {
      isNativePlatform: () => native !== false,
      getPlatform: () => (native === false ? 'web' : native),
    },
  }));
  return import('../platform');
}

beforeEach(() => {
  secure.values.clear();
  secure.synchronize.mockClear();
  secure.delay = 0;
});

afterEach(() => {
  vi.doUnmock('@capacitor/core');
  vi.resetModules();
});

describe('choosing the platform', () => {
  it('is the web platform in a browser', async () => {
    const { platform } = await loadPlatform(false);
    expect(platform.name).toBe('web');
    expect(platform.native).toBe(false);
    expect(platform.camera.native).toBe(false);
    expect(platform.barcode.native).toBe(false);
    expect(platform.push.native).toBe(false);
  });

  it('is the iOS or Android platform in the apps', async () => {
    for (const os of ['ios', 'android'] as const) {
      const { platform } = await loadPlatform(os);
      expect(platform.name).toBe(os);
      expect(platform.native).toBe(true);
      expect(platform.camera.native).toBe(true);
      expect(platform.barcode.native).toBe(true);
      expect(platform.push.native).toBe(true);
    }
  });

  it('is the web platform under the test runner, so the existing tests are unchanged', async () => {
    vi.resetModules();
    const { platform } = await import('../platform');
    expect(platform.name).toBe('web');
  });
});

describe('the web platform', () => {
  it('keeps the login token in localStorage, as it always did', async () => {
    const { platform } = await loadPlatform(false);
    expect(platform.storage.getItem('k')).toBeNull();
    platform.storage.setItem('k', 'value');
    expect(localStorage.getItem('k')).toBe('value');
    expect(platform.storage.getItem('k')).toBe('value');
    platform.storage.removeItem('k');
    expect(localStorage.getItem('k')).toBeNull();
  });

  it('leaves photos to the file input and barcodes to the live camera view', async () => {
    const { platform } = await loadPlatform(false);
    expect(await platform.camera.takePhoto()).toBeNull();
    expect(await platform.barcode.scan()).toBeNull();
  });

  it('opens the screen’s own file input to pick a photo, and never calls the camera plugin', async () => {
    const { platform } = await loadPlatform(false);
    const { pickPhoto } = await import('../platform/pickPhoto');
    const camera = vi.spyOn(platform.camera, 'takePhoto');
    const input = document.createElement('input');
    const click = vi.spyOn(input, 'click');
    const onFile = vi.fn();
    await pickPhoto(input, onFile);
    expect(click).toHaveBeenCalledOnce();
    expect(camera).not.toHaveBeenCalled();
    expect(onFile).not.toHaveBeenCalled();
    await expect(pickPhoto(null, onFile)).resolves.toBeUndefined();
  });

  it('starts push without doing anything (the service worker is registered from main.tsx)', async () => {
    const { platform } = await loadPlatform(false);
    expect(() => platform.push.start()).not.toThrow();
    expect(platform.push.isAvailable({ publicKey: 'KEY', native: false })).toBe(true);
    expect(platform.push.isAvailable({ publicKey: null, native: true })).toBe(false);
  });
});

describe('the native platform', () => {
  it('uses the system camera plugin to pick a photo, and the screen’s input is left alone', async () => {
    const { platform } = await loadPlatform('ios');
    const { pickPhoto } = await import('../platform/pickPhoto');
    const file = new File(['x'], 'photo.jpeg', { type: 'image/jpeg' });
    vi.spyOn(platform.camera, 'takePhoto').mockResolvedValue(file);
    const input = document.createElement('input');
    const click = vi.spyOn(input, 'click');
    const onFile = vi.fn();
    await pickPhoto(input, onFile);
    expect(onFile).toHaveBeenCalledWith(file);
    expect(click).not.toHaveBeenCalled();
  });

  it('does nothing when the camera is closed without a photo', async () => {
    const { platform } = await loadPlatform('android');
    const { pickPhoto } = await import('../platform/pickPhoto');
    vi.spyOn(platform.camera, 'takePhoto').mockResolvedValue(null);
    const onFile = vi.fn();
    await pickPhoto(document.createElement('input'), onFile);
    expect(onFile).not.toHaveBeenCalled();
  });
});

describe('the login token in secure storage', () => {
  it('is read, written and removed through the Keychain or Keystore, never localStorage, and not synced to other devices', async () => {
    const { platform } = await loadPlatform('ios');
    expect(await platform.storage.getItem('token')).toBeNull();
    await platform.storage.setItem('token', 'secret-jwt');
    expect(await platform.storage.getItem('token')).toBe('secret-jwt');
    expect(secure.values.get('token')).toBe('secret-jwt');
    expect(localStorage.length).toBe(0);
    expect(secure.synchronize).toHaveBeenCalledWith(false);
    await platform.storage.removeItem('token');
    expect(await platform.storage.getItem('token')).toBeNull();
  });

  it('keeps the signed-in user in secure storage when logging in, and not in localStorage', async () => {
    await loadPlatform('android');
    const { useAuthStore } = await import('../stores/authStore');
    useAuthStore.setState({
      token: 'jwt-123',
      user: { id: 'u1', name: 'Asha' } as never,
    });
    await vi.waitFor(() => expect(secure.values.get('cook-first-auth')).toBeDefined());
    const saved = JSON.parse(secure.values.get('cook-first-auth')!);
    expect(saved.state.token).toBe('jwt-123');
    expect(localStorage.getItem('cook-first-auth')).toBeNull();
  });

  it('waits for the saved login to be read before the app decides who is signed in', async () => {
    secure.values.set('cook-first-auth', JSON.stringify({ state: { token: 'saved-jwt', user: null }, version: 0 }));
    secure.delay = 30;
    await loadPlatform('ios');
    const { useAuthStore } = await import('../stores/authStore');
    expect(useAuthStore.persist.hasHydrated()).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
    await vi.waitFor(() => expect(useAuthStore.persist.hasHydrated()).toBe(true));
    expect(useAuthStore.getState().token).toBe('saved-jwt');
  });

  it('reads the saved login at once in a browser, so nothing waits', async () => {
    localStorage.setItem('cook-first-auth', JSON.stringify({ state: { token: 'web-jwt', user: null }, version: 0 }));
    await loadPlatform(false);
    const { useAuthStore } = await import('../stores/authStore');
    expect(useAuthStore.persist.hasHydrated()).toBe(true);
    expect(useAuthStore.getState().token).toBe('web-jwt');
  });
});
