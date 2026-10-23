import { beforeEach, describe, expect, it } from 'vitest';
import { api, food, registerUser, setToday } from './helpers.js';

/** Automatic expected-expiry estimation: nobody has to enter a lifespan. */

let s: Awaited<ReturnType<typeof registerUser>>;

beforeEach(async () => {
  setToday('2026-09-29');
  s = await registerUser();
});

/** A new food with no lifespan, added date or storage, unless given. */
const add = (body: Record<string, unknown>, expected = 201) =>
  s
    .auth(
      api()
        .post('/api/foods')
        .send({ quantity: 1, unit: 'pcs', ...body }),
    )
    .expect(expected)
    .then((r) => r.body);

describe('creating a food without a lifespan', () => {
  it("uses today, the catalog's usual place and the catalog lifespan", async () => {
    const res = await add({ name: 'Bread', unit: 'pack' });
    expect(res).toMatchObject({
      addedDate: '2026-09-29',
      storage: 'PANTRY',
      lifespanDays: 4,
      expiryDate: '2026-10-03',
      expirySource: 'CATALOG',
      printedDate: null,
      printedDateType: null,
    });
    expect(res.estimateExplanation).toMatch(/lasts about 4 days/);
  });

  it('uses the category default for a food the catalog does not know', async () => {
    const res = await add({ name: 'Kefir', unit: 'l', category: 'Dairy product' });
    expect(res).toMatchObject({ storage: 'FRIDGE', lifespanDays: 7, expirySource: 'CATEGORY_DEFAULT' });
  });

  it('falls back to a rough estimate, in the fridge', async () => {
    const res = await add({ name: 'Mystery jar' });
    expect(res).toMatchObject({ storage: 'FRIDGE', lifespanDays: 3, expirySource: 'FALLBACK' });
  });

  it('uses the receipt date as the added date when one is given', async () => {
    const res = await add({ name: 'Milk', unit: 'l', addedDate: '2026-09-27' });
    expect(res).toMatchObject({ addedDate: '2026-09-27', expiryDate: '2026-10-02', lifespanDays: 5 });
  });

  it('uses a printed date when it is the earliest', async () => {
    const res = await add({ name: 'Milk', unit: 'l', printedDate: '2026-10-01', printedDateType: 'USE_BY' });
    expect(res).toMatchObject({
      expirySource: 'PRINTED_DATE',
      expiryDate: '2026-10-01',
      printedDate: '2026-10-01',
      printedDateType: 'USE_BY',
    });
  });

  it('ignores a printed date more than two years away, and keeps none of it', async () => {
    const res = await add({ name: 'Milk', unit: 'l', printedDate: '2029-01-01', printedDateType: 'BEST_BEFORE' });
    expect(res).toMatchObject({ expirySource: 'CATALOG', printedDate: null, printedDateType: null });
  });

  it('ignores a printed date more than 30 days in the past', async () => {
    const res = await add({ name: 'Milk', unit: 'l', printedDate: '2026-08-01', printedDateType: 'BEST_BEFORE' });
    expect(res).toMatchObject({ expirySource: 'CATALOG', printedDate: null });
  });

  it('keeps a printed date from a few days ago, as due today rather than before it was added', async () => {
    const res = await add({ name: 'Milk', unit: 'l', printedDate: '2026-09-25', printedDateType: 'USE_BY' });
    expect(res).toMatchObject({ expirySource: 'PRINTED_DATE', expiryDate: '2026-09-29', lifespanDays: 0 });
  });

  it('applies a learned lifespan only when it is shorter than the catalog', async () => {
    await add({ name: 'Milk', unit: 'l', lifespanDays: 2 });
    await add({ name: 'Milk', unit: 'l', lifespanDays: 2 });
    const shorter = await add({ name: 'Milk', unit: 'l' });
    expect(shorter).toMatchObject({ expirySource: 'LEARNED', lifespanDays: 2 });

    await add({ name: 'Eggs', lifespanDays: 40 });
    await add({ name: 'Eggs', lifespanDays: 40 });
    const longer = await add({ name: 'Eggs' });
    expect(longer).toMatchObject({ expirySource: 'CATALOG', lifespanDays: 21 });
  });

  it('does not learn from estimated lifespans', async () => {
    await add({ name: 'Bread', unit: 'pack' });
    await add({ name: 'Bread', unit: 'pack' });
    const learned = await s.auth(api().get('/api/suggestions/lifespans')).expect(200);
    expect(learned.body.items).toEqual([]);
  });

  it('sets the source to USER when a lifespan is given', async () => {
    const res = await add({ name: 'Milk', unit: 'l', lifespanDays: 9 });
    expect(res).toMatchObject({ expirySource: 'USER', lifespanDays: 9, expiryDate: '2026-10-08' });
    expect(res.estimateExplanation).toBe('You set this expected expiry.');
  });

  it('keeps leftovers within their short lifespan', async () => {
    const res = await add({ name: 'Chicken curry', unit: 'g', leftover: true });
    expect(res.lifespanDays).toBeLessThanOrEqual(4);
  });
});

describe('editing and recalculating', () => {
  it('editing the lifespan sets the source to USER', async () => {
    const { id } = await add({ name: 'Bread', unit: 'pack' });
    const res = await s.auth(api().put(`/api/foods/${id}`).send({ lifespanDays: 6 })).expect(200);
    expect(res.body).toMatchObject({ expirySource: 'USER', lifespanDays: 6, expiryDate: '2026-10-05' });
  });

  it('editing something else keeps the estimate and its source', async () => {
    const { id } = await add({ name: 'Bread', unit: 'pack' });
    const res = await s.auth(api().put(`/api/foods/${id}`).send({ notes: 'Sourdough' })).expect(200);
    expect(res.body).toMatchObject({ expirySource: 'CATALOG', lifespanDays: 4 });
  });

  it('a printed date stays put when the added date is edited', async () => {
    const { id } = await add({ name: 'Milk', unit: 'l', printedDate: '2026-10-01', printedDateType: 'USE_BY' });
    const res = await s.auth(api().put(`/api/foods/${id}`).send({ addedDate: '2026-09-28' })).expect(200);
    expect(res.body).toMatchObject({ expiryDate: '2026-10-01', lifespanDays: 3 });
  });

  it('opening re-estimates and only ever shortens the expected expiry', async () => {
    const milk = await add({ name: 'Milk', unit: 'l' });
    const opened = await s.auth(api().post(`/api/foods/${milk.id}/open`).send({})).expect(200);
    expect(opened.body).toMatchObject({ expiryDate: '2026-10-03', expirySource: 'CATALOG' });
    expect(opened.body.estimateExplanation).toMatch(/once opened/);

    const cheese = await add({ name: 'Hard cheese', unit: 'g' });
    const same = await s.auth(api().post(`/api/foods/${cheese.id}/open`).send({})).expect(200);
    expect(same.body.expiryDate).toBe(cheese.expiryDate);
  });

  it('undoing "Opened" restores the earlier source and explanation', async () => {
    const milk = await add({ name: 'Milk', unit: 'l' });
    await s.auth(api().post(`/api/foods/${milk.id}/open`).send({})).expect(200);
    const undone = await s.auth(api().delete(`/api/foods/${milk.id}/open`)).expect(200);
    expect(undone.body).toMatchObject({
      expirySource: 'CATALOG',
      estimateExplanation: milk.estimateExplanation,
      expiryDate: milk.expiryDate,
    });
  });

  it('moving never extends an estimate; choosing the days does, as USER', async () => {
    const chicken = await add({ name: 'Chicken', unit: 'g' });
    const moved = await s.auth(api().post(`/api/foods/${chicken.id}/move`).send({ storage: 'FREEZER' })).expect(200);
    expect(moved.body.expiryDate).toBe(chicken.expiryDate);

    const chosen = await add({ name: 'Chicken', unit: 'g' });
    const extended = await s
      .auth(api().post(`/api/foods/${chosen.id}/move`).send({ storage: 'FREEZER', daysLeft: 90 }))
      .expect(200);
    expect(extended.body).toMatchObject({ expirySource: 'USER', expiryDate: '2026-12-28' });
  });

  it('moving to a place with no figure shortens to the rough estimate', async () => {
    const kefir = await add({ name: 'Kefir', unit: 'l', category: 'dairy' });
    const moved = await s.auth(api().post(`/api/foods/${kefir.id}/move`).send({ storage: 'PANTRY' })).expect(200);
    expect(moved.body).toMatchObject({ expirySource: 'FALLBACK', expiryDate: '2026-10-02' });
  });

  it('a rough estimate never replaces a date the person set', async () => {
    const kefir = await add({ name: 'Kefir', unit: 'l', lifespanDays: 20 });
    const moved = await s.auth(api().post(`/api/foods/${kefir.id}/move`).send({ storage: 'PANTRY' })).expect(200);
    expect(moved.body).toMatchObject({ expirySource: 'USER', expiryDate: kefir.expiryDate });
  });

  it('use-today (Photo Check) only brings the expected expiry forward', async () => {
    const milk = await add({ name: 'Milk', unit: 'l' });
    const res = await s.auth(api().post(`/api/foods/${milk.id}/use-today`)).expect(200);
    expect(res.body).toMatchObject({ expiryDate: '2026-09-29', expirySource: 'USER' });
    await s.auth(api().post(`/api/foods/${milk.id}/use-today`)).expect(409);
  });
});

describe('bulk add without lifespans', () => {
  it('estimates each row', async () => {
    const res = await s
      .auth(
        api()
          .post('/api/foods/bulk')
          .send({
            addedDate: '2026-09-29',
            items: [
              { name: 'Milk', quantity: 1, unit: 'l' },
              { name: 'Kefir', quantity: 1, unit: 'l', lifespanDays: 6 },
            ],
          }),
      )
      .expect(201);
    expect(res.body.items.map((i: { expirySource: string }) => i.expirySource)).toEqual(['CATALOG', 'USER']);
  });
});

describe('items with a lifespan given', () => {
  it('count as set by the person, with a plain explanation', async () => {
    const created = await s.auth(api().post('/api/foods').send(food())).expect(201);
    expect(created.body).toMatchObject({ expirySource: 'USER', estimateExplanation: 'You set this expected expiry.' });
  });
});
