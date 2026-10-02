import { beforeEach, describe, expect, it } from 'vitest';
import { HOUSEHOLD_MAX_MEMBERS, MAX_OPEN_INVITES } from '../config/household.js';
import { FoodItemModel } from '../models/FoodItem.js';
import { runMigrations } from '../models/migrations.js';
import { UsageRecordModel } from '../models/UsageRecord.js';
import { UserModel } from '../models/User.js';
import { clock } from '../services/clock.js';
import { api, food, registerUser, setToday } from './helpers.js';

/** Phase 6: shared households, invites and the activity log. */

type Session = Awaited<ReturnType<typeof registerUser>>;

beforeEach(() => {
  setToday('2026-09-29');
});

const get = (who: Session, path: string) => who.auth(api().get(path));
const post = (who: Session, path: string, body: Record<string, unknown> = {}) => who.auth(api().post(path).send(body));
const household = async (who: Session) => (await get(who, '/api/household').expect(200)).body;
const invite = async (who: Session) => (await post(who, '/api/household/invites').expect(201)).body.code as string;
const join = (who: Session, code: string) => post(who, '/api/household/join', { code });
const addFood = async (who: Session, overrides: Record<string, unknown> = {}) =>
  (await post(who, '/api/foods', food(overrides)).expect(201)).body;
const foodNames = async (who: Session) =>
  ((await get(who, '/api/foods').expect(200)).body.items as { name: string }[]).map((f) => f.name).sort();

/** Two people in one household: `host` invited `guest`, who joined. */
async function pair() {
  const host = await registerUser({ name: 'Alice' });
  const guest = await registerUser({ name: 'Bob' });
  await join(guest, await invite(host)).expect(200);
  return { host, guest };
}

describe('a household of one', () => {
  it('everyone starts in one, alone, with no invites', async () => {
    const a = await registerUser({ name: 'Alice' });
    const h = await household(a);
    expect(h.members).toEqual([{ id: a.user.id, name: 'Alice', isYou: true }]);
    expect(h.invites).toEqual([]);
    expect(h.maxMembers).toBe(HOUSEHOLD_MAX_MEMBERS);
  });

  it('needs a signed-in user for every household route', async () => {
    await api().get('/api/household').expect(401);
    await api().post('/api/household/invites').expect(401);
    await api().post('/api/household/join').send({ code: 'ABCD-EFGH' }).expect(401);
    await api().post('/api/household/leave').expect(401);
    await api().get('/api/household/activity').expect(401);
  });

  it('cannot leave when alone', async () => {
    const a = await registerUser();
    const res = await post(a, '/api/household/leave').expect(409);
    expect(res.body.error.message).toBe('You aren’t in a shared household.');
  });
});

describe('invites', () => {
  it('make a code that works for a week, shown as XXXX-XXXX without confusing characters', async () => {
    const a = await registerUser({ name: 'Alice' });
    const res = await post(a, '/api/household/invites').expect(201);
    expect(res.body.code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(res.body.createdBy).toBe('Alice');
    expect(res.body.expiresAt).toBe('2026-10-06T12:00:00.000Z');
    expect((await household(a)).invites).toHaveLength(1);
  });

  it('are limited in number, and can be cancelled', async () => {
    const a = await registerUser();
    const codes: string[] = [];
    for (let i = 0; i < MAX_OPEN_INVITES; i++) codes.push(await invite(a));
    await post(a, '/api/household/invites').expect(409);
    await a.auth(api().delete(`/api/household/invites/${codes[0]}`)).expect(204);
    await a.auth(api().delete(`/api/household/invites/${codes[0]}`)).expect(404);
    await invite(a);
  });

  it('can be cancelled only by someone in that household', async () => {
    const a = await registerUser();
    const stranger = await registerUser();
    const code = await invite(a);
    await stranger.auth(api().delete(`/api/household/invites/${code}`)).expect(404);
    expect((await household(a)).invites).toHaveLength(1);
  });

  it('stop being listed once they expire', async () => {
    const a = await registerUser();
    await invite(a);
    clock.set(new Date('2026-10-07T12:00:00Z'));
    expect((await household(a)).invites).toEqual([]);
  });
});

describe('joining', () => {
  it('moves you into their household, and the code works once', async () => {
    const host = await registerUser({ name: 'Alice' });
    const guest = await registerUser({ name: 'Bob' });
    const late = await registerUser({ name: 'Cleo' });
    const code = await invite(host);
    const res = await join(guest, code).expect(200);
    expect(res.body.members.map((m: { name: string }) => m.name)).toEqual(['Alice', 'Bob']);
    expect(res.body.invites).toEqual([]);
    expect((await household(host)).members).toHaveLength(2);
    const again = await join(late, code).expect(400);
    expect(again.body.error).toMatchObject({ code: 'VALIDATION_ERROR', field: 'code' });
  });

  it('accepts the code in lower case, with spaces or without the dash', async () => {
    const host = await registerUser();
    const guest = await registerUser();
    const code = await invite(host);
    await join(guest, ` ${code.toLowerCase().replace('-', ' ')} `).expect(200);
  });

  it('rejects an unknown, empty or expired code', async () => {
    const host = await registerUser();
    const guest = await registerUser();
    const code = await invite(host);
    await join(guest, 'ZZZZ-ZZZZ').expect(400);
    await post(guest, '/api/household/join', { code: '' }).expect(400);
    await post(guest, '/api/household/join', {}).expect(400);
    clock.set(new Date('2026-10-07T12:00:00Z'));
    const res = await join(guest, code).expect(400);
    expect(res.body.error.message).toBe('That invite code isn’t valid, or it is out of date.');
    expect(await household(guest)).toMatchObject({ members: [{ isYou: true }] });
  });

  it('refuses your own household’s invite', async () => {
    const a = await registerUser();
    const res = await join(a, await invite(a)).expect(400);
    expect(res.body.error.message).toBe('That invite is from your own household.');
  });

  it('refuses someone who is already in a shared household, and leaves the code unused', async () => {
    const { guest } = await pair();
    const other = await registerUser();
    const code = await invite(other);
    const res = await join(guest, code).expect(409);
    expect(res.body.error.message).toBe('Leave your current household before joining another.');
    const newcomer = await registerUser();
    await join(newcomer, code).expect(200);
  });

  it('refuses when the household is full', async () => {
    const host = await registerUser();
    // Two codes made while there is room; the household then fills up.
    const early = await invite(host);
    const stale = await invite(host);
    for (let i = 1; i < HOUSEHOLD_MAX_MEMBERS - 1; i++)
      await join(await registerUser(), await invite(host)).expect(200);
    await join(await registerUser(), early).expect(200);
    expect((await household(host)).members).toHaveLength(HOUSEHOLD_MAX_MEMBERS);
    const res = await join(await registerUser(), stale).expect(409);
    expect(res.body.error.message).toBe('That household is full.');
    await post(host, '/api/household/invites').expect(409);
  });

  it('brings your own food, shopping list and meal plan, and the host’s meal wins on a shared day', async () => {
    const host = await registerUser({ name: 'Alice' });
    const guest = await registerUser({ name: 'Bob' });
    await addFood(host, { name: 'Milk' });
    await addFood(guest, { name: 'Bread' });
    await post(guest, '/api/shopping', { name: 'Flour' }).expect(201);
    await guest.auth(api().put('/api/meal-plan/2026-09-30').send({ title: 'Bob’s toast', foodIds: [] })).expect(200);
    await guest.auth(api().put('/api/meal-plan/2026-10-01').send({ title: 'Bob’s soup', foodIds: [] })).expect(200);
    await host.auth(api().put('/api/meal-plan/2026-09-30').send({ title: 'Alice’s curry', foodIds: [] })).expect(200);

    await join(guest, await invite(host)).expect(200);

    for (const who of [host, guest]) {
      expect(await foodNames(who)).toEqual(['Bread', 'Milk']);
      const shopping = (await get(who, '/api/shopping').expect(200)).body.items;
      expect(shopping.map((i: { name: string }) => i.name)).toEqual(['Flour']);
      const plan = (await get(who, '/api/meal-plan').expect(200)).body.days;
      const titles = plan.map((d: { entry: { title: string } | null }) => d.entry?.title ?? null);
      expect(titles.slice(0, 3)).toEqual([null, 'Alice’s curry', 'Bob’s soup']);
    }
  });
});

describe('sharing within a household', () => {
  it('everyone sees and can act on the same food, and the history and insights are shared', async () => {
    const { host, guest } = await pair();
    const milk = await addFood(host, { name: 'Milk', price: 2 });
    expect(await foodNames(guest)).toEqual(['Milk']);
    await get(guest, `/api/foods/${milk.id}`).expect(200);
    await post(guest, `/api/foods/${milk.id}/waste`).expect(200);

    expect(await foodNames(host)).toEqual([]);
    for (const who of [host, guest]) {
      const history = (await get(who, '/api/usage').expect(200)).body;
      expect(history.items).toHaveLength(1);
      expect(history.items[0]).toMatchObject({ foodName: 'Milk', action: 'WASTED' });
      const insights = (await get(who, '/api/insights').expect(200)).body;
      expect(insights.thisWeek).toMatchObject({ wasted: 1, lostValue: 2 });
    }
    // Either person can undo it.
    await post(host, `/api/foods/${milk.id}/undo`).expect(200);
    expect(await foodNames(guest)).toEqual(['Milk']);
  });

  it('the shopping list and meal plan are shared, and a shopping item warns about food anyone has', async () => {
    const { host, guest } = await pair();
    await addFood(host, { name: 'Milk' });
    const item = (await post(guest, '/api/shopping', { name: 'Milk' }).expect(201)).body;
    expect(item.atHome).toHaveLength(1);
    await host.auth(api().put(`/api/shopping/${item.id}`).send({ checked: true })).expect(200);
    await host.auth(api().post('/api/shopping/clear-checked')).expect(204);
    expect((await get(guest, '/api/shopping').expect(200)).body.items).toEqual([]);
    const milk = (await get(guest, '/api/foods').expect(200)).body.items[0];
    await host
      .auth(
        api()
          .put('/api/meal-plan/2026-09-30')
          .send({ title: 'Porridge', foodIds: [milk.id] }),
      )
      .expect(200);
    const plan = (await get(guest, '/api/meal-plan').expect(200)).body.days[1].entry;
    expect(plan).toMatchObject({ title: 'Porridge' });
    expect(plan.foods).toHaveLength(1);
  });

  it('favourites, reminders settings and the currency stay personal', async () => {
    const { host, guest } = await pair();
    await post(host, '/api/favourites', { name: 'Eggs', quantity: 6, unit: 'pcs', lifespanDays: 14 }).expect(201);
    expect((await get(guest, '/api/favourites').expect(200)).body.items).toEqual([]);
    await guest.auth(api().put('/api/auth/me').send({ currency: 'CAD' })).expect(200);
    expect((await get(host, '/api/auth/me').expect(200)).body.user.currency).toBe('USD');
  });

  it('gives every member a reminder for shared food, in their own list', async () => {
    const { host, guest } = await pair();
    await addFood(host, { name: 'Yoghurt', addedDate: '2026-09-29', lifespanDays: 0 });
    for (const who of [host, guest]) {
      const list = (await get(who, '/api/notifications').expect(200)).body.items;
      expect(list.map((n: { type: string }) => n.type)).toContain('DUE');
    }
  });

  it('reminders also cover food that came with a new member', async () => {
    const host = await registerUser({ name: 'Alice' });
    const guest = await registerUser({ name: 'Bob' });
    await addFood(guest, { name: 'Cream', addedDate: '2026-09-29', lifespanDays: 0 });
    await join(guest, await invite(host)).expect(200);
    const list = (await get(host, '/api/notifications').expect(200)).body.items;
    expect(list.map((n: { type: string }) => n.type)).toContain('DUE');
  });
});

describe('another household sees none of it', () => {
  it('cannot read, change or list a shared household’s food, history, list or plan', async () => {
    const { host, guest } = await pair();
    const outsider = await registerUser();
    const milk = await addFood(host, { name: 'Milk' });
    const item = (await post(guest, '/api/shopping', { name: 'Flour' }).expect(201)).body;
    await post(host, `/api/foods/${milk.id}/waste`).expect(200);
    await addFood(outsider, { name: 'Outsider’s jam' });

    expect(await foodNames(outsider)).toEqual(['Outsider’s jam']);
    expect((await get(outsider, '/api/usage').expect(200)).body.items).toEqual([]);
    expect((await get(outsider, '/api/shopping').expect(200)).body.items).toEqual([]);
    expect((await get(outsider, '/api/insights').expect(200)).body.thisWeek.wasted).toBe(0);
    await get(outsider, `/api/foods/${milk.id}`).expect(404);
    await post(outsider, `/api/foods/${milk.id}/use`, { quantity: 1 }).expect(404);
    await outsider.auth(api().put(`/api/shopping/${item.id}`).send({ checked: true })).expect(404);
    await outsider.auth(api().delete(`/api/shopping/${item.id}`)).expect(404);
    await outsider
      .auth(
        api()
          .put('/api/meal-plan/2026-09-30')
          .send({ title: 'x', foodIds: [milk.id] }),
      )
      .expect(400);
    expect(
      (await get(outsider, '/api/household/activity').expect(200)).body.items.map(
        (e: { foodName: string }) => e.foodName,
      ),
    ).toEqual(['Outsider’s jam']);
  });
});

describe('the activity log', () => {
  it('says who added, used, wasted or removed what, and who joined', async () => {
    const { host, guest } = await pair();
    const milk = await addFood(host, { name: 'Milk' });
    const bread = await addFood(guest, { name: 'Bread' });
    await post(guest, `/api/foods/${milk.id}/waste`).expect(200);
    await post(host, `/api/foods/${bread.id}/use`, { quantity: 1 }).expect(200);
    const log = (await get(host, '/api/household/activity').expect(200)).body;
    expect(log.hasMore).toBe(false);
    const lines = log.items.map((e: { type: string; actor: string; foodName: string | null }) =>
      `${e.actor} ${e.type} ${e.foodName ?? ''}`.trim(),
    );
    expect(lines).toEqual(
      expect.arrayContaining([
        'Alice FOOD_ADDED Milk',
        'Bob FOOD_ADDED Bread',
        'Bob WASTED Milk',
        'Alice USED Bread',
        'Bob MEMBER_JOINED',
      ]),
    );
    expect(lines).toHaveLength(5);
    // Newest first.
    const times = log.items.map((e: { at: string }) => e.at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('pages', async () => {
    const { host } = await pair();
    for (let i = 0; i < 4; i++) await addFood(host, { name: `Item ${i}` });
    const first = (await get(host, '/api/household/activity?limit=3').expect(200)).body;
    expect(first.items).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    const second = (await get(host, '/api/household/activity?limit=3&offset=3').expect(200)).body;
    expect(second.items).toHaveLength(2);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.items, ...second.items].map((e: { id: string }) => e.id)).size).toBe(5);
  });
});

describe('leaving', () => {
  it('splits the household: you keep what you added, they keep the rest', async () => {
    const { host, guest } = await pair();
    const milk = await addFood(host, { name: 'Milk' });
    await addFood(guest, { name: 'Bread' });
    await post(host, '/api/shopping', { name: 'Eggs' }).expect(201);
    await post(guest, '/api/shopping', { name: 'Flour' }).expect(201);
    await post(guest, `/api/foods/${milk.id}/waste`).expect(200); // Bob wasted Alice's milk
    const bread = (await get(guest, '/api/foods').expect(200)).body.items.find(
      (f: { name: string }) => f.name === 'Bread',
    );
    await post(host, `/api/foods/${bread.id}/use`, { quantity: 1 }).expect(200); // Alice used Bob's bread

    const res = await post(guest, '/api/household/leave').expect(200);
    expect(res.body.members).toEqual([{ id: guest.user.id, name: 'Bob', isYou: true }]);
    expect((await household(host)).members.map((m: { name: string }) => m.name)).toEqual(['Alice']);

    expect(await foodNames(host)).toEqual([]); // the milk was wasted; the bread left with Bob
    await addFood(host, { name: 'Cheese' });
    expect(await foodNames(host)).toEqual(['Cheese']);
    expect(await foodNames(guest)).toEqual([]); // the bread was used
    expect((await get(host, '/api/shopping').expect(200)).body.items.map((i: { name: string }) => i.name)).toEqual([
      'Eggs',
    ]);
    expect((await get(guest, '/api/shopping').expect(200)).body.items.map((i: { name: string }) => i.name)).toEqual([
      'Flour',
    ]);

    // History follows the food: the wasted milk stays with Alice, the used bread went with Bob.
    expect((await get(host, '/api/usage').expect(200)).body.items.map((r: { foodName: string }) => r.foodName)).toEqual(
      ['Milk'],
    );
    expect(
      (await get(guest, '/api/usage').expect(200)).body.items.map((r: { foodName: string }) => r.foodName),
    ).toEqual(['Bread']);
  });

  it('records it in the log and ends access to each other’s food', async () => {
    const { host, guest } = await pair();
    const milk = await addFood(host, { name: 'Milk' });
    const bread = await addFood(guest, { name: 'Bread' });
    await post(guest, '/api/household/leave').expect(200);
    await get(guest, `/api/foods/${milk.id}`).expect(404);
    await get(host, `/api/foods/${bread.id}`).expect(404);
    const log = (await get(host, '/api/household/activity').expect(200)).body.items.map(
      (e: { actor: string; type: string }) => `${e.actor} ${e.type}`,
    );
    expect(log).toContain('Bob MEMBER_LEFT');
  });

  it('drops reminders for food that stayed behind, and keeps them for food that went along', async () => {
    const { host, guest } = await pair();
    await addFood(host, { name: 'Yoghurt', addedDate: '2026-09-29', lifespanDays: 0 });
    await addFood(guest, { name: 'Cream', addedDate: '2026-09-29', lifespanDays: 0 });
    expect((await get(guest, '/api/notifications').expect(200)).body.items).toHaveLength(2);
    await post(guest, '/api/household/leave').expect(200);
    const messages = (await get(guest, '/api/notifications').expect(200)).body.items.map(
      (n: { message: string }) => n.message,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Cream');
  });

  it('lets the same two people rejoin with a new invite', async () => {
    const { host, guest } = await pair();
    await post(guest, '/api/household/leave').expect(200);
    await join(guest, await invite(host)).expect(200);
    expect((await household(host)).members).toHaveLength(2);
  });
});

describe('deleting an account in a shared household', () => {
  it('removes only what that person added, and leaves the others’ food and history', async () => {
    const { host, guest } = await pair();
    const milk = await addFood(host, { name: 'Milk' });
    await addFood(guest, { name: 'Bread' });
    await post(host, '/api/shopping', { name: 'Eggs' }).expect(201);
    await post(guest, `/api/foods/${milk.id}/waste`).expect(200);

    await guest.auth(api().delete('/api/account').send({ password: guest.password })).expect(204);

    expect(await UserModel.exists({ _id: guest.user.id })).toBeNull();
    expect((await household(host)).members.map((m: { name: string }) => m.name)).toEqual(['Alice']);
    expect(await FoodItemModel.countDocuments({ userId: guest.user.id })).toBe(0);
    expect(await foodNames(host)).toEqual([]); // Alice's milk was wasted, and nothing else of hers was touched
    expect((await get(host, '/api/shopping').expect(200)).body.items).toHaveLength(1);
    // What Bob did to Alice's milk stays in her history, now with no name on it.
    const home = (await UserModel.findById(host.user.id))!.householdId;
    expect(await UsageRecordModel.countDocuments({ householdId: home })).toBe(1);
    const log = (await get(host, '/api/household/activity').expect(200)).body.items;
    expect(log.find((e: { type: string }) => e.type === 'WASTED').actor).toBe('A former member');
  });
});

describe('existing data', () => {
  it('is given its owner’s household when the server starts', async () => {
    const a = await registerUser();
    const item = await addFood(a, { name: 'Milk' });
    await post(a, `/api/foods/${item.id}/waste`).expect(200);
    await post(a, '/api/shopping', { name: 'Flour' }).expect(201);
    const collections = ['usagerecords', 'shoppingitems'];
    const { default: mongoose } = await import('mongoose');
    for (const name of collections)
      await mongoose.connection.collection(name).updateMany({}, { $unset: { householdId: '' } });
    await runMigrations();
    const home = (await UserModel.findById(a.user.id))!.householdId;
    for (const name of collections) {
      expect(await mongoose.connection.collection(name).countDocuments({ householdId: home })).toBe(1);
    }
    expect((await get(a, '/api/usage').expect(200)).body.items).toHaveLength(1);
    expect((await get(a, '/api/shopping').expect(200)).body.items).toHaveLength(1);
  });
});
