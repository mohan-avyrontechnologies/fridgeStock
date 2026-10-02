import type { PushPayload } from '@cook-first/shared';
import webpush from 'web-push';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FoodItemModel } from '../models/FoodItem.js';
import { NotificationModel } from '../models/Notification.js';
import { PushSubscriptionModel } from '../models/PushSubscription.js';
import { UsageRecordModel } from '../models/UsageRecord.js';
import { PUSH_ACTION_RATE_LIMIT } from '../routes/index.js';
import { clock } from '../services/clock.js';
import { sweep } from '../services/notificationService.js';
import { createWebPushProvider, setPushProvider, type PushProvider } from '../services/pushProvider.js';
import { signActionToken, signToken } from '../services/token.js';
import { api, food, registerUser } from './helpers.js';

/** Phase 3: better reminders (Web Push, daily digest, Used and Snooze buttons). */

type Outcome = 'SENT' | 'GONE' | Error;

/** Swaps in a push provider that records what it was asked to send. */
function fakePush(outcome: (endpoint: string) => Outcome = () => 'SENT') {
  const sent: { endpoint: string; payload: PushPayload }[] = [];
  const provider: PushProvider = {
    name: 'fake',
    publicKey: 'PUBLIC-KEY',
    async send(target, payload) {
      const result = outcome(target.endpoint);
      if (result instanceof Error) throw result;
      if (result === 'SENT') sent.push({ endpoint: target.endpoint, payload });
      return result;
    },
  };
  setPushProvider(provider);
  return sent;
}

afterEach(() => {
  setPushProvider(null);
  vi.restoreAllMocks();
});

const device = (n = 1) => ({
  endpoint: `https://push.example.com/send/device-${n}`,
  keys: { p256dh: `p256dh-key-${n}`, auth: `auth-secret-${n}` },
  browser: 'Chrome on Android',
});

/** Pins "now" to a UTC instant, e.g. at('2026-09-29', 8) is 08:00 UTC. */
const at = (date: string, hour: number, minute = 0) =>
  clock.set(new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`));

type Session = Awaited<ReturnType<typeof registerUser>>;

async function add(s: Session, name: string, lifespanDays: number, addedDate = '2026-09-29') {
  return (await s.auth(api().post('/api/foods').send(food({ name, lifespanDays, addedDate }))).expect(201)).body;
}

async function withDevice(overrides: Record<string, unknown> = {}, n = 1) {
  const s = await registerUser(overrides);
  await s.auth(api().post('/api/push/subscriptions').send(device(n))).expect(201);
  return s;
}

describe('push configuration', () => {
  it('reports no public key when push isn’t set up, and reminders stay in-app', async () => {
    const s = await registerUser();
    const res = await s.auth(api().get('/api/push/config')).expect(200);
    expect(res.body).toEqual({ publicKey: null, native: false });
  });

  it('exposes only the VAPID public key, never the private key', async () => {
    setPushProvider(
      createWebPushProvider({ publicKey: 'PUBLIC-KEY', privateKey: 'PRIVATE-KEY', subject: 'mailto:a@example.com' }),
    );
    const s = await registerUser();
    const res = await s.auth(api().get('/api/push/config')).expect(200);
    expect(res.body).toEqual({ publicKey: 'PUBLIC-KEY', native: false });
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE');
  });

  it('needs a login', async () => {
    await api().get('/api/push/config').expect(401);
    await api().post('/api/push/subscriptions').send(device()).expect(401);
  });
});

describe('push subscriptions', () => {
  it('stores the user, endpoint, keys, browser and last use, and returns no secrets', async () => {
    const s = await registerUser();
    const res = await s.auth(api().post('/api/push/subscriptions').send(device())).expect(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      platform: 'web',
      browser: 'Chrome on Android',
      createdAt: expect.any(String),
      lastUsedAt: null,
    });
    const saved = await PushSubscriptionModel.findOne({ userId: s.user.id });
    expect(saved).toMatchObject({
      platform: 'web',
      endpoint: device().endpoint,
      keys: device().keys,
      browser: 'Chrome on Android',
    });
  });

  it('subscribing the same browser again updates it instead of adding another', async () => {
    const s = await registerUser();
    await s.auth(api().post('/api/push/subscriptions').send(device())).expect(201);
    const renewed = { ...device(), keys: { p256dh: 'new-key', auth: 'new-auth' } };
    await s.auth(api().post('/api/push/subscriptions').send(renewed)).expect(201);
    const all = await PushSubscriptionModel.find({ userId: s.user.id });
    expect(all).toHaveLength(1);
    expect(all[0]!.keys!.p256dh).toBe('new-key');
  });

  it('rejects anything that isn’t an https push endpoint with both keys', async () => {
    const s = await registerUser();
    for (const body of [
      { ...device(), endpoint: 'http://push.example.com/x' },
      { ...device(), endpoint: 'not a url' },
      { endpoint: device().endpoint },
      { ...device(), keys: { p256dh: '', auth: 'x' } },
    ]) {
      const res = await s.auth(api().post('/api/push/subscriptions').send(body)).expect(400);
      expect(res.body.error.message).toBe('That push subscription isn’t valid.');
    }
  });

  it('unsubscribing removes only your own subscription', async () => {
    const alice = await withDevice();
    const bob = await registerUser();
    await bob.auth(api().delete('/api/push/subscriptions').send({ endpoint: device().endpoint })).expect(204);
    expect(await PushSubscriptionModel.countDocuments({ userId: alice.user.id })).toBe(1);
    await alice.auth(api().delete('/api/push/subscriptions').send({ endpoint: device().endpoint })).expect(204);
    expect(await PushSubscriptionModel.countDocuments({ userId: alice.user.id })).toBe(0);
  });
});

describe('reminder delivery settings', () => {
  it('default to a daily summary at 8:00, shown on the user', async () => {
    const s = await registerUser();
    expect(s.user.reminderDelivery).toEqual({ mode: 'DIGEST', hour: 8 });
    const res = await s.auth(api().get('/api/notifications/delivery')).expect(200);
    expect(res.body).toEqual({ mode: 'DIGEST', hour: 8 });
  });

  it('can switch to one per item and change the hour', async () => {
    const s = await registerUser();
    const res = await s
      .auth(api().put('/api/notifications/delivery').send({ mode: 'EACH_ITEM', hour: 18 }))
      .expect(200);
    expect(res.body).toEqual({ mode: 'EACH_ITEM', hour: 18 });
    const me = await s.auth(api().get('/api/auth/me')).expect(200);
    expect(me.body.user.reminderDelivery).toEqual({ mode: 'EACH_ITEM', hour: 18 });
  });

  it('rejects an unknown mode or an hour outside 0–23', async () => {
    const s = await registerUser();
    const bad = [
      [{ mode: 'HOURLY' }, 'mode', 'Choose a daily summary or one reminder per item.'],
      [{ hour: 24 }, 'hour', 'Choose an hour from 0 to 23.'],
      [{ hour: 7.5 }, 'hour', 'Choose an hour from 0 to 23.'],
    ] as const;
    for (const [body, field, message] of bad) {
      const res = await s.auth(api().put('/api/notifications/delivery').send(body)).expect(400);
      expect(res.body.error).toMatchObject({ field, message });
    }
  });
});

describe('daily digest', () => {
  async function kitchen() {
    at('2026-09-29', 6);
    const s = await withDevice();
    const eggs = await add(s, 'Eggs', 10);
    const bread = await add(s, 'Bread', 0);
    const chicken = await add(s, 'Chicken', 1);
    return { s, eggs, bread, chicken };
  }

  it('sends nothing before the chosen hour, then one summary of the Cook First list in its order', async () => {
    const sent = fakePush();
    await kitchen();
    at('2026-09-29', 7, 59);
    await sweep();
    expect(sent).toEqual([]);

    at('2026-09-29', 8);
    await sweep();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toEqual({
      title: 'Cook First: 2 items to check',
      body: 'Bread: expected expiry today\nChicken: expected expiry in 1 day',
      tag: 'digest',
      url: '/cook-first',
      actions: [],
    });
  });

  it('goes out once a day, and again the next day', async () => {
    const sent = fakePush();
    await kitchen();
    at('2026-09-29', 8);
    await sweep();
    at('2026-09-29', 15);
    await sweep();
    expect(sent).toHaveLength(1);
    at('2026-09-30', 8);
    await sweep();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.payload.body).toBe('Bread: past its expected expiry\nChicken: expected expiry today');
  });

  it('with a single item, opens that item and has Used and Snooze buttons', async () => {
    const sent = fakePush();
    at('2026-09-29', 6);
    const s = await withDevice();
    const chicken = await add(s, 'Chicken', 1);
    at('2026-09-29', 8);
    await sweep();
    expect(sent[0]!.payload).toMatchObject({
      title: 'Cook First: 1 item to check',
      body: 'Chicken: expected expiry in 1 day',
      url: `/food/${chicken.id}`,
      actions: [
        { action: 'USED', title: 'Used' },
        { action: 'SNOOZE', title: 'Snooze' },
      ],
      actionToken: expect.any(String),
    });
  });

  it('names the first four and counts the rest', async () => {
    const sent = fakePush();
    at('2026-09-29', 6);
    const s = await withDevice();
    for (const [name, days] of [
      ['A', 3],
      ['B', 2],
      ['C', 1],
      ['D', 0],
      ['E', 2],
      ['F', 3],
    ] as const) {
      await add(s, name, days);
    }
    at('2026-09-29', 8);
    await sweep();
    expect(sent[0]!.payload.title).toBe('Cook First: 6 items to check');
    expect(sent[0]!.payload.body.split('\n')).toEqual([
      'D: expected expiry today',
      'C: expected expiry in 1 day',
      'B: expected expiry in 2 days',
      'E: expected expiry in 2 days',
      'and 2 more',
    ]);
  });

  it('sends nothing when nothing needs attention', async () => {
    const sent = fakePush();
    at('2026-09-29', 6);
    const s = await withDevice();
    await add(s, 'Rice', 30);
    at('2026-09-29', 8);
    await sweep();
    expect(sent).toEqual([]);
  });

  it('uses the user’s own time zone for the hour', async () => {
    const sent = fakePush();
    at('2026-09-29', 1);
    const s = await withDevice({ timeZone: 'Asia/Kolkata' });
    await add(s, 'Chicken', 1);
    at('2026-09-29', 2, 29); // 07:59 in Kolkata
    await sweep();
    expect(sent).toEqual([]);
    at('2026-09-29', 2, 30); // 08:00 in Kolkata
    await sweep();
    expect(sent).toHaveLength(1);
  });

  it('never changes the Cook First order', async () => {
    fakePush();
    const { s } = await kitchen();
    const before = (await s.auth(api().get('/api/foods/cook-first'))).body.items.map((i: { name: string }) => i.name);
    at('2026-09-29', 8);
    await sweep();
    const after = (await s.auth(api().get('/api/foods/cook-first'))).body.items.map((i: { name: string }) => i.name);
    expect(after).toEqual(before);
    expect(after).toEqual(['Bread', 'Chicken']);
  });
});

describe('one push per item', () => {
  it('pushes each reminder delivered today once, with its buttons and a link to Food Details', async () => {
    const sent = fakePush();
    at('2026-09-29', 6);
    const s = await withDevice();
    await s.auth(api().put('/api/notifications/delivery').send({ mode: 'EACH_ITEM' })).expect(200);
    const bread = await add(s, 'Bread', 0);
    const chicken = await add(s, 'Chicken', 1);
    await add(s, 'Eggs', 10);

    at('2026-09-29', 8);
    await sweep();
    await sweep();
    expect(sent.map((p) => p.payload.body).sort()).toEqual([
      'Bread: expected expiry is today.',
      'Chicken: expected expiry in 1 day. Consider using it soon.',
    ]);
    const breadPush = sent.find((p) => p.payload.url === `/food/${bread.id}`)!.payload;
    expect(breadPush).toMatchObject({ title: 'Cook First', tag: `food-${bread.id}`, actionToken: expect.any(String) });
    expect(breadPush.actions.map((a) => a.action)).toEqual(['USED', 'SNOOZE']);
    expect(sent.some((p) => p.payload.url === `/food/${chicken.id}`)).toBe(true);
  });

  it('reaches every browser the user has turned on', async () => {
    const sent = fakePush();
    at('2026-09-29', 6);
    const s = await withDevice();
    await s.auth(api().post('/api/push/subscriptions').send(device(2))).expect(201);
    await add(s, 'Chicken', 1);
    at('2026-09-29', 8);
    await sweep();
    expect(sent.map((p) => p.endpoint).sort()).toEqual([device(1).endpoint, device(2).endpoint]);
  });
});

describe('when push fails', () => {
  it('deletes a subscription the push service reports as gone (404 or 410)', async () => {
    fakePush((endpoint) => (endpoint.endsWith('device-1') ? 'GONE' : 'SENT'));
    at('2026-09-29', 6);
    const s = await withDevice();
    await s.auth(api().post('/api/push/subscriptions').send(device(2))).expect(201);
    await add(s, 'Chicken', 1);
    at('2026-09-29', 8);
    await sweep();
    const left = await PushSubscriptionModel.find({ userId: s.user.id });
    expect(left.map((d) => d.endpoint)).toEqual([device(2).endpoint]);
    expect(left[0]!.lastUsedAt).toEqual(new Date('2026-09-29T08:00:00Z'));
  });

  it('keeps the subscription on other errors, and in-app reminders still arrive', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fakePush(() => new Error('push service unavailable'));
    at('2026-09-29', 6);
    const s = await withDevice();
    await add(s, 'Chicken', 1);
    at('2026-09-29', 8);
    await sweep();
    expect(await PushSubscriptionModel.countDocuments({ userId: s.user.id })).toBe(1);
    const feed = await s.auth(api().get('/api/notifications')).expect(200);
    expect(feed.body.items.map((n: { message: string }) => n.message)).toEqual([
      'Chicken: expected expiry in 1 day. Consider using it soon.',
    ]);
  });

  it('a crash while pushing to one user doesn’t stop in-app reminders for others', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    at('2026-09-29', 6);
    const alice = await withDevice();
    await add(alice, 'Chicken', 1);
    const bob = await registerUser();
    await add(bob, 'Fish', 1);
    setPushProvider({
      name: 'broken',
      publicKey: 'x',
      send: () => {
        throw new Error('boom');
      },
    });
    at('2026-09-29', 8);
    await sweep();
    expect(await NotificationModel.countDocuments({ userId: bob.user.id, status: 'SENT' })).toBe(1);
    expect(await NotificationModel.countDocuments({ userId: alice.user.id, status: 'SENT' })).toBe(1);
  });
});

describe('notification buttons', () => {
  async function chickenFor(s: Session) {
    at('2026-09-29', 6);
    return add(s, 'Chicken', 1);
  }

  it('"Used" closes the item as used and records it, like in the app', async () => {
    const s = await registerUser();
    const chicken = await chickenFor(s);
    const token = signActionToken(s.user.id, chicken.id);
    await api().post('/api/push/actions').send({ token, action: 'USED' }).expect(204);
    const saved = await FoodItemModel.findById(chicken.id);
    expect(saved!.status).toBe('USED');
    expect(await UsageRecordModel.countDocuments({ userId: s.user.id, action: 'USED' })).toBe(1);
    // A second tap finds it already closed; the service worker then opens Food Details.
    const again = await api().post('/api/push/actions').send({ token, action: 'USED' }).expect(409);
    expect(again.body.error.message).toBe('This item is no longer active.');
  });

  it('"Snooze" leaves the item out of today’s summary and brings it back tomorrow', async () => {
    const sent = fakePush();
    at('2026-09-29', 6);
    const s = await withDevice();
    const chicken = await add(s, 'Chicken', 1);
    await add(s, 'Bread', 0);
    await api()
      .post('/api/push/actions')
      .send({ token: signActionToken(s.user.id, chicken.id), action: 'SNOOZE' })
      .expect(204);
    expect((await FoodItemModel.findById(chicken.id))!.snoozedUntil).toBe('2026-09-30');

    at('2026-09-29', 8);
    await sweep();
    expect(sent[0]!.payload.body).toBe('Bread: expected expiry today');

    at('2026-09-30', 8);
    await sweep();
    expect(sent[1]!.payload.body).toBe('Bread: past its expected expiry\nChicken: expected expiry today');
    expect((await FoodItemModel.findById(chicken.id))!.snoozedUntil).toBeNull();
    // Snoozing never hides it from the app.
    const cookFirst = await s.auth(api().get('/api/foods/cook-first'));
    expect(cookFirst.body.items.map((i: { name: string }) => i.name)).toContain('Chicken');
  });

  it('"Snooze" in one-per-item mode reminds about it again the next day', async () => {
    const sent = fakePush();
    at('2026-09-29', 6);
    const s = await withDevice();
    await s.auth(api().put('/api/notifications/delivery').send({ mode: 'EACH_ITEM' })).expect(200);
    const chicken = await add(s, 'Chicken', 2);
    at('2026-09-29', 8);
    await sweep(); // two days left: one "Consider using it soon" push
    expect(sent).toHaveLength(1);
    await api()
      .post('/api/push/actions')
      .send({ token: signActionToken(s.user.id, chicken.id), action: 'SNOOZE' })
      .expect(204);

    at('2026-09-30', 8);
    await sweep();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.payload.body).toBe('Chicken: expected expiry in 1 day. Consider using it soon.');
    at('2026-09-30', 12);
    await sweep();
    expect(sent).toHaveLength(2);
  });

  it('rejects a bad token, and an action token can’t be used to sign in', async () => {
    const s = await registerUser();
    const chicken = await chickenFor(s);
    await api().post('/api/push/actions').send({ token: 'nonsense', action: 'USED' }).expect(401);
    await api()
      .post('/api/push/actions')
      .send({ token: signToken(s.user.id), action: 'USED' })
      .expect(401);
    const actionToken = signActionToken(s.user.id, chicken.id);
    await api().get('/api/foods').set('Authorization', `Bearer ${actionToken}`).expect(401);
    const res = await api()
      .post('/api/push/actions')
      .send({ token: signActionToken(s.user.id, chicken.id), action: 'EAT' })
      .expect(400);
    expect(res.body.error.message).toBe('Unknown notification action.');
  });

  it('an action token only ever touches its own user’s item', async () => {
    const alice = await registerUser();
    const chicken = await chickenFor(alice);
    const mallory = await registerUser();
    await api()
      .post('/api/push/actions')
      .send({ token: signActionToken(mallory.user.id, chicken.id), action: 'USED' })
      .expect(404);
    expect((await FoodItemModel.findById(chicken.id))!.status).toBe('ACTIVE');
  });

  it('are rate-limited to 60 requests per 15 minutes per IP', () => {
    expect(PUSH_ACTION_RATE_LIMIT).toEqual({ windowMs: 15 * 60 * 1000, limit: 60 });
  });
});

describe('Web Push provider', () => {
  const vapid = { publicKey: 'PUB', privateKey: 'PRIV', subject: 'mailto:a@example.com' };
  const target = { platform: 'web' as const, endpoint: 'https://push.example.com/x', keys: { p256dh: 'k', auth: 'a' } };
  const payload: PushPayload = { title: 't', body: 'b', tag: 'x', url: '/', actions: [] };

  it('sends the JSON payload with the VAPID keys', async () => {
    const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    expect(await createWebPushProvider(vapid).send(target, payload)).toBe('SENT');
    expect(send).toHaveBeenCalledWith(
      { endpoint: target.endpoint, keys: target.keys },
      JSON.stringify(payload),
      expect.objectContaining({ vapidDetails: vapid, TTL: 86400 }),
    );
  });

  it('treats 404 and 410 as a subscription that is gone, and throws anything else', async () => {
    const fail = (statusCode: number) =>
      vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(Object.assign(new Error('x'), { statusCode }));
    const provider = createWebPushProvider(vapid);
    fail(410);
    expect(await provider.send(target, payload)).toBe('GONE');
    fail(404);
    expect(await provider.send(target, payload)).toBe('GONE');
    fail(500);
    await expect(provider.send(target, payload)).rejects.toThrow('x');
  });
});
