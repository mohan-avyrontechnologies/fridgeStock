import { beforeEach, describe, expect, it } from 'vitest';
import { FavouriteModel } from '../models/Favourite.js';
import { FoodItemModel } from '../models/FoodItem.js';
import { MealPlanEntryModel } from '../models/MealPlanEntry.js';
import { NotificationModel } from '../models/Notification.js';
import { ShoppingItemModel } from '../models/ShoppingItem.js';
import { UsageRecordModel } from '../models/UsageRecord.js';
import { UserModel } from '../models/User.js';
import { api, food, registerUser, setToday } from './helpers.js';

/** Phase 6: data export and account deletion. */

let s: Awaited<ReturnType<typeof registerUser>>;

beforeEach(async () => {
  setToday('2026-09-29');
  s = await registerUser();
});

/** One of everything the account can own. */
async function fillAccount(who = s) {
  const milk = await who
    .auth(
      api()
        .post('/api/foods')
        .send(food({ name: 'Milk', price: 2 })),
    )
    .expect(201)
    .then((r) => r.body);
  await who
    .auth(
      api()
        .post('/api/foods')
        .send(food({ name: 'Bread' })),
    )
    .expect(201);
  await who.auth(api().post(`/api/foods/${milk.id}/waste`).send({})).expect(200);
  await who
    .auth(api().post('/api/favourites').send({ name: 'Eggs', quantity: 6, unit: 'pcs', lifespanDays: 14 }))
    .expect(201);
  await who.auth(api().post('/api/shopping').send({ name: 'Flour' })).expect(201);
  await who.auth(api().put('/api/meal-plan/2026-09-30').send({ title: 'Toast', foodIds: [] })).expect(200);
}

const owned = (userId: string) => ({ userId });
const counts = async (userId: string) => ({
  foods: await FoodItemModel.countDocuments(owned(userId)),
  usage: await UsageRecordModel.countDocuments(owned(userId)),
  notifications: await NotificationModel.countDocuments(owned(userId)),
  favourites: await FavouriteModel.countDocuments(owned(userId)),
  shopping: await ShoppingItemModel.countDocuments(owned(userId)),
  plan: await MealPlanEntryModel.countDocuments(owned(userId)),
});

describe('GET /api/account/export', () => {
  it('needs a signed-in user', async () => {
    await api().get('/api/account/export').expect(401);
  });

  it('returns everything the account owns as a download', async () => {
    await fillAccount();
    const res = await s.auth(api().get('/api/account/export')).expect(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body.exportedAt).toBe('2026-09-29T12:00:00.000Z');
    expect(res.body.account).toMatchObject({ email: s.user.email, currency: 'USD' });
    expect(res.body.foods.map((f: { name: string }) => f.name).sort()).toEqual(['Bread', 'Milk']);
    expect(res.body.history).toHaveLength(1);
    expect(res.body.history[0]).toMatchObject({ foodName: 'Milk', action: 'WASTED', value: 2 });
    expect(res.body.favourites).toHaveLength(1);
    expect(res.body.shopping).toHaveLength(1);
    expect(res.body.mealPlan).toHaveLength(1);
    expect(res.body.pushDevices).toBe(0);
  });

  it('never includes the password hash, internal owner ids or anyone else’s data', async () => {
    const other = await registerUser();
    await fillAccount(other);
    await fillAccount();
    const text = (await s.auth(api().get('/api/account/export')).expect(200)).text;
    expect(text).not.toMatch(/passwordHash|"userId"|"householdId"|"__v"/);
    expect(text).not.toContain(other.user.email);
    expect(JSON.parse(text).foods).toHaveLength(2);
  });

  it('leaves out the push service’s own error text on reminders', async () => {
    await fillAccount();
    const failure = 'Received unexpected response code 410 from https://fcm.googleapis.com/fcm/send/abc';
    await NotificationModel.updateMany(owned(s.user.id), { $set: { lastError: failure } });
    const res = await s.auth(api().get('/api/account/export')).expect(200);
    expect(res.body.reminders.length).toBeGreaterThan(0);
    for (const reminder of res.body.reminders) expect(reminder).not.toHaveProperty('lastError');
    expect(res.text).not.toContain('fcm.googleapis.com');
  });
});

describe('DELETE /api/account', () => {
  it('needs a signed-in user', async () => {
    await api().delete('/api/account').send({ password: 'x' }).expect(401);
  });

  it('asks for the password, and a wrong one deletes nothing and does not sign you out', async () => {
    await fillAccount();
    const missing = await s.auth(api().delete('/api/account').send({})).expect(400);
    expect(missing.body.error.field).toBe('password');
    const wrong = await s.auth(api().delete('/api/account').send({ password: 'not the password' })).expect(400);
    expect(wrong.body.error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'password' });
    await s.auth(api().get('/api/auth/me')).expect(200);
    expect((await counts(s.user.id)).foods).toBe(2);
  });

  it('removes the account and every record it owns, and leaves other accounts alone', async () => {
    const other = await registerUser();
    await fillAccount(other);
    await fillAccount();
    expect(await counts(s.user.id)).toMatchObject({ foods: 2, usage: 1, favourites: 1, shopping: 1, plan: 1 });

    await s.auth(api().delete('/api/account').send({ password: s.password })).expect(204);

    expect(await UserModel.exists({ _id: s.user.id })).toBeNull();
    expect(await counts(s.user.id)).toEqual({
      foods: 0,
      usage: 0,
      notifications: 0,
      favourites: 0,
      shopping: 0,
      plan: 0,
    });
    expect(await counts(other.user.id)).toMatchObject({ foods: 2, usage: 1, favourites: 1, shopping: 1, plan: 1 });
    await s.auth(api().get('/api/auth/me')).expect(401);
    await api().post('/api/auth/login').send({ email: s.user.email, password: s.password }).expect(401);
    await other.auth(api().get('/api/auth/me')).expect(200);
  });

  it('lets the same email register again afterwards', async () => {
    await s.auth(api().delete('/api/account').send({ password: s.password })).expect(204);
    await registerUser({ email: s.user.email });
  });
});
