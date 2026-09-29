import { beforeEach, describe, expect, it } from 'vitest';
import { UsageRecordModel } from '../src/models/UsageRecord.js';
import { api, food, registerUser, setToday } from './helpers.js';

type Session = Awaited<ReturnType<typeof registerUser>>;
let s: Session;

beforeEach(async () => {
  setToday('2026-09-29');
  s = await registerUser();
});

const create = (overrides: Record<string, unknown> = {}) =>
  s.auth(api().post('/api/foods').send(food(overrides))).expect(201).then((r) => r.body);

describe('adding food', () => {
  it('calculates expected expiry as added date plus lifespan', async () => {
    const body = await create({ addedDate: '2026-09-27', lifespanDays: 5 });
    expect(body).toMatchObject({
      name: 'Milk',
      quantity: 1,
      unit: 'l',
      addedDate: '2026-09-27',
      lifespanDays: 5,
      expectedExpiryDate: '2026-10-02',
      status: 'ACTIVE',
      remainingDays: 3,
      urgency: 'USE_SOON',
    });
  });

  it('accepts a zero-day lifespan as expected expiry today', async () => {
    const body = await create({ lifespanDays: 0 });
    expect(body).toMatchObject({ expectedExpiryDate: '2026-09-29', remainingDays: 0, urgency: 'DUE_TODAY' });
  });

  it('allows a backdated added date that is already past expected expiry', async () => {
    const body = await create({ addedDate: '2026-09-20', lifespanDays: 2 });
    expect(body).toMatchObject({ remainingDays: -7, urgency: 'PAST_EXPECTED_EXPIRY' });
  });

  it.each([
    [{ name: '   ' }, 'name', 'Food name is required.'],
    [{ name: undefined }, 'name', 'Food name is required.'],
    [{ quantity: 0 }, 'quantity', 'Quantity must be a positive number.'],
    [{ quantity: -2 }, 'quantity', 'Quantity must be a positive number.'],
    [{ quantity: 'lots' }, 'quantity', 'Quantity must be a positive number.'],
    [{ unit: '' }, 'unit', 'Unit is required.'],
    [{ lifespanDays: -1 }, 'lifespanDays', 'Lifespan must be zero or a positive number of days.'],
    [{ lifespanDays: 2.5 }, 'lifespanDays', 'Lifespan must be zero or a positive number of days.'],
    [{ lifespanDays: 'three' }, 'lifespanDays', 'Lifespan must be zero or a positive number of days.'],
    [{ addedDate: 'yesterday' }, 'addedDate', 'Added date could not be parsed.'],
    [{ addedDate: '2026-02-30' }, 'addedDate', 'Added date could not be parsed.'],
    [{ addedDate: '2026-09-30' }, 'addedDate', "Added date can't be in the future."],
  ])('rejects %o', async (overrides, field, message) => {
    const res = await s.auth(api().post('/api/foods').send(food(overrides))).expect(400);
    expect(res.body.error).toEqual({ code: 'VALIDATION_ERROR', field, message });
  });

  it('ignores a userId in the request body', async () => {
    const other = await registerUser();
    const body = await create({ userId: other.user.id });
    await other.auth(api().get(`/api/foods/${body.id}`)).expect(404);
    await s.auth(api().get(`/api/foods/${body.id}`)).expect(200);
  });
});

describe('listing and Cook First', () => {
  it('sorts by expected expiry with urgency counts, and Cook First excludes "Not urgent"', async () => {
    await create({ name: 'Eggs', lifespanDays: 8 });
    await create({ name: 'Milk', lifespanDays: 4 });
    await create({ name: 'Chicken', lifespanDays: 1 });
    await create({ name: 'Spinach', lifespanDays: 2 });
    await create({ name: 'Bread', addedDate: '2026-09-25', lifespanDays: 3 });
    await create({ name: 'Yoghurt', lifespanDays: 0 });

    const list = await s.auth(api().get('/api/foods')).expect(200);
    expect(list.body.today).toBe('2026-09-29');
    expect(list.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Bread', 'Yoghurt', 'Chicken', 'Spinach', 'Milk', 'Eggs',
    ]);
    expect(list.body.summary).toEqual({ NOT_URGENT: 2, USE_SOON: 2, DUE_TODAY: 1, PAST_EXPECTED_EXPIRY: 1 });

    const cf = await s.auth(api().get('/api/foods/cook-first')).expect(200);
    expect(cf.body.items.map((i: { name: string }) => i.name)).toEqual(['Bread', 'Yoghurt', 'Chicken', 'Spinach']);
  });

  it('recalculates remaining days as the date moves on', async () => {
    const { id } = await create({ lifespanDays: 4 });
    setToday('2026-10-02');
    const res = await s.auth(api().get(`/api/foods/${id}`)).expect(200);
    expect(res.body).toMatchObject({ remainingDays: 1, urgency: 'USE_SOON' });
    setToday('2026-10-04');
    const later = await s.auth(api().get(`/api/foods/${id}`)).expect(200);
    expect(later.body).toMatchObject({ remainingDays: -1, urgency: 'PAST_EXPECTED_EXPIRY' });
  });

  it("uses the user's own time zone to decide today", async () => {
    const tokyo = await registerUser({ timeZone: 'Asia/Tokyo' });
    // 20:00 UTC on 29 Sep is already 30 Sep in Tokyo.
    const { clock } = await import('../src/utils/clock.js');
    clock.set(new Date('2026-09-29T20:00:00Z'));
    const res = await tokyo
      .auth(api().post('/api/foods').send(food({ addedDate: '2026-09-30', lifespanDays: 1 })))
      .expect(201);
    expect(res.body.remainingDays).toBe(1);
  });
});

describe('editing', () => {
  it('recalculates expected expiry when lifespan changes', async () => {
    const { id } = await create({ lifespanDays: 4 });
    const res = await s.auth(api().put(`/api/foods/${id}`).send({ lifespanDays: 10 })).expect(200);
    expect(res.body).toMatchObject({ expectedExpiryDate: '2026-10-09', remainingDays: 10, urgency: 'NOT_URGENT' });
  });

  it('recalculates expected expiry when added date changes', async () => {
    const { id } = await create({ lifespanDays: 4 });
    const res = await s.auth(api().put(`/api/foods/${id}`).send({ addedDate: '2026-09-24' })).expect(200);
    expect(res.body).toMatchObject({ expectedExpiryDate: '2026-09-28', urgency: 'PAST_EXPECTED_EXPIRY' });
  });

  it('validates updates and requires at least one field', async () => {
    const { id } = await create();
    await s.auth(api().put(`/api/foods/${id}`).send({ quantity: -1 })).expect(400);
    await s.auth(api().put(`/api/foods/${id}`).send({})).expect(400);
  });

  it('returns 404 for unknown and malformed ids', async () => {
    await s.auth(api().get('/api/foods/000000000000000000000000')).expect(404);
    await s.auth(api().get('/api/foods/not-an-id')).expect(404);
  });
});

describe('usage actions', () => {
  it('marks an item fully used, records it and drops it from active lists', async () => {
    const { id } = await create({ quantity: 2, lifespanDays: 1 });
    const res = await s.auth(api().post(`/api/foods/${id}/use`).send({ action: 'USED' })).expect(200);
    expect(res.body.food).toMatchObject({ status: 'USED', remainingDays: null, urgency: null });
    expect(res.body.usageRecord).toMatchObject({ action: 'USED', quantityUsed: 2, quantityRemaining: 0 });

    const list = await s.auth(api().get('/api/foods')).expect(200);
    expect(list.body.items).toHaveLength(0);
    const cf = await s.auth(api().get('/api/foods/cook-first')).expect(200);
    expect(cf.body.items).toHaveLength(0);
  });

  it('partly used reduces quantity and keeps the item active', async () => {
    const { id } = await create({ quantity: 1, unit: 'kg' });
    const res = await s
      .auth(api().post(`/api/foods/${id}/use`).send({ action: 'PARTIALLY_USED', quantityUsed: 0.3 }))
      .expect(200);
    expect(res.body.food).toMatchObject({ status: 'ACTIVE', quantity: 0.7 });
    expect(res.body.usageRecord).toMatchObject({ action: 'PARTIALLY_USED', quantityUsed: 0.3, quantityRemaining: 0.7 });
  });

  it('partly used must be less than the remaining quantity', async () => {
    const { id } = await create({ quantity: 1 });
    await s.auth(api().post(`/api/foods/${id}/use`).send({ action: 'PARTIALLY_USED' })).expect(400);
    const res = await s
      .auth(api().post(`/api/foods/${id}/use`).send({ action: 'PARTIALLY_USED', quantityUsed: 1 }))
      .expect(400);
    expect(res.body.error.field).toBe('quantityUsed');
  });

  it('wasting everything closes the item; wasting part keeps it active', async () => {
    const a = await create({ quantity: 4, unit: 'pcs' });
    const part = await s.auth(api().post(`/api/foods/${a.id}/waste`).send({ quantityUsed: 1 })).expect(200);
    expect(part.body.food).toMatchObject({ status: 'ACTIVE', quantity: 3 });

    const all = await s.auth(api().post(`/api/foods/${a.id}/waste`).send({})).expect(200);
    expect(all.body.food.status).toBe('WASTED');
    expect(all.body.usageRecord).toMatchObject({ action: 'WASTED', quantityUsed: 3 });

    const b = await create({ quantity: 1 });
    await s.auth(api().post(`/api/foods/${b.id}/waste`).send({ quantityUsed: 5 })).expect(400);
  });

  it('removing soft-closes the item with a REMOVED record', async () => {
    const { id } = await create();
    await s.auth(api().delete(`/api/foods/${id}`)).expect(204);
    const res = await s.auth(api().get(`/api/foods/${id}`)).expect(200);
    expect(res.body.status).toBe('REMOVED');
    expect(await UsageRecordModel.countDocuments({ foodId: id, action: 'REMOVED' })).toBe(1);
  });

  it('refuses to act on or edit a closed item', async () => {
    const { id } = await create();
    await s.auth(api().post(`/api/foods/${id}/use`).send({ action: 'USED' })).expect(200);
    for (const req of [
      api().post(`/api/foods/${id}/use`).send({ action: 'USED' }),
      api().post(`/api/foods/${id}/waste`).send({}),
      api().delete(`/api/foods/${id}`),
      api().put(`/api/foods/${id}`).send({ name: 'x' }),
    ]) {
      const res = await s.auth(req).expect(409);
      expect(res.body.error.code).toBe('ITEM_CLOSED');
    }
  });

  it('lists usage history newest first with per-action counts', async () => {
    const a = await create({ name: 'A', quantity: 2 });
    const b = await create({ name: 'B' });
    const c = await create({ name: 'C' });
    await s.auth(api().post(`/api/foods/${a.id}/use`).send({ action: 'PARTIALLY_USED', quantityUsed: 1 }));
    await s.auth(api().post(`/api/foods/${b.id}/waste`).send({}));
    await s.auth(api().delete(`/api/foods/${c.id}`));

    const res = await s.auth(api().get('/api/usage-records?limit=2')).expect(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.counts).toEqual({ USED: 0, PARTIALLY_USED: 1, WASTED: 1, REMOVED: 1 });
  });
});
