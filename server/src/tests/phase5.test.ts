import { hasBannedWording } from '@cook-first/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { api, food, registerUser, setToday } from './helpers.js';

/** Phase 5: insights (used versus wasted, optional prices, tips). */

let s: Awaited<ReturnType<typeof registerUser>>;

beforeEach(async () => {
  setToday('2026-09-29');
  s = await registerUser();
});

const create = (overrides: Record<string, unknown> = {}, who = s) =>
  who
    .auth(api().post('/api/foods').send(food(overrides)))
    .expect(201)
    .then((r) => r.body);
const use = (id: string, quantity: number, who = s) =>
  who.auth(api().post(`/api/foods/${id}/use`).send({ quantity })).expect(200);
const waste = (id: string, who = s) => who.auth(api().post(`/api/foods/${id}/waste`).send({})).expect(200);
const insights = (who = s) =>
  who
    .auth(api().get('/api/insights'))
    .expect(200)
    .then((r) => r.body);

describe('prices', () => {
  it('stores an optional price, shows it on the item, and rejects bad values', async () => {
    const item = await create({ price: 4.5 });
    expect(item.price).toBe(4.5);
    expect((await create()).price).toBeNull();
    for (const price of [-1, 100_001, 'free']) {
      await s.auth(api().post('/api/foods').send(food({ price }))).expect(400);
    }
  });

  it('can be added, changed and cleared when editing', async () => {
    const { id } = await create();
    const set = await s.auth(api().put(`/api/foods/${id}`).send({ price: 6 })).expect(200);
    expect(set.body.price).toBe(6);
    const cleared = await s.auth(api().put(`/api/foods/${id}`).send({ price: null })).expect(200);
    expect(cleared.body.price).toBeNull();
  });

  it('values a partly used item by the share that was used, and the rest when it is wasted', async () => {
    const { id } = await create({ quantity: 4, unit: 'pcs', price: 8 });
    const partial = await use(id, 1);
    expect(partial.body.usageRecord.value).toBe(2);
    const wasted = await waste(id);
    expect(wasted.body.usageRecord).toMatchObject({ quantityUsed: 3, value: 6 });
    const result = await insights();
    expect(result.thisWeek).toMatchObject({ used: 1, wasted: 1, savedValue: 2, lostValue: 6, pricedEntries: 2 });
  });

  it('shows the price of what is left after part of the item is used, and keeps it when saved again', async () => {
    const { id } = await create({ quantity: 4, unit: 'pcs', price: 8 });
    await use(id, 1);
    const left = await s.auth(api().get(`/api/foods/${id}`)).expect(200);
    expect(left.body).toMatchObject({ quantity: 3, price: 6 });
    // The edit form sends that price back unchanged; wasting the rest is still worth 6.
    await s.auth(api().put(`/api/foods/${id}`).send({ price: left.body.price })).expect(200);
    expect((await waste(id)).body.usageRecord.value).toBe(6);
  });

  it('prices the quantity the item has when the price is entered', async () => {
    const { id } = await create({ quantity: 4, unit: 'pcs' });
    await use(id, 2);
    await s.auth(api().put(`/api/foods/${id}`).send({ price: 3 })).expect(200); // 3 for the 2 left
    const wasted = await waste(id);
    expect(wasted.body.usageRecord.value).toBe(3);
  });

  it('gives no value to an item without a price or to a removal', async () => {
    const plain = await create();
    const removed = await create({ price: 5 });
    expect((await use(plain.id, 1)).body.usageRecord.value).toBeNull();
    await s.auth(api().delete(`/api/foods/${removed.id}`)).expect(204);
    const result = await insights();
    expect(result.thisWeek).toMatchObject({ used: 1, wasted: 0, savedValue: 0, pricedEntries: 0 });
  });
});

describe('GET /api/insights', () => {
  it('needs a signed-in user', async () => {
    await api().get('/api/insights').expect(401);
  });

  it('is empty for a new account: zeros, no rate, eight weeks, no tips', async () => {
    const result = await insights();
    expect(result.today).toBe('2026-09-29');
    expect(result.thisWeek).toEqual({
      used: 0,
      wasted: 0,
      wasteRate: null,
      savedValue: 0,
      lostValue: 0,
      pricedEntries: 0,
    });
    expect(result.weeks).toHaveLength(8);
    expect(result.weeks.at(-1)).toMatchObject({ from: '2026-09-23', to: '2026-09-29' });
    expect(result.weeks[0]).toMatchObject({ from: '2026-08-05', to: '2026-08-11' });
    expect(result.topWasted).toEqual([]);
    expect(result.tips).toEqual([]);
  });

  it('counts used and wasted entries and works out the waste rate', async () => {
    const a = await create({ name: 'Milk' });
    const b = await create({ name: 'Bread' });
    const c = await create({ name: 'Spinach' });
    await use(a.id, 1);
    await use(b.id, 1);
    await waste(c.id);
    const { thisWeek } = await insights();
    expect(thisWeek.used).toBe(2);
    expect(thisWeek.wasted).toBe(1);
    expect(thisWeek.wasteRate).toBeCloseTo(1 / 3);
  });

  it('puts each action in the week it happened, and compares with the week before', async () => {
    const old = await create({ name: 'Bread' });
    const recent = await create({ name: 'Milk' });
    setToday('2026-09-20'); // 9 days ago: last week
    await waste(old.id);
    setToday('2026-09-28'); // yesterday: this week
    await use(recent.id, 1);
    setToday('2026-09-29');
    const result = await insights();
    expect(result.thisWeek).toMatchObject({ used: 1, wasted: 0 });
    expect(result.lastWeek).toMatchObject({ used: 0, wasted: 1 });
    expect(result.weeks.at(-1)).toMatchObject({ used: 1, wasted: 0 });
    expect(result.weeks.at(-2)).toMatchObject({ used: 0, wasted: 1 });
  });

  it('ignores entries older than the eight weeks shown', async () => {
    const { id } = await create();
    setToday('2026-07-01');
    await waste(id);
    setToday('2026-09-29');
    const result = await insights();
    expect(result.weeks.reduce((n: number, w: { wasted: number }) => n + w.wasted, 0)).toBe(0);
    expect(result.last30Days.wasted).toBe(0);
  });

  it("never includes another user's history", async () => {
    const other = await registerUser();
    const theirs = await create({ price: 9 }, other);
    await waste(theirs.id, other);
    const result = await insights();
    expect(result.thisWeek.wasted).toBe(0);
    expect(result.topWasted).toEqual([]);
  });

  it('forgets an action that is undone', async () => {
    const { id } = await create({ price: 5 });
    await waste(id);
    await s.auth(api().post(`/api/foods/${id}/undo`)).expect(200);
    expect((await insights()).thisWeek).toMatchObject({ wasted: 0, lostValue: 0 });
  });
});

describe('most wasted foods and tips', () => {
  async function wasteTimes(name: string, times: number, price?: number) {
    for (let i = 0; i < times; i++) {
      const item = await create({ name, ...(price === undefined ? {} : { price }) });
      await waste(item.id);
    }
  }

  it('ranks foods by how often they were wasted, ignoring capital letters', async () => {
    await wasteTimes('Spinach', 2, 2);
    await wasteTimes('spinach', 1, 2);
    await wasteTimes('Bread', 1);
    const { topWasted } = await insights();
    expect(topWasted).toEqual([
      { name: 'Spinach', count: 3, lostValue: 6 },
      { name: 'Bread', count: 1, lostValue: 0 },
    ]);
  });

  it('names a food wasted repeatedly, and mentions the rise since last week', async () => {
    await wasteTimes('Spinach', 2);
    const { tips } = await insights();
    const ids = tips.map((t: { id: string }) => t.id);
    expect(ids).toContain('repeat-waste');
    expect(ids).toContain('waste-up');
    expect(tips.find((t: { id: string }) => t.id === 'repeat-waste').text).toContain('Spinach 2 times');
  });

  it('suggests adding prices until some entries have one', async () => {
    await wasteTimes('Bread', 1);
    expect((await insights()).tips.map((t: { id: string }) => t.id)).toContain('add-prices');
    await wasteTimes('Milk', 1, 3);
    expect((await insights()).tips.map((t: { id: string }) => t.id)).not.toContain('add-prices');
  });

  it('says so when nothing was wasted, and points at overdue food still at home', async () => {
    const a = await create({ name: 'Milk' });
    const b = await create({ name: 'Bread' });
    await use(a.id, 1);
    await use(b.id, 1);
    await create({ name: 'Spinach', addedDate: '2026-09-20', lifespanDays: 3 }); // overdue
    const ids = (await insights()).tips.map((t: { id: string }) => t.id);
    expect(ids).toContain('no-waste');
    expect(ids).toContain('overdue-now');
  });

  it('never uses banned wording', async () => {
    await wasteTimes('Spinach', 3);
    await create({ name: 'Old rice', addedDate: '2026-09-20', lifespanDays: 3 });
    const { tips } = await insights();
    expect(tips.length).toBeGreaterThan(1);
    for (const tip of tips) expect(hasBannedWording(tip.text), tip.text).toBe(false);
  });
});

describe('currency setting', () => {
  it('defaults to USD and can be changed to a listed currency', async () => {
    expect(s.user.currency).toBe('USD');
    const res = await s.auth(api().put('/api/auth/me').send({ currency: 'CAD' })).expect(200);
    expect(res.body.user.currency).toBe('CAD');
    const me = await s.auth(api().get('/api/auth/me')).expect(200);
    expect(me.body.user.currency).toBe('CAD');
  });

  it('rejects an unlisted currency', async () => {
    await s.auth(api().put('/api/auth/me').send({ currency: 'XYZ' })).expect(400);
  });
});
