import { beforeEach, describe, expect, it } from 'vitest';
import { FoodItemModel } from '../models/FoodItem.js';
import { runMigrations } from '../models/migrations.js';
import { NotificationModel } from '../models/Notification.js';
import { UsageRecordModel } from '../models/UsageRecord.js';
import { UserModel } from '../models/User.js';
import { clock } from '../services/clock.js';
import { api, food, registerUser, setToday } from './helpers.js';

/** Phase 1 (faster entry) and the three fields added to the data model ahead of later phases. */

let s: Awaited<ReturnType<typeof registerUser>>;

beforeEach(async () => {
  setToday('2026-09-29');
  s = await registerUser();
});

const create = (overrides: Record<string, unknown> = {}) =>
  s
    .auth(api().post('/api/foods').send(food(overrides)))
    .expect(201)
    .then((r) => r.body);

describe('new fields: household, storage location, opened date', () => {
  it('every user gets their own household, and their items carry it', async () => {
    const other = await registerUser();
    const [a, b] = await Promise.all([UserModel.findById(s.user.id), UserModel.findById(other.user.id)]);
    expect(a!.householdId).toBeDefined();
    expect(String(a!.householdId)).not.toBe(String(b!.householdId));
    const item = await create();
    expect(String((await FoodItemModel.findById(item.id))!.householdId)).toBe(String(a!.householdId));
  });

  it('storage defaults to FRIDGE and accepts FREEZER and PANTRY', async () => {
    expect((await create()).storage).toBe('FRIDGE');
    expect((await create({ storage: 'FREEZER' })).storage).toBe('FREEZER');
    expect((await create({ storage: 'PANTRY' })).storage).toBe('PANTRY');
    const bad = await s
      .auth(
        api()
          .post('/api/foods')
          .send(food({ storage: 'CELLAR' })),
      )
      .expect(400);
    expect(bad.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      field: 'storage',
      message: 'Choose where it is kept: fridge, freezer or pantry.',
    });
  });

  it('opened date is optional, and must not be in the future or before the added date', async () => {
    expect((await create()).openedDate).toBeNull();
    expect((await create({ addedDate: '2026-09-27', openedDate: '2026-09-28' })).openedDate).toBe('2026-09-28');
    for (const openedDate of ['2026-09-30', '2026-09-26', 'yesterday']) {
      const res = await s
        .auth(
          api()
            .post('/api/foods')
            .send(food({ addedDate: '2026-09-27', openedDate })),
        )
        .expect(400);
      expect(res.body.error.field).toBe('openedDate');
    }
  });

  it('storage and opened date can be edited, and the opened date cleared', async () => {
    const { id } = await create();
    const edited = await s
      .auth(api().put(`/api/foods/${id}`).send({ storage: 'FREEZER', openedDate: '2026-09-29' }))
      .expect(200);
    expect(edited.body).toMatchObject({ storage: 'FREEZER', openedDate: '2026-09-29' });
    const cleared = await s.auth(api().put(`/api/foods/${id}`).send({ openedDate: null })).expect(200);
    expect(cleared.body.openedDate).toBeNull();
  });

  it('existing data is backfilled: users get a household, items get it plus FRIDGE storage', async () => {
    const user = await UserModel.collection.insertOne({ name: 'Old', email: 'old@example.com', passwordHash: 'x' });
    const item = await FoodItemModel.collection.insertOne({
      userId: user.insertedId,
      name: 'Old milk',
      quantity: 1,
      unit: 'l',
      addedDate: '2026-09-20',
      lifespanDays: 4,
      expiryDate: '2026-09-24',
      status: 'ACTIVE',
    });
    await runMigrations();
    const u = await UserModel.collection.findOne({ _id: user.insertedId });
    const f = await FoodItemModel.collection.findOne({ _id: item.insertedId });
    expect(u!.householdId).toBeDefined();
    expect(String(f!.householdId)).toBe(String(u!.householdId));
    expect(f).toMatchObject({ storage: 'FRIDGE', openedDate: null });
  });
});

describe('bulk add', () => {
  const haul = {
    addedDate: '2026-09-29',
    items: [
      { name: 'Chicken', quantity: 500, unit: 'g', lifespanDays: 2 },
      { name: 'Peas', quantity: 1, unit: 'pack', lifespanDays: 240, storage: 'FREEZER' },
      { name: 'Milk', quantity: 2, unit: 'l', lifespanDays: 5 },
    ],
  };

  it('adds a whole shopping haul with a shared added date and per-row storage', async () => {
    const res = await s.auth(api().post('/api/foods/bulk').send(haul)).expect(201);
    expect(res.body.items.map((i: { name: string; storage: string }) => [i.name, i.storage])).toEqual([
      ['Chicken', 'FRIDGE'],
      ['Peas', 'FREEZER'],
      ['Milk', 'FRIDGE'],
    ]);
    expect(res.body.items[0]).toMatchObject({
      addedDate: '2026-09-29',
      expiryDate: '2026-10-01',
      urgency: 'APPROACHING_EXPIRY',
    });
    const list = (await s.auth(api().get('/api/foods')).expect(200)).body;
    expect(list.summary.total).toBe(3);
  });

  it('schedules reminders for every item', async () => {
    const res = await s.auth(api().post('/api/foods/bulk').send(haul)).expect(201);
    for (const item of res.body.items) {
      expect(await NotificationModel.countDocuments({ foodId: item.id })).toBeGreaterThan(0);
    }
  });

  it('names the failing row and field, and saves nothing if any row is invalid', async () => {
    const bad = { ...haul, items: [haul.items[0], { ...haul.items[1], lifespanDays: 400 }, haul.items[2]] };
    const res = await s.auth(api().post('/api/foods/bulk').send(bad)).expect(400);
    expect(res.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      field: 'items.1.lifespanDays',
      message: 'Lifespan must be a whole number of days from 0 to 365.',
    });
    expect(await FoodItemModel.countDocuments({ userId: s.user.id })).toBe(0);
  });

  it('needs 1 to 50 items and an added date that is not in the future', async () => {
    const empty = await s
      .auth(
        api()
          .post('/api/foods/bulk')
          .send({ ...haul, items: [] }),
      )
      .expect(400);
    expect(empty.body.error.message).toBe('Add at least one item.');
    const many = Array.from({ length: 51 }, () => haul.items[0]);
    const tooMany = await s
      .auth(
        api()
          .post('/api/foods/bulk')
          .send({ ...haul, items: many }),
      )
      .expect(400);
    expect(tooMany.body.error.message).toBe('Add at most 50 items at once.');
    const future = await s
      .auth(
        api()
          .post('/api/foods/bulk')
          .send({ ...haul, addedDate: '2026-10-01' }),
      )
      .expect(400);
    expect(future.body.error.field).toBe('addedDate');
  });
});

describe('favourites', () => {
  const milk = { name: 'Milk', quantity: 2, unit: 'l', lifespanDays: 5 };

  it('saves, lists alphabetically, and rejects a duplicate name (any case)', async () => {
    await s
      .auth(
        api()
          .post('/api/favourites')
          .send({ ...milk, name: 'Spinach', unit: 'bunch' }),
      )
      .expect(201);
    const created = await s.auth(api().post('/api/favourites').send(milk)).expect(201);
    expect(created.body).toMatchObject({ ...milk, storage: 'FRIDGE' });
    const dup = await s
      .auth(
        api()
          .post('/api/favourites')
          .send({ ...milk, name: 'MILK' }),
      )
      .expect(409);
    expect(dup.body.error).toMatchObject({ code: 'CONFLICT', message: 'This food is already a favourite.' });
    const list = await s.auth(api().get('/api/favourites')).expect(200);
    expect(list.body.items.map((f: { name: string }) => f.name)).toEqual(['Milk', 'Spinach']);
  });

  it('one tap re-adds it as a new item added today', async () => {
    const fav = (
      await s
        .auth(
          api()
            .post('/api/favourites')
            .send({ ...milk, storage: 'FREEZER' }),
        )
        .expect(201)
    ).body;
    const res = await s.auth(api().post(`/api/favourites/${fav.id}/add`)).expect(201);
    expect(res.body).toMatchObject({
      name: 'Milk',
      quantity: 2,
      unit: 'l',
      lifespanDays: 5,
      storage: 'FREEZER',
      addedDate: '2026-09-29',
      expiryDate: '2026-10-04',
      status: 'ACTIVE',
    });
  });

  it('can be deleted, and is private to its owner', async () => {
    const fav = (await s.auth(api().post('/api/favourites').send(milk)).expect(201)).body;
    const other = await registerUser();
    expect((await other.auth(api().get('/api/favourites'))).body.items).toEqual([]);
    await other.auth(api().post(`/api/favourites/${fav.id}/add`)).expect(404);
    await other.auth(api().delete(`/api/favourites/${fav.id}`)).expect(404);
    await s.auth(api().delete(`/api/favourites/${fav.id}`)).expect(204);
    expect((await s.auth(api().get('/api/favourites'))).body.items).toEqual([]);
  });
});

describe('undo (replaces confirmation dialogs)', () => {
  it.each([
    ['used', (id: string) => api().post(`/api/foods/${id}/use`).send({})],
    ['wasted', (id: string) => api().post(`/api/foods/${id}/waste`).send({})],
    ['removed', (id: string) => api().delete(`/api/foods/${id}`)],
  ])('undoing %s reopens the item with its quantity, reminders and no usage record', async (_label, close) => {
    const { id } = await create({ quantity: 3, unit: 'pcs', lifespanDays: 10 });
    await s.auth(close(id));
    expect(await NotificationModel.countDocuments({ foodId: id, status: 'PENDING' })).toBe(0);

    const res = await s.auth(api().post(`/api/foods/${id}/undo`)).expect(200);
    expect(res.body).toMatchObject({ status: 'ACTIVE', quantity: 3, closedAt: null, urgency: 'NOT_URGENT' });
    expect(await UsageRecordModel.countDocuments({ foodId: id })).toBe(0);
    expect(await NotificationModel.countDocuments({ foodId: id, status: 'PENDING' })).toBe(3);
    expect((await s.auth(api().get('/api/foods'))).body.items.map((i: { id: string }) => i.id)).toEqual([id]);
  });

  it('undoing a partial use gives the quantity back; undoing again steps further back', async () => {
    const { id } = await create({ quantity: 1, unit: 'kg' });
    await s.auth(api().post(`/api/foods/${id}/use`).send({ quantity: 0.3 })).expect(200);
    await s.auth(api().post(`/api/foods/${id}/use`).send({ quantity: 0.2 })).expect(200);
    expect((await s.auth(api().post(`/api/foods/${id}/undo`)).expect(200)).body.quantity).toBe(0.7);
    expect((await s.auth(api().post(`/api/foods/${id}/undo`)).expect(200)).body.quantity).toBe(1);
    await s.auth(api().post(`/api/foods/${id}/undo`)).expect(409);
  });

  it('409 when there is nothing to undo, or after 10 minutes', async () => {
    const { id } = await create();
    const none = await s.auth(api().post(`/api/foods/${id}/undo`)).expect(409);
    expect(none.body.error).toEqual({ code: 'CONFLICT', message: 'There is nothing to undo for this item.' });

    await s.auth(api().post(`/api/foods/${id}/waste`).send({})).expect(200);
    clock.set(new Date(clock.now().getTime() + 11 * 60 * 1000));
    const late = await s.auth(api().post(`/api/foods/${id}/undo`)).expect(409);
    expect(late.body.error.message).toBe('This action can no longer be undone.');
  });

  it("another user can't undo your actions", async () => {
    const { id } = await create();
    await s.auth(api().post(`/api/foods/${id}/waste`).send({})).expect(200);
    const other = await registerUser();
    await other.auth(api().post(`/api/foods/${id}/undo`)).expect(404);
  });
});
