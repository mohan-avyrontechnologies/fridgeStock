import { beforeEach, describe, expect, it } from 'vitest';
import { FoodItemModel } from '../models/FoodItem.js';
import { UsageRecordModel } from '../models/UsageRecord.js';
import { api, food, registerUser, setToday } from './helpers.js';

type Session = Awaited<ReturnType<typeof registerUser>>;
let s: Session;

beforeEach(async () => {
  setToday('2026-09-29');
  s = await registerUser();
});

const create = (overrides: Record<string, unknown> = {}) =>
  s
    .auth(api().post('/api/foods').send(food(overrides)))
    .expect(201)
    .then((r) => r.body);

describe('adding food', () => {
  it('calculates expected expiry as added date plus lifespan', async () => {
    const body = await create({ addedDate: '2026-09-27', lifespanDays: 5 });
    expect(body).toMatchObject({
      name: 'Milk',
      quantity: 1,
      unit: 'l',
      addedDate: '2026-09-27',
      lifespanDays: 5,
      expiryDate: '2026-10-02',
      status: 'ACTIVE',
      remainingDays: 3,
      urgency: 'APPROACHING_EXPIRY',
    });
  });

  it('accepts a zero-day lifespan as expected expiry today', async () => {
    const body = await create({ lifespanDays: 0 });
    expect(body).toMatchObject({ expiryDate: '2026-09-29', remainingDays: 0, urgency: 'DUE' });
  });

  it('allows a backdated added date that is already past expected expiry', async () => {
    const body = await create({ addedDate: '2026-09-20', lifespanDays: 2 });
    expect(body).toMatchObject({ remainingDays: -7, urgency: 'OVERDUE' });
  });

  it.each([
    [{ name: '   ' }, 'name', 'Food name is required.'],
    [{ name: undefined }, 'name', 'Food name is required.'],
    [{ quantity: 0 }, 'quantity', 'Quantity must be a positive number.'],
    [{ quantity: -2 }, 'quantity', 'Quantity must be a positive number.'],
    [{ quantity: 'lots' }, 'quantity', 'Quantity must be a positive number.'],
    [{ unit: '' }, 'unit', 'Choose a unit from the list.'],
    [{ unit: 'cups' }, 'unit', 'Choose a unit from the list.'],
    [{ name: 'x'.repeat(61) }, 'name', 'Food name must be at most 60 characters.'],
    [{ lifespanDays: 366 }, 'lifespanDays', 'Lifespan must be a whole number of days from 0 to 365.'],
    [{ lifespanDays: -1 }, 'lifespanDays', 'Lifespan must be a whole number of days from 0 to 365.'],
    [{ lifespanDays: 2.5 }, 'lifespanDays', 'Lifespan must be a whole number of days from 0 to 365.'],
    [{ lifespanDays: 'three' }, 'lifespanDays', 'Lifespan must be a whole number of days from 0 to 365.'],
    [{ notes: 'n'.repeat(201) }, 'notes', 'Notes must be at most 200 characters.'],
    [{ addedDate: 'yesterday' }, 'addedDate', "Added date must be a valid date that isn't in the future."],
    [{ addedDate: '2026-02-30' }, 'addedDate', "Added date must be a valid date that isn't in the future."],
    [{ addedDate: '2026-09-30' }, 'addedDate', "Added date must be a valid date that isn't in the future."],
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

describe('limits, units and notes', () => {
  it('accepts the boundaries: 60-character name, 365-day lifespan, 200-character notes, every unit', async () => {
    for (const unit of ['pcs', 'g', 'kg', 'ml', 'l', 'pack', 'bunch']) {
      await create({ unit });
    }
    const body = await create({ name: 'x'.repeat(60), lifespanDays: 365, notes: 'n'.repeat(200) });
    expect(body).toMatchObject({ lifespanDays: 365, expiryDate: '2027-09-29', notes: 'n'.repeat(200) });
  });

  it('stores optional notes, returns null without them, and clears them with an empty string', async () => {
    const withNotes = await create({ notes: '  Top shelf, opened  ' });
    expect(withNotes.notes).toBe('Top shelf, opened');
    expect((await create()).notes).toBeNull();
    const cleared = await s.auth(api().put(`/api/foods/${withNotes.id}`).send({ notes: '' })).expect(200);
    expect(cleared.body.notes).toBeNull();
  });
});

describe('expiry date is always calculated by the server', () => {
  it('ignores an expiry date sent by the client when creating', async () => {
    const body = await create({
      addedDate: '2026-09-28',
      lifespanDays: 2,
      expiryDate: '2030-01-01',
      remainingDays: 99,
    });
    expect(body.expiryDate).toBe('2026-09-30');
    const stored = await FoodItemModel.findById(body.id);
    expect(stored!.expiryDate).toBe('2026-09-30');
  });

  it('ignores an expiry date sent by the client when editing, and recalculates from lifespan', async () => {
    const { id } = await create({ lifespanDays: 2 });
    const res = await s
      .auth(api().put(`/api/foods/${id}`).send({ expiryDate: '2030-01-01', lifespanDays: 5 }))
      .expect(200);
    expect(res.body.expiryDate).toBe('2026-10-04');
  });

  it('keeps the expiry date when only other fields change', async () => {
    const { id } = await create({ lifespanDays: 2 });
    const res = await s
      .auth(api().put(`/api/foods/${id}`).send({ name: 'Oat milk', expiryDate: '2030-01-01' }))
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Oat milk', expiryDate: '2026-10-01' });
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
      'Bread',
      'Yoghurt',
      'Chicken',
      'Spinach',
      'Milk',
      'Eggs',
    ]);
    expect(list.body.summary).toEqual({ NOT_URGENT: 2, APPROACHING_EXPIRY: 2, DUE: 1, OVERDUE: 1, total: 6 });

    const cf = await s.auth(api().get('/api/foods/cook-first')).expect(200);
    expect(cf.body.items.map((i: { name: string }) => i.name)).toEqual(['Bread', 'Yoghurt', 'Chicken', 'Spinach']);
  });

  it('recalculates remaining days as the date moves on', async () => {
    const { id } = await create({ lifespanDays: 4 });
    setToday('2026-10-02');
    const res = await s.auth(api().get(`/api/foods/${id}`)).expect(200);
    expect(res.body).toMatchObject({ remainingDays: 1, urgency: 'APPROACHING_EXPIRY' });
    setToday('2026-10-04');
    const later = await s.auth(api().get(`/api/foods/${id}`)).expect(200);
    expect(later.body).toMatchObject({ remainingDays: -1, urgency: 'OVERDUE' });
  });

  it("uses the user's own time zone to decide today", async () => {
    const tokyo = await registerUser({ timeZone: 'Asia/Tokyo' });
    // 20:00 UTC on 29 Sep is already 30 Sep in Tokyo.
    const { clock } = await import('../services/clock.js');
    clock.set(new Date('2026-09-29T20:00:00Z'));
    const res = await tokyo
      .auth(
        api()
          .post('/api/foods')
          .send(food({ addedDate: '2026-09-30', lifespanDays: 1 })),
      )
      .expect(201);
    expect(res.body.remainingDays).toBe(1);
  });
});

describe('editing', () => {
  it('recalculates expected expiry when lifespan changes', async () => {
    const { id } = await create({ lifespanDays: 4 });
    const res = await s.auth(api().put(`/api/foods/${id}`).send({ lifespanDays: 10 })).expect(200);
    expect(res.body).toMatchObject({ expiryDate: '2026-10-09', remainingDays: 10, urgency: 'NOT_URGENT' });
  });

  it('recalculates expected expiry when added date changes', async () => {
    const { id } = await create({ lifespanDays: 4 });
    const res = await s.auth(api().put(`/api/foods/${id}`).send({ addedDate: '2026-09-24' })).expect(200);
    expect(res.body).toMatchObject({ expiryDate: '2026-09-28', urgency: 'OVERDUE' });
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
  it('POST /use without a quantity uses the whole item, logs it and drops it from active lists', async () => {
    const { id } = await create({ quantity: 2, lifespanDays: 1 });
    const res = await s.auth(api().post(`/api/foods/${id}/use`).send({})).expect(200);
    expect(res.body.food).toMatchObject({ status: 'USED', remainingDays: null, urgency: null });
    expect(res.body.food.closedAt).toEqual(expect.any(String));
    expect(res.body.usageRecord).toMatchObject({ action: 'USED', quantityUsed: 2, unit: 'l', date: '2026-09-29' });

    expect((await s.auth(api().get('/api/foods')).expect(200)).body.items).toHaveLength(0);
    expect((await s.auth(api().get('/api/foods/cook-first')).expect(200)).body.items).toHaveLength(0);
  });

  it.each([
    ['used', (id: string) => api().post(`/api/foods/${id}/use`).send({})],
    ['wasted', (id: string) => api().post(`/api/foods/${id}/waste`).send({})],
    ['removed', (id: string) => api().delete(`/api/foods/${id}`)],
  ])('a %s item disappears from the inventory and Cook First', async (_label, close) => {
    const kept = await create({ name: 'Kept', lifespanDays: 1 });
    const gone = await create({ name: 'Gone', lifespanDays: 1 });
    await s.auth(close(gone.id));
    const list = (await s.auth(api().get('/api/foods')).expect(200)).body;
    const cf = (await s.auth(api().get('/api/foods/cook-first')).expect(200)).body;
    expect(list.items.map((i: { id: string }) => i.id)).toEqual([kept.id]);
    expect(cf.items.map((i: { id: string }) => i.id)).toEqual([kept.id]);
    expect(list.summary.total).toBe(1);
  });

  it('POST /use with the whole quantity also closes the item as USED', async () => {
    const { id } = await create({ quantity: 3, unit: 'pcs' });
    const res = await s.auth(api().post(`/api/foods/${id}/use`).send({ quantity: 3 })).expect(200);
    expect(res.body.food.status).toBe('USED');
    expect(res.body.usageRecord.action).toBe('USED');
  });

  it('POST /use with a smaller quantity reduces the item and logs PARTIALLY_USED', async () => {
    const { id } = await create({ quantity: 1, unit: 'kg' });
    const res = await s.auth(api().post(`/api/foods/${id}/use`).send({ quantity: 0.3 })).expect(200);
    expect(res.body.food).toMatchObject({ status: 'ACTIVE', quantity: 0.7, closedAt: null });
    expect(res.body.usageRecord).toMatchObject({
      action: 'PARTIALLY_USED',
      quantityUsed: 0.3,
      quantityRemaining: 0.7,
      unit: 'kg',
    });
  });

  it.each([
    [0, 'Quantity must be a positive number.'],
    [-1, 'Quantity must be a positive number.'],
    [5, 'There is only 1 l left.'],
  ])('POST /use rejects a quantity of %s with 400', async (quantity, message) => {
    const { id } = await create({ quantity: 1 });
    const res = await s.auth(api().post(`/api/foods/${id}/use`).send({ quantity })).expect(400);
    expect(res.body.error).toEqual({ code: 'VALIDATION_ERROR', field: 'quantity', message });
  });

  it('POST /waste closes the whole item as WASTED and logs the quantity left', async () => {
    const { id } = await create({ quantity: 4, unit: 'pcs' });
    await s.auth(api().post(`/api/foods/${id}/use`).send({ quantity: 1 })).expect(200);
    const res = await s.auth(api().post(`/api/foods/${id}/waste`).send({ quantity: 1 })).expect(200);
    expect(res.body.food).toMatchObject({ status: 'WASTED' });
    expect(res.body.food.closedAt).toEqual(expect.any(String));
    expect(res.body.usageRecord).toMatchObject({ action: 'WASTED', quantityUsed: 3, unit: 'pcs' });
  });

  it('DELETE soft-deletes the item as REMOVED with 204 and logs the quantity left', async () => {
    const { id } = await create({ quantity: 2 });
    await s.auth(api().delete(`/api/foods/${id}`)).expect(204);
    const res = await s.auth(api().get(`/api/foods/${id}`)).expect(200);
    expect(res.body).toMatchObject({ status: 'REMOVED', remainingDays: null });
    expect(res.body.closedAt).toEqual(expect.any(String));
    const record = await UsageRecordModel.findOne({ foodId: id, action: 'REMOVED' });
    expect(record).toMatchObject({ quantityUsed: 2 });
  });

  it('returns 409 CONFLICT "This item is no longer active." for any action on a closed item', async () => {
    const { id } = await create();
    await s.auth(api().post(`/api/foods/${id}/use`).send({})).expect(200);
    for (const req of [
      api().post(`/api/foods/${id}/use`).send({}),
      api().post(`/api/foods/${id}/waste`).send({}),
      api().delete(`/api/foods/${id}`),
      api().put(`/api/foods/${id}`).send({ name: 'x' }),
    ]) {
      const res = await s.auth(req).expect(409);
      expect(res.body.error).toEqual({ code: 'CONFLICT', message: 'This item is no longer active.' });
    }
  });

  it('GET /usage lists history newest first, defaulting to limit 20 and offset 0', async () => {
    const a = await create({ name: 'A', quantity: 2 });
    const b = await create({ name: 'B' });
    const c = await create({ name: 'C' });
    await s.auth(api().post(`/api/foods/${a.id}/use`).send({ quantity: 1 }));
    await s.auth(api().post(`/api/foods/${b.id}/waste`).send({}));
    await s.auth(api().delete(`/api/foods/${c.id}`));

    const all = await s.auth(api().get('/api/usage')).expect(200);
    expect(all.body.items.map((r: { foodName: string }) => r.foodName)).toEqual(['C', 'B', 'A']);
    expect(all.body.counts).toEqual({ USED: 0, PARTIALLY_USED: 1, WASTED: 1, REMOVED: 1 });

    const page = await s.auth(api().get('/api/usage?limit=2&offset=1')).expect(200);
    expect(page.body.total).toBe(3);
    expect(page.body.items.map((r: { foodName: string }) => r.foodName)).toEqual(['B', 'A']);

    for (let i = 0; i < 22; i++)
      await create({ name: `bulk${i}` }).then((f) => s.auth(api().delete(`/api/foods/${f.id}`)));
    expect((await s.auth(api().get('/api/usage')).expect(200)).body.items).toHaveLength(20);
  });
});
