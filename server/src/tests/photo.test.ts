import { BANNED_PHRASES, WARNING_SIGN_TYPES } from '@fridgestock/shared';
import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_DAILY_LIMIT } from '../config/ai.js';
import { setPhotoCheckEnabled } from '../config/features.js';
import { AiUsageModel } from '../models/AiUsage.js';
import { FoodItemModel } from '../models/FoodItem.js';
import { HouseholdEventModel } from '../models/HouseholdEvent.js';
import { NotificationModel } from '../models/Notification.js';
import { setAiClient, type AiRequest } from '../services/aiClient.js';
import { api, food, registerUser, setToday } from './helpers.js';

/** Phase 7: Photo Check. Every AI call goes to a fake client; no test reaches the real API. */

// Banned phrases are taken from the shared list so this file never spells them out (the source guard scans it).
const SAFE_TO_EAT = BANNED_PHRASES[1];

type Session = Awaited<ReturnType<typeof registerUser>>;

beforeEach(() => {
  setToday('2026-09-29');
  setPhotoCheckEnabled(true);
});

afterEach(() => {
  setPhotoCheckEnabled(null);
  setAiClient(null);
  vi.restoreAllMocks();
});

/** A fake AI that returns the given answers in turn (an Error is thrown instead). */
function fakeAi(...answers: unknown[]) {
  const calls: AiRequest[] = [];
  setAiClient({
    model: 'fake-model',
    async generate(request) {
      calls.push(request);
      const answer = answers.length > 1 ? answers.shift() : answers[0];
      if (answer instanceof Error) throw answer;
      return structuredClone(answer);
    },
  });
  return calls;
}

const PHOTO = Buffer.from('a photo of some food, as base64 text').toString('base64');
const check = (s: Session, body: Record<string, unknown> = {}) =>
  s.auth(
    api()
      .post('/api/parse/photo')
      .send({ mediaType: 'image/jpeg', image: PHOTO, ...body }),
  );

const sure = { name: 'Milk', category: 'dairy', confidence: 0.92, warningSigns: [] };
const mouldy = {
  name: 'Bread',
  category: 'bakery',
  confidence: 0.8,
  warningSigns: [{ type: 'MOULD', description: 'green patches on the crust' }],
};

const add = async (s: Session, overrides: Record<string, unknown> = {}) =>
  (await s.auth(api().post('/api/foods').send(food(overrides))).expect(201)).body as {
    id: string;
    name: string;
    expiryDate: string;
  };

describe('availability: a feature flag, and AI', () => {
  it('needs a signed-in user', async () => {
    await api().post('/api/parse/photo').send({ mediaType: 'image/jpeg', image: PHOTO }).expect(401);
  });

  it('is off when the flag is off, even with AI on', async () => {
    fakeAi(sure);
    setPhotoCheckEnabled(false);
    const s = await registerUser();
    const res = await check(s).expect(503);
    expect(res.body.error).toMatchObject({
      code: 'AI_UNAVAILABLE',
      message: 'Photo Check isn’t turned on for this app.',
    });
    expect((await s.auth(api().get('/api/ai/status')).expect(200)).body).toMatchObject({
      enabled: true,
      photoCheck: false,
    });
  });

  it('is off when AI is off, even with the flag on', async () => {
    const s = await registerUser();
    await check(s).expect(503);
    expect((await s.auth(api().get('/api/ai/status')).expect(200)).body).toMatchObject({
      enabled: false,
      photoCheck: false,
    });
  });

  it('is on only when both are on', async () => {
    fakeAi(sure);
    const s = await registerUser();
    expect((await s.auth(api().get('/api/ai/status')).expect(200)).body).toMatchObject({
      enabled: true,
      photoCheck: true,
    });
  });
});

describe('POST /api/parse/photo', () => {
  it('rejects a missing, unsupported or malformed photo, or a bad food id, before asking the AI', async () => {
    const calls = fakeAi(sure);
    const s = await registerUser();
    await check(s, { image: '' }).expect(400);
    await check(s, { mediaType: 'image/gif' }).expect(400);
    await check(s, { image: `data:image/jpeg;base64,${PHOTO}` }).expect(400);
    const bad = await check(s, { foodId: 'not-an-id' }).expect(400);
    expect(bad.body.error).toMatchObject({ field: 'foodId', message: 'Choose one of your own food items.' });
    expect(calls).toEqual([]);
  });

  it('sends the photo with a prompt that allows only problems, and returns the answer', async () => {
    const calls = fakeAi(mouldy);
    const s = await registerUser();
    const res = await check(s).expect(200);
    expect(res.body).toEqual(mouldy);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.images).toEqual([{ mediaType: 'image/jpeg', base64: PHOTO }]);
    expect(calls[0]!.system).toContain('report only what you can see');
    for (const type of WARNING_SIGN_TYPES) expect(calls[0]!.prompt).toContain(type);
  });

  it('has no field for good or normal condition: the schema is name, category, confidence and warning signs', async () => {
    const calls = fakeAi(sure);
    const s = await registerUser();
    await check(s).expect(200);
    const schema = calls[0]!.schema as { properties: Record<string, unknown>; additionalProperties: boolean };
    expect(Object.keys(schema.properties).sort()).toEqual(['category', 'confidence', 'name', 'warningSigns']);
    expect(schema.additionalProperties).toBe(false);
    const sign = (schema.properties.warningSigns as { items: { properties: { type: { enum: string[] } } } }).items;
    expect(sign.properties.type.enum).toEqual([...WARNING_SIGN_TYPES]);
  });

  it('refuses any answer outside that shape, asks again, then gives up and refunds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = await registerUser();
    const outside: unknown[] = [
      { ...sure, condition: 'looks fine' }, // an extra field
      { ...sure, warningSigns: [{ type: 'LOOKS_FINE', description: 'nothing wrong' }] }, // a type that isn't a problem
      { ...sure, warningSigns: [{ type: 'MOULD', description: 'mould', fresh: true }] },
      { ...sure, confidence: 1.4 },
      { ...sure, name: '' },
    ];
    for (const answer of outside) {
      const calls = fakeAi(answer);
      const res = await check(s).expect(503);
      expect(res.body.error.code).toBe('AI_UNAVAILABLE');
      expect(calls, JSON.stringify(answer)).toHaveLength(3);
    }
    expect((await AiUsageModel.findOne({ date: '2026-09-29' }))!.count).toBe(0);
  });

  it('asks again when any text breaks the wording rules, including a warning sign, and never returns it', async () => {
    const dodgy = {
      ...mouldy,
      warningSigns: [{ type: 'MOULD', description: `green patches, but ${SAFE_TO_EAT}` }],
    };
    const calls = fakeAi(dodgy, mouldy);
    const s = await registerUser();
    const res = await check(s).expect(200);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(res.body)).not.toContain(SAFE_TO_EAT);
    expect(calls[1]!.prompt).toContain('wording');
    // The same for the name and the category.
    const named = fakeAi({ ...sure, name: `Beans, ${SAFE_TO_EAT}` }, sure);
    await check(s).expect(200);
    expect(named).toHaveLength(2);
  });

  it('counts toward the daily AI allowance, and stops at the limit', async () => {
    fakeAi(sure);
    const s = await registerUser();
    await check(s).expect(200);
    expect((await AiUsageModel.findOne({ date: '2026-09-29' }))!.count).toBe(1);
    await AiUsageModel.updateOne({ date: '2026-09-29' }, { $set: { count: AI_DAILY_LIMIT } });
    expect((await check(s).expect(429)).body.error.code).toBe('RATE_LIMITED');
  });

  it('accepts a large photo and never stores it', async () => {
    const marker = 'UEhPVE9DSEVDS01BUktFUg';
    fakeAi(sure);
    const s = await registerUser();
    await check(s, { image: marker + 'A'.repeat(3_900_000) }).expect(200);
    for (const collection of await mongoose.connection.db!.collections()) {
      const docs = await collection.find({}).toArray();
      expect(JSON.stringify(docs), collection.collectionName).not.toContain(marker);
    }
  });

  it('changes nothing: no food is added or altered, whatever the photo shows', async () => {
    fakeAi(mouldy);
    const s = await registerUser();
    const bread = await add(s, { name: 'Bread', lifespanDays: 5 });
    await check(s, { foodId: bread.id }).expect(200);
    await check(s).expect(200);
    const after = await FoodItemModel.find({});
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ expiryDate: bread.expiryDate, status: 'ACTIVE', lifespanDays: 5 });
  });
});

describe('a photo of an item at home', () => {
  it('must be one of the household’s items', async () => {
    const calls = fakeAi(sure);
    const s = await registerUser();
    const other = await registerUser();
    const theirs = await add(other, { name: 'Their jam' });
    await check(s, { foodId: theirs.id }).expect(404);
    await check(s, { foodId: '0'.repeat(24) }).expect(404);
    expect(calls).toEqual([]);
  });

  it('can be of any item in a shared household', async () => {
    fakeAi(sure);
    const host = await registerUser({ name: 'Alice' });
    const guest = await registerUser({ name: 'Bob' });
    const code = (await host.auth(api().post('/api/household/invites')).expect(201)).body.code;
    await guest.auth(api().post('/api/household/join').send({ code })).expect(200);
    const milk = await add(host, { name: 'Milk' });
    await check(guest, { foodId: milk.id }).expect(200);
  });
});

describe('the activity log', () => {
  it('records who checked which food, but never the photo or what it showed', async () => {
    fakeAi(mouldy);
    const s = await registerUser({ name: 'Priya' });
    const bread = await add(s, { name: 'Sourdough' });
    await check(s, { foodId: bread.id }).expect(200); // the item's own name is used
    await check(s).expect(200); // no item yet: the name the AI gave
    const log = (await s.auth(api().get('/api/household/activity')).expect(200)).body.items.filter(
      (e: { type: string }) => e.type === 'PHOTO_CHECKED',
    );
    expect(log.map((e: { actor: string; foodName: string }) => `${e.actor}: ${e.foodName}`).sort()).toEqual([
      'Priya: Bread',
      'Priya: Sourdough',
    ]);
    const stored = JSON.stringify(await HouseholdEventModel.find({ type: 'PHOTO_CHECKED' }));
    expect(stored).not.toMatch(/MOULD|green patches|confidence/);
  });

  it('records nothing for a check that failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fakeAi(new Error('boom'));
    const s = await registerUser();
    await check(s).expect(503);
    expect(await HouseholdEventModel.countDocuments({ type: 'PHOTO_CHECKED' })).toBe(0);
  });
});

describe('POST /api/foods/:id/use-today (the expected expiry only ever moves earlier)', () => {
  it('needs a signed-in user', async () => {
    await api()
      .post(`/api/foods/${'0'.repeat(24)}/use-today`)
      .expect(401);
  });

  it('brings a later expected expiry forward to today', async () => {
    const s = await registerUser();
    const milk = await add(s, { name: 'Milk', addedDate: '2026-09-27', lifespanDays: 6 }); // due 10-03
    const res = await s.auth(api().post(`/api/foods/${milk.id}/use-today`)).expect(200);
    expect(res.body).toMatchObject({ expiryDate: '2026-09-29', lifespanDays: 2, remainingDays: 0, urgency: 'DUE' });
    const list = (await s.auth(api().get('/api/foods/fridgestock')).expect(200)).body.items;
    expect(list.map((i: { name: string }) => i.name)).toEqual(['Milk']);
  });

  it('refuses an item that is already due today or overdue, and leaves it exactly as it was', async () => {
    const s = await registerUser();
    const due = await add(s, { name: 'Yoghurt', addedDate: '2026-09-29', lifespanDays: 0 });
    const late = await add(s, { name: 'Bread', addedDate: '2026-09-20', lifespanDays: 3 });
    for (const item of [due, late]) {
      const res = await s.auth(api().post(`/api/foods/${item.id}/use-today`)).expect(409);
      expect(res.body.error.message).toBe('This item is already due today or overdue.');
      expect((await FoodItemModel.findById(item.id))!.expiryDate).toBe(item.expiryDate);
    }
  });

  it('can never move an expected expiry later, whatever the item', async () => {
    const s = await registerUser();
    for (const lifespanDays of [0, 1, 2, 9, 40]) {
      for (const addedDate of ['2026-09-29', '2026-09-25', '2026-08-01']) {
        const item = await add(s, { name: `F${lifespanDays}${addedDate}`, addedDate, lifespanDays });
        const before = item.expiryDate;
        const res = await s.auth(api().post(`/api/foods/${item.id}/use-today`));
        const after = (await FoodItemModel.findById(item.id))!.expiryDate;
        expect(after <= before, `${addedDate}+${lifespanDays}: ${before} -> ${after}`).toBe(true);
        expect([200, 409]).toContain(res.status);
      }
    }
  });

  it('reschedules the reminders, and does not change what you entered (so usual lifespans are not learned from it)', async () => {
    const s = await registerUser();
    const milk = await add(s, { name: 'Milk', addedDate: '2026-09-27', lifespanDays: 6 });
    await s.auth(api().post(`/api/foods/${milk.id}/use-today`)).expect(200);
    const doc = (await FoodItemModel.findById(milk.id))!;
    expect(doc.enteredLifespanDays).toBe(6);
    const reminders = await NotificationModel.find({ foodId: milk.id });
    expect(reminders.map((n) => `${n.type}:${n.scheduledDate}`).sort()).toEqual([
      'DUE:2026-09-29',
      'OVERDUE:2026-09-30',
    ]);
  });

  it('refuses a closed item, and another household’s item', async () => {
    const s = await registerUser();
    const other = await registerUser();
    const used = await add(s, { name: 'Milk', lifespanDays: 6 });
    await s.auth(api().post(`/api/foods/${used.id}/waste`).send({})).expect(200);
    await s.auth(api().post(`/api/foods/${used.id}/use-today`)).expect(409);
    const theirs = await add(other, { name: 'Jam', lifespanDays: 6 });
    await s.auth(api().post(`/api/foods/${theirs.id}/use-today`)).expect(404);
    expect((await FoodItemModel.findById(theirs.id))!.expiryDate).toBe(theirs.expiryDate);
  });

  it('works for any member of a shared household', async () => {
    const host = await registerUser({ name: 'Alice' });
    const guest = await registerUser({ name: 'Bob' });
    const code = (await host.auth(api().post('/api/household/invites')).expect(201)).body.code;
    await guest.auth(api().post('/api/household/join').send({ code })).expect(200);
    const milk = await add(host, { name: 'Milk', lifespanDays: 6 });
    await guest.auth(api().post(`/api/foods/${milk.id}/use-today`)).expect(200);
  });
});
