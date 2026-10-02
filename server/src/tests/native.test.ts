import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { PushPayload } from '@cook-first/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NATIVE_APP_ORIGINS } from '../config/native.js';
import { PushSubscriptionModel } from '../models/PushSubscription.js';
import { clock } from '../services/clock.js';
import { createFcmPushProvider, IOS_ACTION_CATEGORY, type FcmMessaging } from '../services/fcmProvider.js';
import { sweep } from '../services/notificationService.js';
import {
  setNativePushProvider,
  setPushProvider,
  type PushProvider,
  type PushTarget,
} from '../services/pushProvider.js';
import { api, food, registerUser } from './helpers.js';

/** Push and CORS for the Capacitor apps (Android and iOS, through Firebase). No test reaches Firebase. */

type Session = Awaited<ReturnType<typeof registerUser>>;

const TOKEN_A = 'fcm-token-android-' + 'a'.repeat(140);
const TOKEN_I = 'fcm-token-ios-' + 'i'.repeat(140);

const android = (token = TOKEN_A) => ({ platform: 'android', token, browser: 'Cook First app on Android' });
const ios = (token = TOKEN_I) => ({ platform: 'ios', token, browser: 'Cook First app on iOS' });
const webDevice = () => ({
  endpoint: 'https://push.example.com/send/web-1',
  keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
  browser: 'Chrome on Android',
});

const subscribe = (s: Session, body: Record<string, unknown>) =>
  s.auth(api().post('/api/push/subscriptions').send(body));
const unsubscribe = (s: Session, body: Record<string, unknown>) =>
  s.auth(api().delete('/api/push/subscriptions').send(body));

/** A provider that records what it is asked to send. */
function recorder(name: string, outcome: (target: PushTarget) => 'SENT' | 'GONE' | Error = () => 'SENT') {
  const sent: { target: PushTarget; payload: PushPayload }[] = [];
  const provider: PushProvider = {
    name,
    publicKey: name === 'web' ? 'PUBLIC-KEY' : null,
    async send(target, payload) {
      const result = outcome(target);
      if (result instanceof Error) throw result;
      if (result === 'SENT') sent.push({ target, payload });
      return result;
    },
  };
  return { provider, sent };
}

afterEach(() => {
  setPushProvider(null);
  setNativePushProvider(null);
  clock.set(null);
  vi.restoreAllMocks();
});

describe('native subscriptions', () => {
  it('stores an Android or iPhone app by its Firebase token, with the platform, and returns no secrets', async () => {
    const s = await registerUser();
    const res = await subscribe(s, android()).expect(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      platform: 'android',
      browser: 'Cook First app on Android',
      createdAt: expect.any(String),
      lastUsedAt: null,
    });
    expect(JSON.stringify(res.body)).not.toContain(TOKEN_A);
    await subscribe(s, ios()).expect(201);

    const saved = await PushSubscriptionModel.find({ userId: s.user.id }).sort({ platform: 1 });
    expect(saved.map((d) => d.platform)).toEqual(['android', 'ios']);
    expect(saved[0]).toMatchObject({ endpoint: `android:${TOKEN_A}`, token: TOKEN_A });
    expect(saved[0]!.keys?.p256dh).toBeUndefined();
  });

  it('still stores a browser as a web device, with or without saying so', async () => {
    const s = await registerUser();
    await subscribe(s, webDevice()).expect(201);
    await subscribe(s, { ...webDevice(), endpoint: 'https://push.example.com/send/web-2', platform: 'web' }).expect(
      201,
    );
    expect((await PushSubscriptionModel.find({ userId: s.user.id })).map((d) => d.platform)).toEqual(['web', 'web']);
  });

  it('subscribing the same app again updates it instead of adding another', async () => {
    const s = await registerUser();
    await subscribe(s, android()).expect(201);
    await subscribe(s, { ...android(), browser: 'Cook First app on Android 15' }).expect(201);
    const all = await PushSubscriptionModel.find({ userId: s.user.id });
    expect(all).toHaveLength(1);
    expect(all[0]!.browser).toBe('Cook First app on Android 15');
  });

  it('gives a phone to whoever is signed in on it: the token leaves the previous account', async () => {
    const first = await registerUser();
    const second = await registerUser();
    await subscribe(first, android()).expect(201);
    await subscribe(second, android()).expect(201);
    expect(await PushSubscriptionModel.countDocuments({ userId: first.user.id })).toBe(0);
    expect(await PushSubscriptionModel.countDocuments({ userId: second.user.id })).toBe(1);
  });

  it('rejects a bad platform, a missing, short or spaced token, and a browser without keys', async () => {
    const s = await registerUser();
    const bad: Record<string, unknown>[] = [
      { platform: 'windows', token: TOKEN_A },
      { platform: 'android' },
      { platform: 'android', token: 'short' },
      { platform: 'ios', token: `${'x'.repeat(30)} ${'y'.repeat(30)}` },
      { platform: 'android', token: 'x'.repeat(5000) },
      { endpoint: 'https://push.example.com/x' },
      {},
    ];
    for (const body of bad) {
      const res = await subscribe(s, body).expect(400);
      expect(res.body.error.message, JSON.stringify(body)).toBe('That push subscription isn’t valid.');
    }
    expect(await PushSubscriptionModel.countDocuments({})).toBe(0);
  });

  it('turns an app off by its token, and only for the signed-in user', async () => {
    const s = await registerUser();
    const other = await registerUser();
    await subscribe(s, android()).expect(201);
    await subscribe(other, ios()).expect(201);
    await unsubscribe(s, { token: TOKEN_I }).expect(204); // someone else's token: nothing happens
    expect(await PushSubscriptionModel.countDocuments({})).toBe(2);
    await unsubscribe(s, { token: TOKEN_A }).expect(204);
    expect(await PushSubscriptionModel.countDocuments({ userId: s.user.id })).toBe(0);
    expect(await PushSubscriptionModel.countDocuments({ userId: other.user.id })).toBe(1);
    await unsubscribe(s, {}).expect(400);
  });

  it('turns a browser off by its address as before', async () => {
    const s = await registerUser();
    await subscribe(s, webDevice()).expect(201);
    await unsubscribe(s, { endpoint: webDevice().endpoint }).expect(204);
    expect(await PushSubscriptionModel.countDocuments({})).toBe(0);
  });
});

describe('GET /api/push/config', () => {
  it('says whether push to the apps is set up, without exposing anything secret', async () => {
    const s = await registerUser();
    expect((await s.auth(api().get('/api/push/config')).expect(200)).body).toEqual({ publicKey: null, native: false });
    setNativePushProvider(recorder('fcm').provider);
    expect((await s.auth(api().get('/api/push/config')).expect(200)).body).toEqual({ publicKey: null, native: true });
    setPushProvider(recorder('web').provider);
    expect((await s.auth(api().get('/api/push/config')).expect(200)).body).toEqual({
      publicKey: 'PUBLIC-KEY',
      native: true,
    });
  });
});

describe('sending to every kind of device', () => {
  const payload: PushPayload = {
    title: 'Cook First: 1 item to check',
    body: 'Milk: expected expiry today',
    tag: 'item-1',
    url: '/food/1',
    actions: [
      { action: 'USED', title: 'Used' },
      { action: 'SNOOZE', title: 'Snooze' },
    ],
    actionToken: 'action-token',
  };

  async function threeDevices() {
    const s = await registerUser();
    await subscribe(s, webDevice()).expect(201);
    await subscribe(s, android()).expect(201);
    await subscribe(s, ios()).expect(201);
    return s;
  }

  async function send(s: Session) {
    const { sendToUser } = await import('../services/pushService.js');
    const { UserModel } = await import('../models/User.js');
    return sendToUser((await UserModel.findById(s.user.id))!, payload);
  }

  it('sends a browser through Web Push and the apps through Firebase, each to its own kind of device', async () => {
    const web = recorder('web');
    const fcm = recorder('fcm');
    setPushProvider(web.provider);
    setNativePushProvider(fcm.provider);
    const s = await threeDevices();
    expect(await send(s)).toBe(3);
    expect(web.sent.map((x) => x.target.platform)).toEqual(['web']);
    expect(fcm.sent.map((x) => x.target.platform).sort()).toEqual(['android', 'ios']);
    const androidTarget = fcm.sent.find((x) => x.target.platform === 'android')!.target;
    expect(androidTarget).toEqual({ platform: 'android', endpoint: `android:${TOKEN_A}`, token: TOKEN_A });
    const docs = await PushSubscriptionModel.find({ userId: s.user.id });
    expect(docs.every((d) => d.lastUsedAt !== null)).toBe(true);
  });

  it('skips a kind of device that has no provider, and still sends to the others', async () => {
    const web = recorder('web');
    setPushProvider(web.provider);
    const s = await threeDevices();
    expect(await send(s)).toBe(1);
    expect(await PushSubscriptionModel.countDocuments({ userId: s.user.id })).toBe(3); // the apps are kept for later
    setPushProvider(null);
    const fcm = recorder('fcm');
    setNativePushProvider(fcm.provider);
    expect(await send(s)).toBe(2);
  });

  it('forgets an app whose token is gone, and keeps one that failed for another reason', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fcm = recorder('fcm', (target) => (target.platform === 'android' ? 'GONE' : new Error('Firebase is down')));
    setNativePushProvider(fcm.provider);
    const s = await registerUser();
    await subscribe(s, android()).expect(201);
    await subscribe(s, ios()).expect(201);
    expect(await send(s)).toBe(0);
    expect((await PushSubscriptionModel.find({ userId: s.user.id })).map((d) => d.platform)).toEqual(['ios']);
  });

  it('delivers the daily summary to an app when it is the only push set up', async () => {
    const fcm = recorder('fcm');
    setNativePushProvider(fcm.provider);
    clock.set(new Date('2026-09-29T06:00:00Z'));
    const s = await registerUser();
    await subscribe(s, ios()).expect(201);
    // Two items in Cook First make a summary (a single one is sent as one reminder, with buttons).
    for (const [name, lifespanDays] of [
      ['Bread', 0],
      ['Milk', 1],
    ] as const) {
      await s
        .auth(
          api()
            .post('/api/foods')
            .send(food({ name, lifespanDays, addedDate: '2026-09-29' })),
        )
        .expect(201);
    }
    clock.set(new Date('2026-09-29T08:00:00Z'));
    await sweep();
    expect(fcm.sent).toHaveLength(1);
    expect(fcm.sent[0]!.target).toMatchObject({ platform: 'ios', token: TOKEN_I });
    expect(fcm.sent[0]!.payload).toMatchObject({ tag: 'digest', url: '/cook-first', actions: [] });
  });
});

describe('the Firebase provider', () => {
  const payload: PushPayload = {
    title: 'Cook First: Milk',
    body: 'Milk: expected expiry today',
    tag: 'item-1',
    url: '/food/1',
    actions: [
      { action: 'USED', title: 'Used' },
      { action: 'SNOOZE', title: 'Snooze' },
    ],
    actionToken: 'action-token',
  };
  const digest: PushPayload = {
    title: 'Cook First: 2 items',
    body: 'Bread\nMilk',
    tag: 'digest',
    url: '/cook-first',
    actions: [],
  };
  const target = (platform: 'android' | 'ios'): PushTarget => ({
    platform,
    endpoint: `${platform}:t`,
    token: 'device-token',
  });

  function fake(failWith?: unknown) {
    const messages: Record<string, unknown>[] = [];
    const messaging: FcmMessaging = {
      async send(message) {
        if (failWith) throw failWith;
        messages.push(message);
        return 'projects/x/messages/1';
      },
    };
    return { messages, messaging };
  }

  it('sends Android a data-only message, so the app can build the notification with its Used and Snooze buttons', async () => {
    const { messages, messaging } = fake();
    const provider = createFcmPushProvider(messaging, { actionUrl: 'https://api.example.com/api/push/actions' });
    expect(await provider.send(target('android'), payload)).toBe('SENT');
    const message = messages[0]! as {
      token: string;
      data: Record<string, string>;
      android: Record<string, unknown>;
      notification?: unknown;
    };
    expect(message.token).toBe('device-token');
    expect(message.notification).toBeUndefined(); // a notification message would hide the buttons
    expect(message.android).toEqual({ priority: 'high', ttl: 86_400_000 });
    expect(message.data).toEqual({
      url: '/food/1',
      tag: 'item-1',
      actionToken: 'action-token',
      title: 'Cook First: Milk',
      body: 'Milk: expected expiry today',
      actions: JSON.stringify(payload.actions),
      actionUrl: 'https://api.example.com/api/push/actions',
    });
    for (const value of Object.values(message.data)) expect(typeof value).toBe('string');
  });

  it('gives Android no action address or token for the daily summary, or when the address is not set', async () => {
    const { messages, messaging } = fake();
    await createFcmPushProvider(messaging, { actionUrl: 'https://api.example.com/api/push/actions' }).send(
      target('android'),
      digest,
    );
    await createFcmPushProvider(messaging).send(target('android'), payload);
    const [first, second] = messages as { data: Record<string, string> }[];
    expect(first!.data).not.toHaveProperty('actionToken');
    expect(first!.data).not.toHaveProperty('actionUrl');
    expect(second!.data).toHaveProperty('actionToken');
    expect(second!.data).not.toHaveProperty('actionUrl');
  });

  it('sends iPhone a notification with a category, so its buttons appear, through APNs via Firebase', async () => {
    const { messages, messaging } = fake();
    const provider = createFcmPushProvider(messaging, { apnsBundleId: 'com.example.cookfirst' });
    clock.set(new Date('2026-09-29T12:00:00Z'));
    expect(await provider.send(target('ios'), payload)).toBe('SENT');
    const message = messages[0]! as {
      notification: unknown;
      data: Record<string, string>;
      apns: { headers: Record<string, string>; payload: { aps: Record<string, unknown> } };
    };
    expect(message.notification).toEqual({ title: 'Cook First: Milk', body: 'Milk: expected expiry today' });
    expect(message.data).toEqual({ url: '/food/1', tag: 'item-1', actionToken: 'action-token' });
    expect(message.apns.payload.aps).toEqual({
      sound: 'default',
      'thread-id': 'item-1',
      category: IOS_ACTION_CATEGORY,
    });
    expect(message.apns.headers).toEqual({
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(new Date('2026-09-30T12:00:00Z').getTime() / 1000)),
      'apns-topic': 'com.example.cookfirst',
    });
  });

  it('gives iPhone no buttons for the daily summary, and no APNs topic when none is set', async () => {
    const { messages, messaging } = fake();
    await createFcmPushProvider(messaging).send(target('ios'), digest);
    const message = messages[0]! as {
      apns: { headers: Record<string, string>; payload: { aps: Record<string, unknown> } };
      data: object;
    };
    expect(message.apns.payload.aps).not.toHaveProperty('category');
    expect(message.apns.headers).not.toHaveProperty('apns-topic');
    expect(message.data).not.toHaveProperty('actionToken');
  });

  it('reports a token that is no longer registered as gone, and throws any other failure', async () => {
    for (const error of [
      Object.assign(new Error('x'), { code: 'messaging/registration-token-not-registered' }),
      Object.assign(new Error('x'), { errorInfo: { code: 'messaging/invalid-registration-token' } }),
    ]) {
      expect(await createFcmPushProvider(fake(error).messaging).send(target('android'), digest)).toBe('GONE');
    }
    const other = Object.assign(new Error('quota'), { code: 'messaging/quota-exceeded' });
    await expect(createFcmPushProvider(fake(other).messaging).send(target('ios'), digest)).rejects.toThrow('quota');
    await expect(createFcmPushProvider(fake(new Error('plain')).messaging).send(target('ios'), digest)).rejects.toThrow(
      'plain',
    );
  });

  it('never sends to a browser', async () => {
    const { messaging } = fake();
    await expect(
      createFcmPushProvider(messaging).send(
        { platform: 'web', endpoint: 'https://x.example/', keys: { p256dh: 'k', auth: 'a' } },
        digest,
      ),
    ).rejects.toThrow();
  });
});

describe('CORS for the apps', () => {
  const preflight = (origin: string) =>
    api()
      .options('/api/auth/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization');

  it('allows the Capacitor app origins, the web app, and nobody else', async () => {
    expect([...NATIVE_APP_ORIGINS]).toEqual(['capacitor://localhost', 'https://localhost']);
    for (const origin of [...NATIVE_APP_ORIGINS, 'http://localhost:5173']) {
      const res = await preflight(origin).expect(204);
      expect(res.headers['access-control-allow-origin'], origin).toBe(origin);
    }
    for (const origin of [
      'https://evil.example',
      'http://localhost',
      'capacitor://evil',
      'https://localhost.evil.example',
    ]) {
      const res = await preflight(origin);
      expect(res.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
  });

  it('lets an app actually sign up and call the API from its origin', async () => {
    const res = await api()
      .post('/api/auth/register')
      .set('Origin', 'capacitor://localhost')
      .send({ name: 'Native User', email: 'native@example.com', password: 'correct horse battery', timeZone: 'UTC' })
      .expect(201);
    expect(res.headers['access-control-allow-origin']).toBe('capacitor://localhost');
  });
});

describe('configuration', () => {
  it('lists the Firebase and APNs settings in .env.example, all empty', () => {
    const text = readFileSync(path.resolve('.env.example'), 'utf8');
    for (const key of [
      'FIREBASE_PROJECT_ID',
      'FIREBASE_CLIENT_EMAIL',
      'FIREBASE_PRIVATE_KEY',
      'APNS_KEY_ID',
      'APNS_TEAM_ID',
      'APNS_BUNDLE_ID',
      'PUBLIC_API_URL',
    ]) {
      expect(text, key).toMatch(new RegExp(`^${key}=$`, 'm'));
    }
  });

  describe('reading the Firebase service account from the environment', () => {
    const KEYS = [
      'FIREBASE_PROJECT_ID',
      'FIREBASE_CLIENT_EMAIL',
      'FIREBASE_PRIVATE_KEY',
      'APNS_BUNDLE_ID',
      'PUBLIC_API_URL',
    ] as const;
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
      for (const key of KEYS) saved[key] = process.env[key];
      vi.resetModules();
    });
    afterEach(() => {
      for (const key of KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      vi.resetModules();
    });

    it('is off unless all three values are set', async () => {
      for (const key of KEYS) delete process.env[key];
      expect((await import('../config/env.js')).env.fcm).toBeNull();
      process.env.FIREBASE_PROJECT_ID = 'p';
      process.env.FIREBASE_CLIENT_EMAIL = 'x@p.iam.gserviceaccount.com';
      vi.resetModules();
      expect((await import('../config/env.js')).env.fcm).toBeNull();
    });

    it('turns the "\\n" in a pasted private key back into line breaks, and trims the public API address', async () => {
      process.env.FIREBASE_PROJECT_ID = 'p';
      process.env.FIREBASE_CLIENT_EMAIL = 'x@p.iam.gserviceaccount.com';
      process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n';
      process.env.APNS_BUNDLE_ID = 'com.example.cookfirst';
      process.env.PUBLIC_API_URL = 'https://api.example.com/api/';
      const { env } = await import('../config/env.js');
      expect(env.fcm).toEqual({
        projectId: 'p',
        clientEmail: 'x@p.iam.gserviceaccount.com',
        privateKey: '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n',
      });
      expect(env.apnsBundleId).toBe('com.example.cookfirst');
      expect(env.publicApiUrl).toBe('https://api.example.com/api');
    });
  });
});
