import { beforeEach, describe, expect, it } from 'vitest';
import { FoodItemModel } from '../models/FoodItem.js';
import { router } from '../routes/index.js';
import { api, food, registerUser, setToday } from './helpers.js';

describe('cross-user isolation', () => {
  let alice: Awaited<ReturnType<typeof registerUser>>;
  let bob: Awaited<ReturnType<typeof registerUser>>;
  let aliceFoodId: string;

  beforeEach(async () => {
    setToday('2026-09-29');
    alice = await registerUser();
    bob = await registerUser();
    const res = await alice
      .auth(
        api()
          .post('/api/foods')
          .send(food({ lifespanDays: 1 })),
      )
      .expect(201);
    aliceFoodId = res.body.id;
    await alice.auth(api().post(`/api/foods/${aliceFoodId}/use`).send({ quantity: 0.5 })).expect(200);
  });

  it("never lists another user's food, FridgeStock items, history or reminders", async () => {
    expect((await bob.auth(api().get('/api/foods'))).body.items).toEqual([]);
    expect((await bob.auth(api().get('/api/foods/fridgestock'))).body.items).toEqual([]);
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

  it("cannot undo, open, move or bring forward another household's item: a 404, like a missing one", async () => {
    const attempts = [
      api().post(`/api/foods/${aliceFoodId}/undo`),
      api().post(`/api/foods/${aliceFoodId}/use-today`),
      api().post(`/api/foods/${aliceFoodId}/open`).send({ daysLeft: 3 }),
      api().delete(`/api/foods/${aliceFoodId}/open`),
      api().post(`/api/foods/${aliceFoodId}/move`).send({ storage: 'FREEZER', daysLeft: 30 }),
    ];
    for (const req of attempts) {
      const res = await bob.auth(req).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    const untouched = await FoodItemModel.findById(aliceFoodId);
    expect(untouched).toMatchObject({ status: 'ACTIVE', quantity: 0.5, storage: 'FRIDGE', openedDate: null });
    // Alice's own undo still has its usage record to reverse.
    await alice.auth(api().post(`/api/foods/${aliceFoodId}/undo`)).expect(200);
  });

  it("cannot remove or re-add another user's favourite", async () => {
    const favourite = await alice
      .auth(api().post('/api/favourites').send({ name: 'Eggs', quantity: 6, unit: 'pcs', lifespanDays: 14 }))
      .expect(201);
    await bob.auth(api().delete(`/api/favourites/${favourite.body.id}`)).expect(404);
    await bob.auth(api().post(`/api/favourites/${favourite.body.id}/add`)).expect(404);
    expect((await alice.auth(api().get('/api/favourites'))).body.items).toHaveLength(1);
    expect((await bob.auth(api().get('/api/foods'))).body.items).toEqual([]);
  });

  it("cannot plan a meal with another household's food", async () => {
    const res = await bob
      .auth(
        api()
          .put('/api/meal-plan/2026-09-30')
          .send({ title: 'Stolen milk', foodIds: [aliceFoodId] }),
      )
      .expect(400);
    expect(res.body.error.field).toBe('foodIds');
  });
});

describe('every route needs a login, except the public ones', () => {
  /** Every method and path the router registers, with a made-up value for each :param. */
  const routes = router.stack.flatMap((layer) => {
    const route = (layer as { route?: { path: string; methods: Record<string, boolean> } }).route;
    if (!route) return [];
    return Object.keys(route.methods).map((method) => ({ method, path: route.path }));
  });
  const PUBLIC = ['get /health', 'post /auth/register', 'post /auth/login', 'post /push/actions'];
  const sample = (path: string) => path.replace(/:[a-z]+/gi, (param) => (param === ':date' ? '2026-09-30' : 'abc'));
  const call = (method: string, path: string) =>
    (api() as unknown as Record<string, (url: string) => ReturnType<ReturnType<typeof api>['get']>>)[method]!(
      `/api${sample(path)}`,
    );

  it('finds all 68 routes', () => {
    expect(routes).toHaveLength(68);
  });

  it.each(routes.filter((r) => !PUBLIC.includes(`${r.method} ${r.path}`)))(
    '$method $path is a 401 without a token, and with a bad one',
    async ({ method, path }) => {
      const missing = await call(method, path).expect(401);
      expect(missing.body.error.code).toBe('UNAUTHENTICATED');
      await call(method, path).set('Authorization', 'Bearer not-a-token').expect(401);
    },
  );

  it.each(PUBLIC)('%s answers without a token', async (entry) => {
    const [method, path] = entry.split(' ') as [string, string];
    const res = await call(method, path);
    expect(res.status).not.toBe(401);
  });
});
