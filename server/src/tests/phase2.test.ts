import { beforeEach, describe, expect, it } from 'vitest';
import { FoodItemModel } from '../models/FoodItem.js';
import { runMigrations } from '../models/migrations.js';
import { NotificationModel } from '../models/Notification.js';
import { api, food, registerUser, setToday } from './helpers.js';

/** Phase 2: realistic estimates. */

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
const pendingDates = async (foodId: string) =>
  (await NotificationModel.find({ foodId, status: 'PENDING' })).map((n) => n.expiryDate);

describe('"Opened" shortens the expected expiry', () => {
  it('uses the reference "once opened" days: milk opened today lasts 4 more days', async () => {
    const { id } = await create({ name: 'Milk', lifespanDays: 10 }); // expires 10-09
    const res = await s.auth(api().post(`/api/foods/${id}/open`).send({})).expect(200);
    expect(res.body).toMatchObject({
      openedDate: '2026-09-29',
      expiryDate: '2026-10-03',
      lifespanDays: 4,
      remainingDays: 4,
      urgency: 'NOT_URGENT',
    });
    // Reminders follow the new expected expiry.
    expect(new Set(await pendingDates(id))).toEqual(new Set(['2026-10-03']));
  });

  it('never lengthens it: opening something that expires sooner keeps its date', async () => {
    const { id } = await create({ name: 'Milk', lifespanDays: 2 }); // expires 10-01
    const res = await s.auth(api().post(`/api/foods/${id}/open`).send({ daysLeft: 5 })).expect(200);
    expect(res.body).toMatchObject({ openedDate: '2026-09-29', expiryDate: '2026-10-01', lifespanDays: 2 });
  });

  it('accepts a past opened date and a custom number of days', async () => {
    const { id } = await create({ name: 'Pickles', addedDate: '2026-09-20', lifespanDays: 60 });
    const res = await s
      .auth(api().post(`/api/foods/${id}/open`).send({ openedDate: '2026-09-25', daysLeft: 3 }))
      .expect(200);
    expect(res.body).toMatchObject({ openedDate: '2026-09-25', expiryDate: '2026-09-28', urgency: 'OVERDUE' });
  });

  it('asks for the days when the food has no reference value', async () => {
    const { id } = await create({ name: 'Pickles' });
    const res = await s.auth(api().post(`/api/foods/${id}/open`).send({})).expect(400);
    expect(res.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      field: 'daysLeft',
      message: 'Enter how many days it lasts once opened.',
    });
  });

  it('rejects a second "Opened", a future or pre-added date, and closed items', async () => {
    const { id } = await create({ name: 'Milk', addedDate: '2026-09-27' });
    await s.auth(api().post(`/api/foods/${id}/open`).send({ openedDate: '2026-09-30' })).expect(400);
    await s.auth(api().post(`/api/foods/${id}/open`).send({ openedDate: '2026-09-26' })).expect(400);
    await s.auth(api().post(`/api/foods/${id}/open`).send({})).expect(200);
    const again = await s.auth(api().post(`/api/foods/${id}/open`).send({})).expect(409);
    expect(again.body.error.message).toBe('This item is already marked as opened.');

    const other = await create({ name: 'Cream' });
    await s.auth(api().post(`/api/foods/${other.id}/use`).send({})).expect(200);
    await s.auth(api().post(`/api/foods/${other.id}/open`).send({})).expect(409);
  });

  it('can be undone, restoring the previous lifespan, expiry and reminders', async () => {
    const { id } = await create({ name: 'Milk', lifespanDays: 10 });
    await s.auth(api().post(`/api/foods/${id}/open`).send({})).expect(200);
    const res = await s.auth(api().delete(`/api/foods/${id}/open`)).expect(200);
    expect(res.body).toMatchObject({ openedDate: null, lifespanDays: 10, expiryDate: '2026-10-09' });
    expect(new Set(await pendingDates(id))).toEqual(new Set(['2026-10-09']));
    const none = await s.auth(api().delete(`/api/foods/${id}/open`)).expect(409);
    expect(none.body.error.message).toBe('This item is not marked as opened.');
  });
});

describe('moving between fridge, freezer and pantry', () => {
  it("moving chicken to the freezer uses the freezer's lifespan, counted from today", async () => {
    const { id } = await create({ name: 'Chicken', unit: 'g', addedDate: '2026-09-28', lifespanDays: 2 });
    const res = await s.auth(api().post(`/api/foods/${id}/move`).send({ storage: 'FREEZER' })).expect(200);
    // 270 days from today (09-29) → 2027-06-26; lifespan counts from the added date (09-28).
    expect(res.body).toMatchObject({
      storage: 'FREEZER',
      expiryDate: '2027-06-26',
      lifespanDays: 271,
      remainingDays: 270,
      urgency: 'NOT_URGENT',
    });
    expect(new Set(await pendingDates(id))).toEqual(new Set(['2027-06-26']));
  });

  it('moving back to the fridge shortens it again', async () => {
    const { id } = await create({ name: 'Chicken', lifespanDays: 2 });
    await s.auth(api().post(`/api/foods/${id}/move`).send({ storage: 'FREEZER' })).expect(200);
    const res = await s.auth(api().post(`/api/foods/${id}/move`).send({ storage: 'FRIDGE' })).expect(200);
    expect(res.body).toMatchObject({ storage: 'FRIDGE', expiryDate: '2026-10-01', remainingDays: 2 });
  });

  it('accepts a custom number of days, and caps the lifespan at 365', async () => {
    const custom = await create({ name: 'Soup', lifespanDays: 3 });
    const a = await s.auth(api().post(`/api/foods/${custom.id}/move`).send({ storage: 'FREEZER', daysLeft: 30 }));
    expect(a.body).toMatchObject({ expiryDate: '2026-10-29', lifespanDays: 30 });

    const old = await create({ name: 'Broccoli', addedDate: '2026-06-01', lifespanDays: 200 });
    const b = await s.auth(api().post(`/api/foods/${old.id}/move`).send({ storage: 'FREEZER' })).expect(200);
    expect(b.body.lifespanDays).toBe(365);
    expect(b.body.expiryDate).toBe('2027-06-01');
  });

  it('asks for the days when there is no suggestion, and rejects moving to the same place', async () => {
    const eggs = await create({ name: 'Eggs' }); // eggs have no freezer value
    const res = await s.auth(api().post(`/api/foods/${eggs.id}/move`).send({ storage: 'FREEZER' })).expect(400);
    expect(res.body.error).toMatchObject({ field: 'daysLeft', message: 'Enter how many days it lasts there.' });
    const same = await s.auth(api().post(`/api/foods/${eggs.id}/move`).send({ storage: 'FRIDGE' })).expect(400);
    expect(same.body.error).toMatchObject({ field: 'storage', message: 'It is already kept there.' });
    await s.auth(api().post(`/api/foods/${eggs.id}/move`).send({ storage: 'FREEZER', daysLeft: 400 })).expect(400);
  });

  it("another user can't open or move your item", async () => {
    const { id } = await create({ name: 'Milk' });
    const other = await registerUser();
    await other.auth(api().post(`/api/foods/${id}/open`).send({})).expect(404);
    await other.auth(api().delete(`/api/foods/${id}/open`)).expect(404);
    await other.auth(api().post(`/api/foods/${id}/move`).send({ storage: 'FREEZER' })).expect(404);
  });
});

describe('lifespans learned from your own history', () => {
  const learned = async () => (await s.auth(api().get('/api/suggestions/lifespans')).expect(200)).body.items;

  it('suggests the median lifespan you set for a food and location, once you have 2 or more', async () => {
    await create({ name: 'Spinach', unit: 'bunch', lifespanDays: 3 });
    expect(await learned()).toEqual([]);
    await create({ name: 'spinach', unit: 'bunch', lifespanDays: 5 });
    await create({ name: 'Spinach', unit: 'bunch', lifespanDays: 4 });
    await create({ name: 'Spinach', unit: 'bunch', lifespanDays: 100, storage: 'FREEZER' });
    expect(await learned()).toEqual([{ name: 'Spinach', storage: 'FRIDGE', unit: 'bunch', days: 4, basedOn: 3 }]);
  });

  it('learns from closed items too, and from what you entered rather than what Move/Opened changed', async () => {
    const a = await create({ name: 'Milk', lifespanDays: 7 });
    const b = await create({ name: 'Milk', lifespanDays: 7 });
    await s.auth(api().post(`/api/foods/${a.id}/open`).send({})).expect(200); // lifespan becomes 4
    await s.auth(api().post(`/api/foods/${b.id}/move`).send({ storage: 'FREEZER' })).expect(200);
    await s.auth(api().post(`/api/foods/${a.id}/use`).send({})).expect(200);
    expect(await learned()).toEqual([{ name: 'Milk', storage: 'FRIDGE', unit: 'l', days: 7, basedOn: 2 }]);
  });

  it('uses only the last 10 items, and editing the lifespan counts as your choice', async () => {
    for (let i = 0; i < 10; i++) await create({ name: 'Bread', unit: 'pack', lifespanDays: 3 });
    const edited = await create({ name: 'Bread', unit: 'pack', lifespanDays: 3 });
    await s.auth(api().put(`/api/foods/${edited.id}`).send({ lifespanDays: 9 })).expect(200);
    const [bread] = await learned();
    expect(bread).toMatchObject({ days: 3, basedOn: 10 });
  });

  it("is private: another user's history never shapes your suggestions", async () => {
    const other = await registerUser();
    for (let i = 0; i < 3; i++)
      await other.auth(
        api()
          .post('/api/foods')
          .send(food({ name: 'Kale', lifespanDays: 9 })),
      );
    expect(await learned()).toEqual([]);
  });

  it('existing items are backfilled with what was entered', async () => {
    const { id } = await create({ name: 'Old' });
    await FoodItemModel.collection.updateOne(
      { _id: (await FoodItemModel.findById(id))!._id },
      {
        $unset: { enteredLifespanDays: '', enteredStorage: '' },
      },
    );
    await runMigrations();
    const raw = await FoodItemModel.collection.findOne({ name: 'Old' });
    expect(raw).toMatchObject({ enteredLifespanDays: 4, enteredStorage: 'FRIDGE' });
  });
});
