import { BANNED_PHRASES, hasBannedWording } from '@fridgestock/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_DAILY_LIMIT } from '../config/ai.js';
import { DEFAULT_AI_MODEL, env } from '../config/env.js';
import { AiUsageModel } from '../models/AiUsage.js';
import { FoodItemModel } from '../models/FoodItem.js';
import { MealPlanEntryModel } from '../models/MealPlanEntry.js';
import { aiClient, createClaudeClient, setAiClient, type AiRequest, type MessagesApi } from '../services/aiClient.js';
import { sameFood } from '../services/shoppingService.js';
import { api, food, registerUser, setToday } from './helpers.js';

/** Phase 4: using the food. Every AI call goes to a fake client; no test reaches the real API. */

type Answer = unknown;

// Banned phrases are taken from the shared list so this file never spells them out (the source guard scans it).
const [, SAFE_TO_EAT, , FRESH_UNTIL, , STILL_GOOD] = BANNED_PHRASES;

/** A fake AI that returns the given answers in turn (an Error is thrown instead). */
function fakeAi(...answers: Answer[]) {
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

afterEach(() => {
  setAiClient(null);
  vi.restoreAllMocks();
});

type Session = Awaited<ReturnType<typeof registerUser>>;

async function add(s: Session, name: string, lifespanDays: number, extra: Record<string, unknown> = {}) {
  return (
    await s.auth(
      api()
        .post('/api/foods')
        .send(food({ name, lifespanDays, ...extra })),
    )
  ).body as { id: string; name: string };
}

/** Bread (today), Chicken (1 day), Spinach (2 days) are in FridgeStock; Rice (30 days) isn't. */
async function kitchen() {
  setToday('2026-09-29');
  const s = await registerUser();
  const rice = await add(s, 'Rice', 30, { unit: 'kg' });
  const spinach = await add(s, 'Spinach', 2, { unit: 'g', quantity: 200 });
  const bread = await add(s, 'Bread', 0, { unit: 'pcs' });
  const chicken = await add(s, 'Chicken', 1, { unit: 'g', quantity: 500 });
  return { s, rice, spinach, bread, chicken };
}

const recipe = (title: string, uses: string[], steps = ['Chop.', 'Cook.', 'Serve.']) => ({
  title,
  minutes: 25,
  uses,
  steps,
});

describe('AI setup', () => {
  it('tests never see the real key, so the real API is never called', () => {
    expect(env.ai).toBeNull();
    expect(aiClient()).toBeNull();
  });

  it('uses Claude Sonnet 5.5 unless AI_MODEL says otherwise', () => {
    expect(DEFAULT_AI_MODEL).toBe('claude-sonnet-5-5');
  });

  it('reports AI as off, and AI routes answer 503, when no key is set', async () => {
    const s = await registerUser();
    expect((await s.auth(api().get('/api/ai/status'))).body).toEqual({
      enabled: false,
      photoCheck: false,
      dailyLimit: AI_DAILY_LIMIT,
      usedToday: 0,
    });
    await add(s, 'Chicken', 1);
    const res = await s.auth(api().post('/api/ai/recipes')).expect(503);
    expect(res.body.error).toEqual({
      code: 'AI_UNAVAILABLE',
      message: 'AI suggestions aren’t turned on for this app.',
    });
  });

  it('the Claude client sends the model, the JSON schema and any images, and parses the JSON answer', async () => {
    const create = vi.fn(async () => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"ok":true}' }],
    }));
    const client = createClaudeClient({ apiKey: 'test', model: 'claude-sonnet-5-5' }, {
      create,
    } as unknown as MessagesApi);
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    const result = await client.generate({
      system: 'sys',
      prompt: 'hello',
      schema,
      maxTokens: 100,
      images: [{ mediaType: 'image/jpeg', base64: 'AAAA' }],
    });
    expect(result).toEqual({ ok: true });
    expect(create).toHaveBeenCalledWith({
      model: 'claude-sonnet-5-5',
      max_tokens: 100,
      system: 'sys',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
            { type: 'text', text: 'hello' },
          ],
        },
      ],
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    });
  });

  it('the Claude client rejects a refused or cut-off answer', async () => {
    for (const stop_reason of ['refusal', 'max_tokens']) {
      const client = createClaudeClient({ apiKey: 'test', model: 'm' }, {
        create: async () => ({ stop_reason, content: [] }),
      } as unknown as MessagesApi);
      await expect(client.generate({ system: '', prompt: '', schema: {}, maxTokens: 1 })).rejects.toThrow(stop_reason);
    }
  });
});

describe('banned wording in AI text', () => {
  it('is the same seven phrases the source guard uses, plus the word "safe"', () => {
    expect(BANNED_PHRASES).toHaveLength(7);
    expect(hasBannedWording(`Chicken is ${SAFE_TO_EAT} today`)).toBe(true);
    expect(hasBannedWording('Perfectly safe for dinner')).toBe(true);
    expect(hasBannedWording(`${STILL_GOOD.toUpperCase()} for a stew`)).toBe(true);
    expect(hasBannedWording('Chicken and spinach stew')).toBe(false);
  });
});

describe('recipe ideas from the FridgeStock list', () => {
  it('sends the FridgeStock list in its order and returns ideas using those items, most urgent first', async () => {
    const { s, bread, chicken, spinach } = await kitchen();
    const calls = fakeAi({
      recipes: [
        recipe('Spinach omelette', ['F3']),
        recipe('Chicken and bread bake', ['F2', 'F1', 'F9']),
        recipe('Plain rice', ['F4']),
      ],
    });
    const res = await s.auth(api().post('/api/ai/recipes')).expect(200);

    expect(calls[0]!.prompt).toContain(
      [
        'My FridgeStock list, most urgent first:',
        'F1: Bread (1 pcs): expected expiry today',
        'F2: Chicken (500 g): expected expiry in 1 day',
        'F3: Spinach (200 g): expected expiry in 2 days',
        '',
        'Other food I have:',
        'F4: Rice (1 kg): expected expiry in 30 days',
      ].join('\n'),
    );
    expect(res.body.basedOn).toEqual([
      { id: bread.id, name: 'Bread' },
      { id: chicken.id, name: 'Chicken' },
      { id: spinach.id, name: 'Spinach' },
    ]);
    // Unknown codes (F9) are dropped, uses are in FridgeStock order, and an idea
    // that uses no FridgeStock item ("Plain rice") is left out.
    expect(res.body.recipes).toEqual([
      {
        title: 'Chicken and bread bake',
        minutes: 25,
        steps: ['Chop.', 'Cook.', 'Serve.'],
        uses: [
          { id: bread.id, name: 'Bread' },
          { id: chicken.id, name: 'Chicken' },
        ],
      },
      {
        title: 'Spinach omelette',
        minutes: 25,
        steps: ['Chop.', 'Cook.', 'Serve.'],
        uses: [{ id: spinach.id, name: 'Spinach' }],
      },
    ]);
  });

  it('reads the FridgeStock order but never changes it or any item', async () => {
    const { s } = await kitchen();
    const before = (await s.auth(api().get('/api/foods/fridgestock'))).body.items;
    const stored = await FoodItemModel.find({ userId: s.user.id }).lean();
    fakeAi({ recipes: [recipe('Stew', ['F3', 'F2'])] });
    await s.auth(api().post('/api/ai/recipes')).expect(200);
    expect((await s.auth(api().get('/api/foods/fridgestock'))).body.items).toEqual(before);
    expect(await FoodItemModel.find({ userId: s.user.id }).lean()).toEqual(stored);
  });

  it('makes no AI request, and uses none of the allowance, when FridgeStock is empty', async () => {
    setToday('2026-09-29');
    const s = await registerUser();
    await add(s, 'Rice', 30);
    const calls = fakeAi({ recipes: [] });
    expect((await s.auth(api().post('/api/ai/recipes'))).body).toEqual({ basedOn: [], recipes: [] });
    expect(calls).toHaveLength(0);
    expect((await s.auth(api().get('/api/ai/status'))).body.usedToday).toBe(0);
  });

  it('asks again when the answer calls food safe, and never shows that text', async () => {
    const { s } = await kitchen();
    const calls = fakeAi(
      { recipes: [recipe('Chicken bake', ['F2'], [`Chicken is ${SAFE_TO_EAT} tonight.`])] },
      { recipes: [recipe('Chicken bake', ['F2'])] },
    );
    const res = await s.auth(api().post('/api/ai/recipes')).expect(200);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toContain('Your previous answer used wording that is not allowed.');
    expect(JSON.stringify(res.body)).not.toMatch(/safe/i);
    expect((await s.auth(api().get('/api/ai/status'))).body.usedToday).toBe(1);
  });

  it('asks again when the answer doesn’t match the schema', async () => {
    const { s } = await kitchen();
    const calls = fakeAi(
      { recipes: [{ title: 'No steps', minutes: 10, uses: ['F1'], steps: [] }] },
      {
        recipes: [recipe('Toast', ['F1'])],
      },
    );
    const res = await s.auth(api().post('/api/ai/recipes')).expect(200);
    expect(calls[1]!.prompt).toContain('did not match the required format');
    expect(res.body.recipes[0].title).toBe('Toast');
  });

  it('gives up after 3 attempts with a 503, and doesn’t count the request', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { s } = await kitchen();
    const calls = fakeAi({ recipes: [recipe(`${FRESH_UNTIL} Friday bake`, ['F1'])] });
    const res = await s.auth(api().post('/api/ai/recipes')).expect(503);
    expect(res.body.error).toEqual({
      code: 'AI_UNAVAILABLE',
      message: 'Couldn’t get suggestions right now. Try again later.',
    });
    expect(calls).toHaveLength(3);
    expect((await s.auth(api().get('/api/ai/status'))).body.usedToday).toBe(0);

    fakeAi(new Error('network down'));
    await s.auth(api().post('/api/ai/recipes')).expect(503);
  });
});

describe('AI daily limit', () => {
  it('counts each request and stops at the limit until the next day', async () => {
    const { s } = await kitchen();
    fakeAi({ recipes: [recipe('Toast', ['F1'])] });
    await s.auth(api().post('/api/ai/recipes')).expect(200);
    expect((await s.auth(api().get('/api/ai/status'))).body).toEqual({
      enabled: true,
      photoCheck: false, // the feature flag is off unless a test turns it on
      dailyLimit: 20,
      usedToday: 1,
    });

    await AiUsageModel.updateOne({ userId: s.user.id, date: '2026-09-29' }, { $set: { count: AI_DAILY_LIMIT } });
    const calls = fakeAi({ recipes: [recipe('Toast', ['F1'])] });
    const res = await s.auth(api().post('/api/ai/recipes')).expect(429);
    expect(res.body.error).toEqual({
      code: 'RATE_LIMITED',
      message: 'You’ve used all 20 AI suggestions for today. Try again tomorrow.',
    });
    expect(calls).toHaveLength(0);

    setToday('2026-09-30');
    await s.auth(api().post('/api/ai/recipes')).expect(200);
  });

  it('is per user', async () => {
    const { s } = await kitchen();
    await AiUsageModel.create({ userId: s.user.id, date: '2026-09-29', count: AI_DAILY_LIMIT });
    const other = await registerUser();
    await add(other, 'Bread', 0);
    fakeAi({ recipes: [recipe('Toast', ['F1'])] });
    await other.auth(api().post('/api/ai/recipes')).expect(200);
  });
});

describe('weekly meal plan', () => {
  it('shows today and the next six days, and saves a meal with your own food', async () => {
    const { s, chicken, spinach } = await kitchen();
    const empty = await s.auth(api().get('/api/meal-plan')).expect(200);
    expect(empty.body.today).toBe('2026-09-29');
    expect(empty.body.days.map((d: { date: string }) => d.date)).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
    ]);
    expect(empty.body.days.every((d: { entry: unknown }) => d.entry === null)).toBe(true);

    const saved = await s
      .auth(
        api()
          .put('/api/meal-plan/2026-09-30')
          .send({ title: 'Chicken curry', foodIds: [chicken.id, spinach.id] }),
      )
      .expect(200);
    expect(saved.body).toEqual({
      meal: 'dinner',
      title: 'Chicken curry',
      foods: [
        { id: chicken.id, name: 'Chicken', status: 'ACTIVE' },
        { id: spinach.id, name: 'Spinach', status: 'ACTIVE' },
      ],
    });
    await s.auth(api().post(`/api/foods/${chicken.id}/use`).send({})).expect(200);
    const plan = await s.auth(api().get('/api/meal-plan'));
    expect(plan.body.days[1].entry.foods[0]).toEqual({ id: chicken.id, name: 'Chicken', status: 'USED' });

    await s.auth(api().delete('/api/meal-plan/2026-09-30')).expect(204);
    expect((await s.auth(api().get('/api/meal-plan'))).body.days[1].entry).toBeNull();
  });

  it('rejects days outside the week, someone else’s food, and empty titles', async () => {
    const { s } = await kitchen();
    const other = await registerUser();
    const theirs = await add(other, 'Fish', 1);
    for (const date of ['2026-09-28', '2026-10-06', '2026-02-30']) {
      const res = await s.auth(api().put(`/api/meal-plan/${date}`).send({ title: 'Soup' })).expect(400);
      expect(res.body.error).toMatchObject({ field: 'date', message: 'Choose a day from today to six days ahead.' });
    }
    const res = await s
      .auth(
        api()
          .put('/api/meal-plan/2026-09-30')
          .send({ title: 'Fish pie', foodIds: [theirs.id] }),
      )
      .expect(400);
    expect(res.body.error).toMatchObject({ field: 'foodIds', message: 'Choose up to 10 items from your own food.' });
    await s.auth(api().put('/api/meal-plan/2026-09-30').send({ title: ' ' })).expect(400);
  });

  it('treats a UUID food id (the Python server’s form) as food that isn’t the household’s', async () => {
    const { s, chicken } = await kitchen();
    for (const foodIds of [
      ['0192f3c4-7b1e-7c2a-9d4e-3f6a8b2c1d00'],
      [chicken.id, '0192F3C4-7B1E-7C2A-9D4E-3F6A8B2C1D00'],
    ]) {
      const res = await s.auth(api().put('/api/meal-plan/2026-09-30').send({ title: 'Curry', foodIds })).expect(400);
      expect(res.body.error).toMatchObject({ field: 'foodIds', message: 'Choose up to 10 items from your own food.' });
    }
    expect(await MealPlanEntryModel.countDocuments()).toBe(0);
  });

  it('AI suggests meals only for empty days, and saves nothing until the user adds them', async () => {
    const { s, bread, chicken } = await kitchen();
    await s.auth(api().put('/api/meal-plan/2026-09-29').send({ title: 'Already planned' })).expect(200);
    const calls = fakeAi({
      days: [
        { date: '2026-10-01', title: 'Spinach pasta', uses: ['F3'] },
        { date: '2026-09-30', title: 'Chicken sandwiches', uses: ['F2', 'F1', 'F42'] },
        { date: '2026-09-29', title: 'Not an empty day', uses: [] },
        { date: '2026-09-30', title: 'Duplicate day', uses: [] },
        { date: '2026-12-25', title: 'Out of range', uses: [] },
      ],
    });
    const res = await s.auth(api().post('/api/ai/meal-plan')).expect(200);
    expect(calls[0]!.prompt).toContain(
      'Plan one simple dinner for each of these dates: 2026-09-30, 2026-10-01, 2026-10-02, 2026-10-03, 2026-10-04, 2026-10-05.',
    );
    expect(res.body.days).toEqual([
      {
        date: '2026-09-30',
        title: 'Chicken sandwiches',
        foods: [
          { id: bread.id, name: 'Bread' },
          { id: chicken.id, name: 'Chicken' },
        ],
      },
      { date: '2026-10-01', title: 'Spinach pasta', foods: [{ id: expect.any(String), name: 'Spinach' }] },
    ]);
    expect(await MealPlanEntryModel.countDocuments({ userId: s.user.id })).toBe(1);
  });
});

describe('shopping list', () => {
  it('warns about matching food already at home', async () => {
    const { s, chicken } = await kitchen();
    await add(s, 'Oat milk', 5, { unit: 'l' });
    const res = await s
      .auth(api().post('/api/shopping').send({ name: 'Chicken breasts', quantity: 2, unit: 'pcs' }))
      .expect(201);
    expect(res.body).toMatchObject({ name: 'Chicken breasts', quantity: 2, unit: 'pcs', checked: false });
    expect(res.body.atHome).toEqual([
      {
        id: chicken.id,
        name: 'Chicken',
        quantity: 500,
        unit: 'g',
        expiryDate: '2026-09-30',
        urgency: 'APPROACHING_EXPIRY',
      },
    ]);
    const milk = await s.auth(api().post('/api/shopping').send({ name: 'milk' })).expect(201);
    expect(milk.body.atHome.map((m: { name: string }) => m.name)).toEqual(['Oat milk']);
    const flour = await s.auth(api().post('/api/shopping').send({ name: 'Flour' })).expect(201);
    expect(flour.body.atHome).toEqual([]);
  });

  it('ignores food that is no longer at home', async () => {
    const { s, bread } = await kitchen();
    await s.auth(api().post(`/api/foods/${bread.id}/waste`).send({})).expect(200);
    const res = await s.auth(api().post('/api/shopping').send({ name: 'Bread' })).expect(201);
    expect(res.body.atHome).toEqual([]);
  });

  it('ticks items off, lists what is left to buy first, and clears ticked items', async () => {
    setToday('2026-09-29');
    const s = await registerUser();
    const a = (await s.auth(api().post('/api/shopping').send({ name: 'Apples' }))).body;
    await s.auth(api().post('/api/shopping').send({ name: 'Beans' }));
    await s.auth(api().put(`/api/shopping/${a.id}`).send({ checked: true })).expect(200);
    const list = await s.auth(api().get('/api/shopping')).expect(200);
    expect(list.body.items.map((i: { name: string; checked: boolean }) => [i.name, i.checked])).toEqual([
      ['Beans', false],
      ['Apples', true],
    ]);
    await s.auth(api().post('/api/shopping/clear-checked')).expect(204);
    expect((await s.auth(api().get('/api/shopping'))).body.items.map((i: { name: string }) => i.name)).toEqual([
      'Beans',
    ]);
  });

  it('keeps each user’s list private and validates input', async () => {
    const s = await registerUser();
    const item = (await s.auth(api().post('/api/shopping').send({ name: 'Apples' }))).body;
    const other = await registerUser();
    await other.auth(api().put(`/api/shopping/${item.id}`).send({ checked: true })).expect(404);
    await other.auth(api().delete(`/api/shopping/${item.id}`)).expect(404);
    expect((await other.auth(api().get('/api/shopping'))).body.items).toEqual([]);
    const res = await s.auth(api().post('/api/shopping').send({ name: '' })).expect(400);
    expect(res.body.error).toMatchObject({ field: 'name', message: 'Enter what you need to buy.' });
    await s.auth(api().delete(`/api/shopping/${item.id}`)).expect(204);
  });

  it('matches singular and plural names, word by word', () => {
    expect(sameFood('Eggs', 'egg')).toBe(true);
    expect(sameFood('Tomatoes', 'Cherry tomato')).toBe(true);
    expect(sameFood('Berries', 'berry')).toBe(true);
    expect(sameFood('Hummus', 'hummus')).toBe(true);
    expect(sameFood('Rice', 'Rice noodles')).toBe(true);
    expect(sameFood('Rice', 'Chicken')).toBe(false);
  });
});

describe('leftovers', () => {
  it('are new items with a short lifespan', async () => {
    setToday('2026-09-29');
    const s = await registerUser();
    const res = await s
      .auth(
        api()
          .post('/api/foods')
          .send(food({ name: 'Leftover curry', lifespanDays: 3, leftover: true })),
      )
      .expect(201);
    expect(res.body).toMatchObject({ leftover: true, expiryDate: '2026-10-02' });
    const plain = await s.auth(api().post('/api/foods').send(food())).expect(201);
    expect(plain.body.leftover).toBe(false);
  });

  it('can’t be given more than 4 days unless frozen', async () => {
    setToday('2026-09-29');
    const s = await registerUser();
    const res = await s
      .auth(
        api()
          .post('/api/foods')
          .send(food({ name: 'Leftover curry', lifespanDays: 5, leftover: true })),
      )
      .expect(400);
    expect(res.body.error).toMatchObject({
      field: 'lifespanDays',
      message: 'Leftovers can have a lifespan of at most 4 days, unless they are frozen.',
    });
    const frozen = await s
      .auth(
        api()
          .post('/api/foods')
          .send(food({ name: 'Leftover curry', lifespanDays: 60, leftover: true, storage: 'FREEZER' })),
      )
      .expect(201);
    const kept = await s
      .auth(
        api()
          .post('/api/foods')
          .send(food({ name: 'Leftover soup', lifespanDays: 2, leftover: true })),
      )
      .expect(201);
    await s.auth(api().put(`/api/foods/${kept.body.id}`).send({ lifespanDays: 6 })).expect(400);
    await s.auth(api().put(`/api/foods/${frozen.body.id}`).send({ storage: 'FRIDGE' })).expect(400);
    const moved = await s
      .auth(api().post(`/api/foods/${frozen.body.id}/move`).send({ storage: 'FRIDGE', daysLeft: 10 }))
      .expect(400);
    expect(moved.body.error.field).toBe('daysLeft');
    await s.auth(api().post(`/api/foods/${frozen.body.id}/move`).send({ storage: 'FRIDGE', daysLeft: 2 })).expect(200);
  });
});
