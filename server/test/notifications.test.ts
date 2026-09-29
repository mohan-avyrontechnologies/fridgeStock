import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationModel } from '../src/models/Notification.js';
import { UserModel } from '../src/models/User.js';
import { deliveryChannel, sweep } from '../src/services/notificationService.js';
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
  s.auth(api().post('/api/foods').send(food(overrides))).expect(201).then((r) => r.body);

const scheduled = async (foodId: string) =>
  (await NotificationModel.find({ foodId }).sort({ scheduledDate: 1 })).map((n) => ({
    type: n.type,
    date: n.scheduledDate.toISOString().slice(0, 10),
    status: n.status,
  }));

const feed = async () => (await s.auth(api().get('/api/notifications')).expect(200)).body;

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
    expect((await scheduled(soon.id))[0]).toEqual({ type: 'APPROACHING_EXPIRY', date: '2026-09-29', status: 'PENDING' });

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
    await s.auth(api().post(`/api/foods/${id}/use`).send({ action: 'USED' })).expect(200);
    expect(await scheduled(id)).toEqual([]);
  });
});

describe('delivery', () => {
  it('delivers reminders into the in-app feed as their day arrives', async () => {
    await add({ name: 'Spinach', lifespanDays: 2 }); // expected expiry 10-01
    let body = await feed();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ type: 'APPROACHING_EXPIRY', status: 'SENT', readAt: null });
    expect(body.items[0].message).toContain('Spinach: expected expiry in 2 days');
    expect(body.unread).toBe(1);

    setToday('2026-10-01');
    body = await feed();
    expect(body.items[0]).toMatchObject({ type: 'DUE' });
    expect(body.items[0].message).toBe('Spinach: expected expiry is today. A good one to cook first.');

    setToday('2026-10-02');
    body = await feed();
    expect(body.items[0].type).toBe('OVERDUE');
    expect(body.items[0].message).toContain('past its expected expiry');
    expect(body.total).toBe(3);
  });

  it('does not deliver the same reminder twice', async () => {
    await add({ lifespanDays: 2 });
    await feed();
    await feed();
    expect((await feed()).total).toBe(1);
  });

  it('marks reminders read individually and all at once', async () => {
    await add({ lifespanDays: 1 });
    await add({ lifespanDays: 0 });
    const body = await feed();
    await s.auth(api().put(`/api/notifications/${body.items[0].id}/read`)).expect(200);
    expect((await s.auth(api().get('/api/notifications/unread-count'))).body.unread).toBe(1);
    await s.auth(api().put('/api/notifications/read-all')).expect(204);
    expect((await s.auth(api().get('/api/notifications/unread-count'))).body.unread).toBe(0);
  });

  it('the background sweep delivers without the user opening the app', async () => {
    await add({ lifespanDays: 1 });
    await sweep((id) => UserModel.findById(id));
    expect(await NotificationModel.countDocuments({ status: 'SENT' })).toBe(1);
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
    await s.auth(api().get('/api/foods/cook-first')).expect(200);
  });

  it('a failed reminder is retried and delivered once the channel recovers', async () => {
    const spy = vi.spyOn(deliveryChannel, 'deliver').mockRejectedValueOnce(new Error('blip'));
    await add({ lifespanDays: 1 });
    expect((await feed()).total).toBe(0);
    expect((await feed()).total).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
