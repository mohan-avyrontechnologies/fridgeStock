import { beforeEach, describe, expect, it } from 'vitest';
import { FoodItemModel } from '../models/FoodItem.js';
import { api, food, registerUser, setToday } from './helpers.js';

describe('cross-user isolation', () => {
  let alice: Awaited<ReturnType<typeof registerUser>>;
  let bob: Awaited<ReturnType<typeof registerUser>>;
  let aliceFoodId: string;

  beforeEach(async () => {
    setToday('2026-09-29');
    alice = await registerUser();
    bob = await registerUser();
    const res = await alice.auth(api().post('/api/foods').send(food({ lifespanDays: 1 }))).expect(201);
    aliceFoodId = res.body.id;
    await alice.auth(api().post(`/api/foods/${aliceFoodId}/use`).send({ quantity: 0.5 })).expect(200);
  });

  it("never lists another user's food, Cook First items, history or reminders", async () => {
    expect((await bob.auth(api().get('/api/foods'))).body.items).toEqual([]);
    expect((await bob.auth(api().get('/api/foods/cook-first'))).body.items).toEqual([]);
    expect((await bob.auth(api().get('/api/usage'))).body.total).toBe(0);
    expect((await bob.auth(api().get('/api/notifications'))).body.items).toEqual([]);
  });

  it("cannot read, edit, use, waste or remove another user's item", async () => {
    const attempts = [
      api().get(`/api/foods/${aliceFoodId}`),
      api().put(`/api/foods/${aliceFoodId}`).send({ name: 'Mine now' }),
      api().post(`/api/foods/${aliceFoodId}/use`).send({}),
      api().post(`/api/foods/${aliceFoodId}/waste`).send({}),
      api().delete(`/api/foods/${aliceFoodId}`),
    ];
    for (const req of attempts) {
      const res = await bob.auth(req).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    const untouched = await FoodItemModel.findById(aliceFoodId);
    expect(untouched).toMatchObject({ name: 'Milk', status: 'ACTIVE', quantity: 0.5 });
  });

  it("marking all as read only affects the user's own reminders", async () => {
    await bob.auth(api().post('/api/notifications/read-all')).expect(204);
    const list = await alice.auth(api().get('/api/notifications')).expect(200);
    expect(list.body.unread).toBe(1);
  });
});
