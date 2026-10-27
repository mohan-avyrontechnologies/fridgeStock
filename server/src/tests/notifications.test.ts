import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationModel } from '../models/Notification.js';
import { UserModel as UserModelForTests } from '../models/User.js';
import * as notificationService from '../services/notificationService.js';
import { deliveryChannel, scheduledDateFor, sweep } from '../services/notificationService.js';
import { api, food, registerUser, setToday } from './helpers.js';

let s: Awaited<ReturnType<typeof registerUser>>;

beforeEach(async () => {
  setToday('2026-09-29');
  s = await registerUser();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const add = (overrides: Record<string, unknown> = {}) =>
  s
    .auth(api().post('/api/foods').send(food(overrides)))
    .expect(201)
    .then((r) => r.body);

const scheduled = async (foodId: string) =>
  (await NotificationModel.find({ foodId }).sort({ scheduledDate: 1 })).map((n) => ({
    type: n.type,
    date: n.scheduledDate,
    status: n.status,
  }));

const feed = async () => (await s.auth(api().get('/api/notifications')).expect(200)).body;

describe('scheduling rules', () => {
  const today = '2026-09-29';
  it.each([
    // [type, expiry, expected scheduled date or null]
    ['APPROACHING_EXPIRY', '2026-10-09', '2026-10-06'], // 3 days before
    ['APPROACHING_EXPIRY', '2026-10-01', '2026-09-29'], // 3 days before has passed → today
    ['APPROACHING_EXPIRY', '2026-09-30', '2026-09-29'], // today is still before expiry
    ['APPROACHING_EXPIRY', '2026-09-29', null], // today is not before expiry
    ['APPROACHING_EXPIRY', '2026-09-20', null],
    ['DUE', '2026-10-09', '2026-10-09'],
    ['DUE', '2026-09-29', '2026-09-29'], // expiry today still gets a due reminder
    ['DUE', '2026-09-28', null], // expiry in the past: no due reminder
    ['OVERDUE', '2026-10-09', '2026-10-10'], // day after expiry
    ['OVERDUE', '2026-09-28', '2026-09-29'], // that day is today
    ['OVERDUE', '2026-09-20', '2026-09-29'], // that day has passed → today
  ] as const)('%s for expiry %s → %s', (type, expiry, expected) => {
    expect(scheduledDateFor(type, expiry, today)).toBe(expected);
  });

  it('a zero-day lifespan gets a due reminder today and an overdue one tomorrow, but no approaching one', async () => {
    const { id } = await add({ lifespanDays: 0 });
    expect(await scheduled(id)).toEqual([
      { type: 'DUE', date: '2026-09-29', status: 'PENDING' },
      { type: 'OVERDUE', date: '2026-09-30', status: 'PENDING' },
    ]);
  });
});

describe('scheduling', () => {
  it('schedules approaching, due and overdue reminders from the expected expiry', async () => {
    const { id } = await add({ lifespanDays: 10 }); // expected expiry 2026-10-09
    expect(await scheduled(id)).toEqual([
      { type: 'APPROACHING_EXPIRY', date: '2026-10-06', status: 'PENDING' },
      { type: 'DUE', date: '2026-10-09', status: 'PENDING' },
      { type: 'OVERDUE', date: '2026-10-10', status: 'PENDING' },
    ]);
  });

  it('skips stages the item has already moved past', async () => {
    const soon = await add({ lifespanDays: 2 });
    expect((await scheduled(soon.id))[0]).toEqual({
      type: 'APPROACHING_EXPIRY',
      date: '2026-09-29',
      status: 'PENDING',
    });

    const overdue = await add({ addedDate: '2026-09-20', lifespanDays: 2 });
    expect(await scheduled(overdue.id)).toEqual([{ type: 'OVERDUE', date: '2026-09-29', status: 'PENDING' }]);
  });

  it('reschedules when the lifespan is edited', async () => {
    const { id } = await add({ lifespanDays: 10 });
    await s.auth(api().put(`/api/foods/${id}`).send({ lifespanDays: 5 })).expect(200);
    expect((await scheduled(id)).map((n) => n.date)).toEqual(['2026-10-01', '2026-10-04', '2026-10-05']);
  });

  it('cancels pending reminders when an item is used', async () => {
    const { id } = await add({ lifespanDays: 10 });
    await s.auth(api().post(`/api/foods/${id}/use`).send({})).expect(200);
    expect(await scheduled(id)).toEqual([]);
  });
});

describe('delivery', () => {
  it('delivers reminders into the in-app feed as their day arrives', async () => {
    await add({ name: 'Spinach', lifespanDays: 2 }); // expected expiry 10-01
    let body = await feed();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ type: 'APPROACHING_EXPIRY', status: 'SENT', readAt: null });
    expect(body.items[0].message).toBe('Spinach: expected expiry in 2 days. Consider using it soon.');
    expect(body.unread).toBe(1);

    setToday('2026-10-01');
    body = await feed();
    expect(body.items[0]).toMatchObject({ type: 'DUE' });
    expect(body.items[0].message).toBe('Spinach: expected expiry is today.');

    setToday('2026-10-02');
    body = await feed();
    expect(body.items[0].type).toBe('OVERDUE');
    expect(body.items[0].message).toBe('Spinach is past its expected expiry. Check it before using.');
    expect(body.items).toHaveLength(3);
  });

  it('does not deliver the same reminder twice', async () => {
    await add({ lifespanDays: 2 });
    await feed();
    await feed();
    expect((await feed()).items).toHaveLength(1);
  });

  it('POST /notifications/read-all marks every reminder as read', async () => {
    await add({ lifespanDays: 1 });
    await add({ lifespanDays: 0 });
    const body = await feed();
    expect(body.unread).toBe(2);
    expect(body.items.every((n: { readAt: string | null }) => n.readAt === null)).toBe(true);
    await s.auth(api().post('/api/notifications/read-all')).expect(204);
    const after = await feed();
    expect(after.unread).toBe(0);
    expect(after.items.every((n: { readAt: string | null }) => n.readAt !== null)).toBe(true);
    expect((await s.auth(api().get('/api/notifications/unread-count'))).body.unread).toBe(0);
  });

  it('GET /notifications is paginated: pages of up to 50, newest first, with a total', async () => {
    const { id } = await add({ lifespanDays: 1 });
    const food = await NotificationModel.findOne({ foodId: id });
    const base = {
      userId: food!.userId,
      foodId: food!.foodId,
      type: 'DUE',
      status: 'SENT',
      sentAt: new Date(0),
      attempts: 1,
    };
    await NotificationModel.insertMany(
      Array.from({ length: 60 }, (_, i) => ({
        ...base,
        expiryDate: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`,
        scheduledDate: '2025-01-01',
        type: (['DUE', 'OVERDUE', 'APPROACHING_EXPIRY'] as const)[Math.floor(i / 28)],
      })),
    );
    const first = await feed();
    expect(first.items).toHaveLength(50);
    expect(first.total).toBe(61);
    const second = (await s.auth(api().get('/api/notifications?offset=50')).expect(200)).body;
    expect(second.items).toHaveLength(11);
    const ids = new Set([...first.items, ...second.items].map((n: { id: string }) => n.id));
    expect(ids.size).toBe(61);
    await s.auth(api().get('/api/notifications?limit=51')).expect(400);
  });

  it('the background sweep delivers without the user opening the app', async () => {
    await add({ lifespanDays: 1 });
    await sweep();
    expect(await NotificationModel.countDocuments({ status: 'SENT' })).toBe(1);
  });
});

describe('dispatchDue', () => {
  it('runs at the start of GET /foods', async () => {
    const { id } = await add({ lifespanDays: 1 });
    await s.auth(api().get('/api/foods')).expect(200);
    expect(await NotificationModel.findOne({ foodId: id, type: 'APPROACHING_EXPIRY' })).toMatchObject({
      status: 'SENT',
    });
  });

  it('a reminder failure never affects the inventory or FridgeStock', async () => {
    await add({ name: 'Chicken', lifespanDays: 1 });
    vi.spyOn(notificationService, 'dispatchDue').mockRejectedValue(new Error('reminders down'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const list = await s.auth(api().get('/api/foods')).expect(200);
    expect(logged).toHaveBeenCalledWith('Reminder dispatch failed', expect.any(Error));
    expect(list.body.items.map((i: { name: string }) => i.name)).toEqual(['Chicken']);
    const cf = await s.auth(api().get('/api/foods/fridgestock')).expect(200);
    expect(cf.body.items).toHaveLength(1);
  });

  it('does not send reminders for a type the user has since turned off', async () => {
    const { id } = await add({ lifespanDays: 1 });
    await UserModelForTests.updateOne(
      { _id: s.user.id },
      { $set: { 'notificationPreferences.approachingExpiry': false } },
    );
    await feed();
    expect(await NotificationModel.countDocuments({ foodId: id, status: 'SENT' })).toBe(0);
  });

  it('works out {n} at the moment of sending, not when scheduled', async () => {
    await add({ name: 'Kale', lifespanDays: 10 }); // approaching scheduled for 10-06
    setToday('2026-10-07');
    const body = await feed();
    expect(body.items[0].message).toBe('Kale: expected expiry in 2 days. Consider using it soon.');
  });
});

describe('preferences', () => {
  it('a disabled preference suppresses that reminder type', async () => {
    const res = await s
      .auth(api().put('/api/notifications/preferences').send({ approachingExpiry: false }))
      .expect(200);
    expect(res.body).toEqual({ approachingExpiry: false, due: true, overdue: true });

    const { id } = await add({ lifespanDays: 10 });
    expect((await scheduled(id)).map((n) => n.type)).toEqual(['DUE', 'OVERDUE']);
  });

  it('disabling a preference cancels reminders already scheduled', async () => {
    const { id } = await add({ lifespanDays: 10 });
    await s.auth(api().put('/api/notifications/preferences').send({ due: false, overdue: false })).expect(200);
    expect((await scheduled(id)).map((n) => n.type)).toEqual(['APPROACHING_EXPIRY']);
  });

  it('rejects unknown or non-boolean preference fields', async () => {
    await s.auth(api().put('/api/notifications/preferences').send({ due: 'yes' })).expect(400);
    await s.auth(api().put('/api/notifications/preferences').send({ sms: true })).expect(400);
  });
});

describe('delivery failure', () => {
  it('persists FAILED with a bounded retry and never breaks inventory views', async () => {
    vi.spyOn(deliveryChannel, 'deliver').mockRejectedValue(new Error('channel down'));
    const { id } = await add({ lifespanDays: 1 });

    for (let i = 0; i < 5; i++) await feed();
    const failed = await NotificationModel.findOne({ foodId: id, type: 'APPROACHING_EXPIRY' });
    expect(failed).toMatchObject({ status: 'FAILED', attempts: 3, lastError: 'channel down' });

    const list = await s.auth(api().get('/api/foods')).expect(200);
    expect(list.body.items).toHaveLength(1);
    await s.auth(api().get('/api/foods/fridgestock')).expect(200);
  });

  it('a failed reminder shows in the feed as FAILED, then is retried and delivered once the channel recovers', async () => {
    const spy = vi.spyOn(deliveryChannel, 'deliver').mockRejectedValueOnce(new Error('blip'));
    await add({ lifespanDays: 1 });
    const first = await feed();
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ status: 'FAILED', sentAt: null });
    const second = await feed();
    expect(second.items[0].status).toBe('SENT');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
