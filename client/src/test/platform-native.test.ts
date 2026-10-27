import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_URL } from '../api/client';
import { server } from '../mocks/server';
import { nativeBarcode } from '../platform/native/barcode';
import { nativeCamera } from '../platform/native/camera';
import { nativePush } from '../platform/native/push';
import { nativeStorage } from '../platform/native/storage';
import { OPEN_PAGE_EVENT, PUSH_ACTION_DONE_EVENT, PUSH_RECEIVED_EVENT } from '../platform/events';

/** The native camera, scanner and push, with the Capacitor plugins replaced by fakes (no phone is needed). */

const state = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android',
  // storage
  secure: new Map<string, string>(),
  // camera
  photo: { webPath: 'blob:photo', format: 'jpeg' } as { webPath?: string; format: string },
  cameraError: null as Error | null,
  // barcode
  cameraPermission: 'granted',
  scanResult: [{ rawValue: '4006381333931' }] as { rawValue: string }[],
  scanError: null as Error | null,
  moduleAvailable: true,
  installState: 4,
  installListener: null as null | ((event: { state: number }) => void),
  // push
  permission: 'prompt' as string,
  permissionAfterRequest: 'granted' as string,
  registrationToken: 'fcm-device-token-' + 'z'.repeat(140),
  registrationError: null as string | null,
  listeners: new Map<string, (event: unknown) => void>(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => state.os },
}));

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    setSynchronize: vi.fn(async () => {}),
    get: vi.fn(async (key: string) => state.secure.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => void state.secure.set(key, value)),
    remove: vi.fn(async (key: string) => state.secure.delete(key)),
  },
}));

const cameraPlugin = vi.hoisted(() => ({ getPhoto: vi.fn() }));
vi.mock('@capacitor/camera', () => ({
  Camera: cameraPlugin,
  CameraResultType: { Uri: 'uri' },
  CameraSource: { Prompt: 'PROMPT' },
}));

const scanner = vi.hoisted(() => ({
  requestPermissions: vi.fn(),
  scan: vi.fn(),
  isGoogleBarcodeScannerModuleAvailable: vi.fn(),
  installGoogleBarcodeScannerModule: vi.fn(),
  addListener: vi.fn(),
  removeAllListeners: vi.fn(),
}));
vi.mock('@capacitor-mlkit/barcode-scanning', () => ({
  BarcodeScanner: scanner,
  BarcodeFormat: { Ean13: 'EAN_13', Ean8: 'EAN_8', UpcA: 'UPC_A' },
  GoogleBarcodeScannerModuleInstallState: { FAILED: 3, COMPLETED: 4, CANCELED: 5 },
}));

const pushPlugin = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  addListener: vi.fn(),
  createChannel: vi.fn(),
}));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: pushPlugin }));

beforeEach(() => {
  state.os = 'ios';
  state.secure.clear();
  state.photo = { webPath: 'blob:photo', format: 'jpeg' };
  state.cameraError = null;
  state.cameraPermission = 'granted';
  state.scanResult = [{ rawValue: '4006381333931' }];
  state.scanError = null;
  state.moduleAvailable = true;
  state.installState = 4;
  state.installListener = null;
  state.permission = 'prompt';
  state.permissionAfterRequest = 'granted';
  state.registrationError = null;
  state.listeners.clear();

  cameraPlugin.getPhoto.mockImplementation(async () => {
    if (state.cameraError) throw state.cameraError;
    return state.photo;
  });
  const mswFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      // The photo comes back as the page's own Blob, as it does in a web view. (A Node Response's Blob is not
      // jsdom's on Node 20, so jsdom's File would store it as the text "[object Blob]".)
      if (url === 'blob:photo') return { blob: async () => new Blob(['jpeg bytes'], { type: 'image/jpeg' }) };
      return mswFetch(url, init);
    }),
  );

  scanner.requestPermissions.mockImplementation(async () => ({ camera: state.cameraPermission }));
  scanner.scan.mockImplementation(async () => {
    if (state.scanError) throw state.scanError;
    return { barcodes: state.scanResult };
  });
  scanner.isGoogleBarcodeScannerModuleAvailable.mockImplementation(async () => ({ available: state.moduleAvailable }));
  scanner.installGoogleBarcodeScannerModule.mockImplementation(async () => {
    queueMicrotask(() => state.installListener?.({ state: state.installState }));
  });
  scanner.addListener.mockImplementation(async (_event: string, callback: (event: { state: number }) => void) => {
    state.installListener = callback;
    return { remove: vi.fn() };
  });
  scanner.removeAllListeners.mockClear();

  pushPlugin.checkPermissions.mockImplementation(async () => ({ receive: state.permission }));
  pushPlugin.requestPermissions.mockImplementation(async () => {
    state.permission = state.permissionAfterRequest;
    return { receive: state.permission };
  });
  pushPlugin.register.mockImplementation(async () => {
    queueMicrotask(() => {
      if (state.registrationError) state.listeners.get('registrationError')?.({ error: state.registrationError });
      else state.listeners.get('registration')?.({ value: state.registrationToken });
    });
  });
  pushPlugin.unregister.mockResolvedValue(undefined);
  pushPlugin.createChannel.mockResolvedValue(undefined);
  pushPlugin.addListener.mockImplementation(async (event: string, callback: (e: unknown) => void) => {
    state.listeners.set(event, callback);
    return { remove: vi.fn(async () => void state.listeners.delete(event)) };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the native camera', () => {
  it('asks the system for a photo, scaled and upright, and gives it back as a file', async () => {
    const file = await nativeCamera.takePhoto();
    expect(cameraPlugin.getPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'PROMPT',
        resultType: 'uri',
        width: 1600,
        height: 1600,
        correctOrientation: true,
        saveToGallery: false,
      }),
    );
    expect(file).toBeInstanceOf(File);
    expect(file!.type).toBe('image/jpeg');
    expect(file!.name).toBe('photo.jpeg');
    expect(file!.size).toBe('jpeg bytes'.length);
  });

  it('is null when the person closes the camera or chooser without a photo', async () => {
    state.cameraError = new Error('User cancelled photos app');
    expect(await nativeCamera.takePhoto()).toBeNull();
    state.cameraError = null;
    state.photo = { format: 'jpeg' };
    expect(await nativeCamera.takePhoto()).toBeNull();
  });

  it('passes on a real failure, such as a refused camera', async () => {
    state.cameraError = new Error('Camera permission denied');
    await expect(nativeCamera.takePhoto()).rejects.toThrow('Camera permission denied');
  });
});

describe('the native barcode scanner', () => {
  it('reads one grocery barcode with ML Kit and gives back its number', async () => {
    expect(await nativeBarcode.scan()).toBe('4006381333931');
    expect(scanner.scan).toHaveBeenCalledWith({ formats: ['EAN_13', 'EAN_8', 'UPC_A'] });
  });

  it('is null when the scanner is closed, or reads nothing', async () => {
    state.scanError = new Error('scan canceled.');
    expect(await nativeBarcode.scan()).toBeNull();
    state.scanError = null;
    state.scanResult = [];
    expect(await nativeBarcode.scan()).toBeNull();
  });

  it('refuses without the camera permission, and never opens the scanner', async () => {
    state.cameraPermission = 'denied';
    await expect(nativeBarcode.scan()).rejects.toThrow('Camera permission was refused.');
    expect(scanner.scan).not.toHaveBeenCalled();
  });

  it('on Android, installs the Google scanner module first if it is missing, and waits for it', async () => {
    state.os = 'android';
    state.moduleAvailable = false;
    expect(await nativeBarcode.scan()).toBe('4006381333931');
    expect(scanner.installGoogleBarcodeScannerModule).toHaveBeenCalledOnce();
    expect(scanner.removeAllListeners).toHaveBeenCalled();
  });

  it('on Android, fails clearly when the module cannot be installed', async () => {
    state.os = 'android';
    state.moduleAvailable = false;
    state.installState = 3;
    await expect(nativeBarcode.scan()).rejects.toThrow('The scanner could not be installed.');
    expect(scanner.scan).not.toHaveBeenCalled();
  });

  it('on iPhone, never touches the Google module', async () => {
    await nativeBarcode.scan();
    expect(scanner.isGoogleBarcodeScannerModuleAvailable).not.toHaveBeenCalled();
  });
});

describe('native secure storage', () => {
  it('stores text under its key', async () => {
    await nativeStorage.setItem('a', 'one');
    expect(await nativeStorage.getItem('a')).toBe('one');
    await nativeStorage.removeItem('a');
    expect(await nativeStorage.getItem('a')).toBeNull();
  });
});

describe('native push', () => {
  const subscribed: Record<string, unknown>[] = [];
  const unsubscribed: Record<string, unknown>[] = [];

  beforeEach(() => {
    subscribed.length = 0;
    unsubscribed.length = 0;
    server.use(
      http.post(`${API_URL}/push/subscriptions`, async ({ request }) => {
        subscribed.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(
          { id: 'd1', platform: 'ios', browser: null, createdAt: '2026-09-29T10:00:00Z', lastUsedAt: null },
          { status: 201 },
        );
      }),
      http.delete(`${API_URL}/push/subscriptions`, async ({ request }) => {
        unsubscribed.push((await request.json()) as Record<string, unknown>);
        return new HttpResponse(null, { status: 204 });
      }),
    );
  });

  it('is always supported, and available only when the server has Firebase set up', () => {
    expect(nativePush.support()).toBe('supported');
    expect(nativePush.isAvailable({ publicKey: 'KEY', native: false })).toBe(false);
    expect(nativePush.isAvailable({ publicKey: null, native: true })).toBe(true);
  });

  it('asks for permission, registers with the system, sends the token and platform to the server, and remembers it', async () => {
    expect(await nativePush.isOn()).toBe(false);
    expect(await nativePush.turnOn({ publicKey: null, native: true })).toBe('on');
    expect(pushPlugin.requestPermissions).toHaveBeenCalledOnce();
    expect(subscribed).toEqual([{ platform: 'ios', token: state.registrationToken, browser: 'FridgeStock app on iOS' }]);
    expect(await nativePush.isOn()).toBe(true);
    expect([...state.secure.values()]).toContain(state.registrationToken);
  });

  it('says Android on Android', async () => {
    state.os = 'android';
    await nativePush.turnOn({ publicKey: null, native: true });
    expect(subscribed[0]).toMatchObject({ platform: 'android', browser: 'FridgeStock app on Android' });
  });

  it('does not ask again when permission is already granted', async () => {
    state.permission = 'granted';
    await nativePush.turnOn({ publicKey: null, native: true });
    expect(pushPlugin.requestPermissions).not.toHaveBeenCalled();
  });

  it('is blocked when notifications are refused, and registers nothing', async () => {
    state.permissionAfterRequest = 'denied';
    expect(await nativePush.turnOn({ publicKey: null, native: true })).toBe('blocked');
    expect(await nativePush.isBlocked()).toBe(true);
    expect(pushPlugin.register).not.toHaveBeenCalled();
    expect(subscribed).toEqual([]);
  });

  it('is dismissed when the person closes the permission prompt without answering', async () => {
    state.permissionAfterRequest = 'prompt';
    expect(await nativePush.turnOn({ publicKey: null, native: true })).toBe('dismissed');
    expect(subscribed).toEqual([]);
  });

  it('fails clearly when the phone cannot register, and leaves nothing behind', async () => {
    state.registrationError = 'No Google Play services';
    await expect(nativePush.turnOn({ publicKey: null, native: true })).rejects.toThrow('No Google Play services');
    expect(subscribed).toEqual([]);
    expect(await nativePush.isOn()).toBe(false);
  });

  it('turns off by token, on the server and on the phone, and forgets it', async () => {
    await nativePush.turnOn({ publicKey: null, native: true });
    await nativePush.turnOff('auth-jwt');
    expect(unsubscribed).toEqual([{ token: state.registrationToken }]);
    expect(pushPlugin.unregister).toHaveBeenCalledOnce();
    expect(await nativePush.isOn()).toBe(false);
    expect(state.secure.size).toBe(0);
  });

  it('turning off when it was never on does nothing', async () => {
    await nativePush.turnOff();
    expect(unsubscribed).toEqual([]);
    expect(pushPlugin.unregister).not.toHaveBeenCalled();
  });

  it('forgets the token on the phone even if the server cannot be reached', async () => {
    await nativePush.turnOn({ publicKey: null, native: true });
    server.use(http.delete(`${API_URL}/push/subscriptions`, () => HttpResponse.json({}, { status: 500 })));
    await expect(nativePush.turnOff()).rejects.toBeDefined();
    expect(state.secure.size).toBe(0);
    expect(pushPlugin.unregister).toHaveBeenCalled();
  });

  describe('notifications and their buttons', () => {
    const events: { type: string; detail?: unknown }[] = [];
    const removers: (() => void)[] = [];
    const listen = (type: string) => {
      const handler = (e: Event) => events.push({ type, detail: (e as CustomEvent).detail });
      window.addEventListener(type, handler);
      removers.push(() => window.removeEventListener(type, handler));
    };
    let fresh: typeof nativePush;
    afterEach(() => removers.splice(0).forEach((remove) => remove()));
    const tapped = (actionId: string, data: Record<string, unknown>) =>
      state.listeners.get('pushNotificationActionPerformed')!({ actionId, notification: { data } });
    let actions: Record<string, unknown>[];

    beforeEach(async () => {
      events.length = 0;
      actions = [];
      for (const type of [OPEN_PAGE_EVENT, PUSH_RECEIVED_EVENT, PUSH_ACTION_DONE_EVENT]) listen(type);
      server.use(
        http.post(`${API_URL}/push/actions`, async ({ request }) => {
          actions.push((await request.json()) as Record<string, unknown>);
          return new HttpResponse(null, { status: 204 });
        }),
      );
      vi.resetModules();
      fresh = (await import('../platform/native/push')).nativePush;
      fresh.start();
      await vi.waitFor(() => expect(state.listeners.has('pushNotificationActionPerformed')).toBe(true));
    });

    it('sends Used or Snooze to the server with the single-item token, with no page opened', async () => {
      tapped('USED', { actionToken: 'tok', url: '/food/1' });
      await vi.waitFor(() => expect(events.map((e) => e.type)).toContain(PUSH_ACTION_DONE_EVENT));
      expect(actions).toEqual([{ token: 'tok', action: 'USED' }]);
      tapped('SNOOZE', { actionToken: 'tok', url: '/food/1' });
      await vi.waitFor(() => expect(actions).toHaveLength(2));
      expect(actions[1]).toEqual({ token: 'tok', action: 'SNOOZE' });
      expect(events.some((e) => e.type === OPEN_PAGE_EVENT)).toBe(false);
    });

    it('opens the item instead when a button cannot be completed, like the web app does', async () => {
      server.use(http.post(`${API_URL}/push/actions`, () => HttpResponse.json({}, { status: 503 })));
      tapped('USED', { actionToken: 'tok', url: '/food/9' });
      await vi.waitFor(() => expect(events).toContainEqual({ type: OPEN_PAGE_EVENT, detail: '/food/9' }));
    });

    it('a double tap keeps the person signed in: the refused second tap (a 401) only opens the item', async () => {
      const { useAuthStore } = await import('../stores/authStore');
      useAuthStore.setState({ token: 'login-jwt', user: { id: 'u1' } as never });
      const headers: (string | null)[] = [];
      let taps = 0;
      server.use(
        http.post(`${API_URL}/push/actions`, ({ request }) => {
          headers.push(request.headers.get('Authorization'));
          return ++taps === 1
            ? new HttpResponse(null, { status: 204 })
            : HttpResponse.json(
                { error: { code: 'UNAUTHENTICATED', message: 'This notification button has already been used.' } },
                { status: 401 },
              );
        }),
      );

      tapped('USED', { actionToken: 'tok', url: '/food/1' });
      await vi.waitFor(() => expect(events.map((e) => e.type)).toContain(PUSH_ACTION_DONE_EVENT));
      tapped('USED', { actionToken: 'tok', url: '/food/1' });
      await vi.waitFor(() => expect(events).toContainEqual({ type: OPEN_PAGE_EVENT, detail: '/food/1' }));

      expect(headers).toEqual([null, null]); // the action token is the authorisation; no login is sent
      expect(useAuthStore.getState().token).toBe('login-jwt');
      expect(pushPlugin.unregister).not.toHaveBeenCalled(); // signing out would turn push off on the phone
    });

    it('opens the page when the notification itself is tapped, or when it has no token', async () => {
      tapped('tap', { actionToken: 'tok', url: '/fridgestock' });
      tapped('USED', { url: '/food/2' });
      await vi.waitFor(() => expect(events.filter((e) => e.type === OPEN_PAGE_EVENT)).toHaveLength(2));
      expect(events.map((e) => e.detail)).toEqual(['/fridgestock', '/food/2']);
      expect(actions).toEqual([]);
    });

    it('goes Home when a notification has no address', async () => {
      tapped('tap', {});
      await vi.waitFor(() => expect(events).toContainEqual({ type: OPEN_PAGE_EVENT, detail: '/' }));
    });

    it('asks the screens to refresh when a push arrives while the app is open', () => {
      state.listeners.get('pushNotificationReceived')!({});
      expect(events.map((e) => e.type)).toContain(PUSH_RECEIVED_EVENT);
    });

    it('starts listening only once, however many times it is started', async () => {
      const before = pushPlugin.addListener.mock.calls.length;
      fresh.start();
      fresh.start();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(pushPlugin.addListener.mock.calls.length).toBe(before);
    });
  });
});

describe('native push: sounds and the buttons of a meal reminder', () => {
  const events: { type: string; detail?: unknown }[] = [];
  const removers: (() => void)[] = [];
  let actions: Record<string, unknown>[];
  const listen = (type: string) => {
    const handler = (e: Event) => events.push({ type, detail: (e as CustomEvent).detail });
    window.addEventListener(type, handler);
    removers.push(() => window.removeEventListener(type, handler));
  };
  const start = async (os: 'ios' | 'android') => {
    state.os = os;
    vi.resetModules();
    (await import('../platform/native/push')).nativePush.start();
    await vi.waitFor(() => expect(state.listeners.has('pushNotificationActionPerformed')).toBe(true));
  };
  const tapped = (actionId: string, data: Record<string, unknown>) =>
    state.listeners.get('pushNotificationActionPerformed')!({ actionId, notification: { data } });

  beforeEach(() => {
    events.length = 0;
    actions = [];
    for (const type of [OPEN_PAGE_EVENT, PUSH_RECEIVED_EVENT, PUSH_ACTION_DONE_EVENT]) listen(type);
    server.use(
      http.post(`${API_URL}/push/actions`, async ({ request }) => {
        actions.push((await request.json()) as Record<string, unknown>);
        return new HttpResponse(null, { status: 204 });
      }),
    );
  });
  afterEach(() => removers.splice(0).forEach((remove) => remove()));

  describe('the Android notification channels', () => {
    it('creates the four channels that have a sound when the app starts, with their sound files', async () => {
      await start('android');
      await vi.waitFor(() => expect(pushPlugin.createChannel).toHaveBeenCalledTimes(4));
      const made = pushPlugin.createChannel.mock.calls.map(([channel]) => channel);
      expect(made.map((channel) => channel.id)).toEqual([
        'food-soon',
        'food-urgent',
        'meal-reminders',
        'food-urgent-sound',
      ]);
      const byId = Object.fromEntries(made.map((channel) => [channel.id, channel]));
      expect(byId['food-soon']).toMatchObject({ importance: 3, sound: 'reminder_gentle', vibration: false });
      expect(byId['food-urgent']).toMatchObject({ importance: 4, sound: 'reminder_strong', vibration: true });
      expect(byId['meal-reminders']).toMatchObject({ importance: 3, sound: 'reminder_meal', vibration: false });
      expect(byId['food-urgent-sound']).toMatchObject({ importance: 4, sound: 'reminder_strong', vibration: false });
    });

    it('makes none on iPhone', async () => {
      await start('ios');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(pushPlugin.createChannel).not.toHaveBeenCalled();
    });

    it('still listens for notifications if a channel cannot be made', async () => {
      pushPlugin.createChannel.mockRejectedValue(new Error('no channels'));
      await start('android');
      expect(state.listeners.has('pushNotificationReceived')).toBe(true);
    });
  });

  describe('a push arriving while the app is open', () => {
    it('says which kind it is, so the matching chime plays', async () => {
      await start('ios');
      for (const kind of ['DUE', 'MEAL', 'APPROACHING_EXPIRY']) {
        state.listeners.get('pushNotificationReceived')!({ data: { kind } });
      }
      expect(events.filter((e) => e.type === PUSH_RECEIVED_EVENT).map((e) => e.detail)).toEqual([
        { kind: 'DUE' },
        { kind: 'MEAL' },
        { kind: 'APPROACHING_EXPIRY' },
      ]);
    });

    it('says no kind for one it does not know, or none', async () => {
      await start('ios');
      state.listeners.get('pushNotificationReceived')!({ data: { kind: 'SHOUT' } });
      state.listeners.get('pushNotificationReceived')!({});
      expect(events.map((e) => e.detail)).toEqual([{ kind: null }, { kind: null }]);
    });
  });

  describe('the buttons on a meal reminder', () => {
    const data = {
      actionToken: 'meal-token',
      url: '/meal/dinner',
      actionUrls: JSON.stringify({ COOKED: '/add?leftover=1&from=Stew', RECIPE: '/meal/dinner' }),
    };

    it('"Cooked it" and "Show recipe" open their pages, without calling the server', async () => {
      await start('ios');
      tapped('COOKED', data);
      tapped('RECIPE', data);
      await vi.waitFor(() => expect(events.filter((e) => e.type === OPEN_PAGE_EVENT)).toHaveLength(2));
      expect(events.map((e) => e.detail)).toEqual(['/add?leftover=1&from=Stew', '/meal/dinner']);
      expect(actions).toEqual([]);
    });

    it('"Snooze 30 min" calls the server with the meal token and tells the screens', async () => {
      await start('ios');
      tapped('SNOOZE_MEAL', data);
      await vi.waitFor(() => expect(events.map((e) => e.type)).toContain(PUSH_ACTION_DONE_EVENT));
      expect(actions).toEqual([{ token: 'meal-token', action: 'SNOOZE_MEAL' }]);
      expect(events.find((e) => e.type === PUSH_ACTION_DONE_EVENT)!.detail).toBe('SNOOZE_MEAL');
      expect(events.some((e) => e.type === OPEN_PAGE_EVENT)).toBe(false);
    });

    it('"Snooze 30 min" opens the reminder instead when it cannot be sent', async () => {
      server.use(http.post(`${API_URL}/push/actions`, () => HttpResponse.json({}, { status: 503 })));
      await start('ios');
      tapped('SNOOZE_MEAL', data);
      await vi.waitFor(() => expect(events).toContainEqual({ type: OPEN_PAGE_EVENT, detail: '/meal/dinner' }));
    });

    it('copes with a missing or broken list of pages', async () => {
      await start('ios');
      tapped('COOKED', { ...data, actionUrls: 'not json' });
      tapped('RECIPE', { url: '/meal/lunch' });
      await vi.waitFor(() => expect(events.filter((e) => e.type === OPEN_PAGE_EVENT)).toHaveLength(2));
      expect(events.map((e) => e.detail)).toEqual(['/meal/dinner', '/meal/lunch']);
    });
  });
});
