import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_URL } from '../api/client';
import { browserName, keyToBytes, pushSupport, turnOff, turnOn } from '../lib/push';
import { server } from '../mocks/server';

/** Phase 3: the browser push layer, against fake Notification / service worker / PushManager objects. */

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
};

const original = { userAgent: navigator.userAgent };

function setUserAgent(value: string) {
  Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
}

function fakeSubscription(endpoint = 'https://push.example.com/send/abc') {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'P256DH', auth: 'AUTH' } }),
    unsubscribe: vi.fn(async () => true),
  };
}

/** Installs a fake service worker registration whose pushManager returns `existing`. */
function fakeServiceWorker(existing: ReturnType<typeof fakeSubscription> | null = null) {
  const created = fakeSubscription();
  const pushManager = {
    getSubscription: vi.fn(async () => existing),
    subscribe: vi.fn(async () => created),
  };
  const registration = { pushManager };
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      getRegistration: vi.fn(async () => registration),
      register: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
    },
    configurable: true,
  });
  vi.stubGlobal('PushManager', class {});
  return { pushManager, created };
}

afterEach(() => {
  setUserAgent(original.userAgent);
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  vi.unstubAllGlobals();
});

describe('pushSupport', () => {
  it('on iPhone in a Safari tab, the app must be added to the Home Screen first', () => {
    setUserAgent(UA.iphoneSafari);
    expect(pushSupport()).toBe('ios-needs-home-screen');
  });

  it('on iPhone opened from the Home Screen, push is supported', () => {
    setUserAgent(UA.iphoneSafari);
    fakeServiceWorker();
    vi.stubGlobal('Notification', { permission: 'default' });
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    try {
      expect(pushSupport()).toBe('supported');
    } finally {
      delete (navigator as unknown as Record<string, unknown>).standalone;
    }
  });

  it('is unsupported without a service worker and the Push API', () => {
    setUserAgent(UA.androidChrome);
    expect(pushSupport()).toBe('unsupported');
  });
});

describe('turnOn', () => {
  it('stops at a denied permission without subscribing', async () => {
    const { pushManager } = fakeServiceWorker();
    vi.stubGlobal('Notification', { requestPermission: vi.fn(async () => 'denied') });
    expect(
      await turnOn('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
    ).toBe('blocked');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('subscribes with the VAPID public key and registers the browser with the server', async () => {
    setUserAgent(UA.androidChrome);
    const { pushManager } = fakeServiceWorker();
    vi.stubGlobal('Notification', { requestPermission: vi.fn(async () => 'granted') });
    let body: unknown;
    server.use(
      http.post(`${API_URL}/push/subscriptions`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { id: 'd1', browser: 'Chrome on Android', createdAt: '', lastUsedAt: null },
          { status: 201 },
        );
      }),
    );
    expect(await turnOn('AQID')).toBe('on');
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 2, 3]),
    });
    expect(body).toEqual({
      endpoint: 'https://push.example.com/send/abc',
      keys: { p256dh: 'P256DH', auth: 'AUTH' },
      browser: 'Chrome on Android',
    });
  });
});

describe('turnOff', () => {
  it('removes the subscription from the server (with the given token) and from the browser', async () => {
    const existing = fakeSubscription('https://push.example.com/send/mine');
    fakeServiceWorker(existing);
    let seen: { endpoint?: string; auth?: string | null } = {};
    server.use(
      http.delete(`${API_URL}/push/subscriptions`, async ({ request }) => {
        seen = {
          ...((await request.json()) as { endpoint: string }),
          auth: request.headers.get('Authorization'),
        };
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await turnOff('old-token');
    expect(seen).toEqual({ endpoint: 'https://push.example.com/send/mine', auth: 'Bearer old-token' });
    expect(existing.unsubscribe).toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('decodes URL-safe base64 VAPID keys', () => {
    expect([...keyToBytes('AQID')]).toEqual([1, 2, 3]);
    expect([...keyToBytes('-_8')]).toEqual([251, 255]);
  });

  it('names the browser without identifying details', () => {
    expect(browserName(UA.androidChrome)).toBe('Chrome on Android');
    expect(browserName(UA.iphoneSafari)).toBe('Safari on iOS');
    expect(browserName(UA.windowsEdge)).toBe('Edge on Windows');
  });
});
