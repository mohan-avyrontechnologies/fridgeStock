import { api, API_URL } from '../api/client';

/**
 * Web Push on the client. Nothing here asks for permission by itself:
 * `turnOn` is only ever called from the "Turn on reminders" button.
 */

/** What this browser can do about push reminders. */
export type PushSupport = 'supported' | 'ios-needs-home-screen' | 'unsupported';

/** iPhone and iPad (iPadOS reports itself as a Mac with a touch screen). */
export function isIos(nav: Navigator = navigator): boolean {
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
}

/** Opened from the Home Screen / as an installed app rather than in a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  // On iPhone, push only works once the app has been added to the Home Screen and opened from there.
  if (isIos() && !isStandalone()) return 'ios-needs-home-screen';
  return capable ? 'supported' : 'unsupported';
}

/** Registers the service worker that shows push reminders. Safe to call on every start. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(`/sw.js?api=${encodeURIComponent(API_URL)}`);
  } catch {
    return null;
  }
}

/** A short, non-identifying browser name, e.g. "Chrome on Android". */
export function browserName(userAgent: string = navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser';
  const os = /Android/.test(userAgent)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(userAgent)
      ? 'iOS'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return os ? `${browser} on ${os}` : browser;
}

/** VAPID public keys are URL-safe base64; the Push API wants bytes. */
export function keyToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
}

/** This browser's current push subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export type TurnOnResult = 'on' | 'blocked' | 'dismissed';

/**
 * Asks for notification permission (so it must be called from a tap), then
 * subscribes this browser and registers it with the server.
 */
export async function turnOn(publicKey: string): Promise<TurnOnResult> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'dismissed';
  const reg = await registration();
  if (!reg) throw new Error('Service worker unavailable');
  await navigator.serviceWorker.ready;
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
  const { endpoint, keys } = subscription.toJSON();
  await api.subscribePush({
    endpoint: endpoint!,
    keys: { p256dh: keys!.p256dh!, auth: keys!.auth! },
    browser: browserName(),
  });
  return 'on';
}

/** Stops push reminders on this browser, on the server and in the browser. */
export async function turnOff(token?: string): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  try {
    await api.unsubscribePush(subscription.endpoint, token);
  } finally {
    await subscription.unsubscribe();
  }
}
