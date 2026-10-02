import { hasBannedWording, type PushPayload } from '@cook-first/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MealReminderLogModel } from '../models/MealReminderLog.js';
import { RecipeIdeaCacheModel } from '../models/RecipeIdeaCache.js';
import { UserModel } from '../models/User.js';
import { setAiClient, type AiRequest } from '../services/aiClient.js';
import { clock } from '../services/clock.js';
import { createFcmPushProvider, IOS_MEAL_CATEGORY } from '../services/fcmProvider.js';
import { sweep } from '../services/notificationService.js';
import { setPushProvider, type PushProvider, type PushTarget } from '../services/pushProvider.js';
import { signActionToken, signMealActionToken } from '../services/token.js';
import { api, food, registerUser } from './helpers.js';

/**
 * Reminder sounds and meal-time cooking reminders. Every push goes to a recording fake provider, and every AI
 * request to a fake client: nothing here reaches a real service.
 */

function fakePush() {
  const sent: { endpoint: string; payload: PushPayload }[] = [];
  const provider: PushProvider = {
    name: 'fake',
    publicKey: 'PUBLIC-KEY',
    async send(target, payload) {
      sent.push({ endpoint: target.endpoint, payload });
      return 'SENT';
    },
  };
  setPushProvider(provider);
  return sent;
}

/** A fake AI that returns these recipes (by title) for every request, and records the requests. */
function fakeAi(...titles: string[]) {
  const calls: AiRequest[] = [];
  setAiClient({
    model: 'fake-model',
    async generate(request) {
      calls.push(request);
      return {
        recipes: titles.map((title) => ({ title, minutes: 15, uses: ['F1'], steps: ['Cook it.', 'Serve it.'] })),
      };
    },
  });
  return calls;
}

afterEach(() => {
  setPushProvider(null);
  setAiClient(null);
  clock.set(null);
  vi.restoreAllMocks();
});

const TODAY = '2026-10-03';
/** Pins "now" to a UTC instant on 3 October 2026. */
const at = (hhmm: string, date = TODAY) => clock.set(new Date(`${date}T${hhmm}:00Z`));

type Session = Awaited<ReturnType<typeof registerUser>>;

async function addFood(s: Session, name: string, lifespanDays: number, addedDate = TODAY) {
  return (await s.auth(api().post('/api/foods').send(food({ name, lifespanDays, addedDate }))).expect(201)).body as {
    id: string;
  };
}

/** A user with one registered browser, Bread (expected expiry today) and Chicken (tomorrow) in Cook First. */
async function household(overrides: Record<string, unknown> = {}) {
  at('06:00');
  const s = await registerUser({ timeZone: 'UTC', ...overrides });
  await s
    .auth(
      api()
        .post('/api/push/subscriptions')
        .send({
          endpoint: `https://push.example.com/send/${s.user.id}`,
          keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
        }),
    )
    .expect(201);
  const bread = await addFood(s, 'Bread', 0);
  const chicken = await addFood(s, 'Chicken', 1);
  return { s, bread, chicken };
}

const turnOn = (s: Session, meals: Record<string, { enabled?: boolean; time?: string }>) =>
  s.auth(api().put('/api/notifications/meals').send(meals)).expect(200);

const mealPushes = (sent: { payload: PushPayload }[]) => sent.filter((entry) => entry.payload.kind === 'MEAL');

describe('settings: sound, vibration and quiet hours', () => {
  it('start on, with quiet hours 22:00 to 07:00', async () => {
    const s = await registerUser();
    const res = await s.auth(api().get('/api/notifications/alerts')).expect(200);
    expect(res.body).toEqual({
      sound: true,
      vibration: true,
      quietHours: { enabled: true, start: '22:00', end: '07:00' },
    });
    const me = await s.auth(api().get('/api/auth/me')).expect(200);
    expect(me.body.user.alerts).toEqual(res.body);
  });

  it('change one part at a time and keep the rest', async () => {
    const s = await registerUser();
    await s.auth(api().put('/api/notifications/alerts').send({ sound: false })).expect(200);
    const res = await s
      .auth(
        api()
          .put('/api/notifications/alerts')
          .send({ quietHours: { start: '23:15' } }),
      )
      .expect(200);
    expect(res.body).toEqual({
      sound: false,
      vibration: true,
      quietHours: { enabled: true, start: '23:15', end: '07:00' },
    });
    expect((await s.auth(api().get('/api/notifications/alerts'))).body).toEqual(res.body);
  });

  it('can be switched off completely', async () => {
    const s = await registerUser();
    const res = await s
      .auth(
        api()
          .put('/api/notifications/alerts')
          .send({ vibration: false, quietHours: { enabled: false } }),
      )
      .expect(200);
    expect(res.body).toMatchObject({ vibration: false, quietHours: { enabled: false } });
  });

  it('reject a bad time, equal start and end, and unknown fields', async () => {
    const s = await registerUser();
    const put = (body: unknown) =>
      s.auth(
        api()
          .put('/api/notifications/alerts')
          .send(body as object),
      );
    for (const start of ['25:00', '7:30', '22:60', 'late', '']) {
      const res = await put({ quietHours: { start } }).expect(400);
      expect(res.body.error.message).toBe('Enter a time like 07:30.');
    }
    const same = await put({ quietHours: { start: '07:00', end: '07:00' } }).expect(400);
    expect(same.body.error.message).toBe('Quiet hours need a start and an end that are different times.');
    await put({ loud: true }).expect(400);
    await put({ sound: 'yes' }).expect(400);
  });

  it('need a login', async () => {
    await api().get('/api/notifications/alerts').expect(401);
    await api().put('/api/notifications/alerts').send({ sound: false }).expect(401);
    await api().get('/api/notifications/meals').expect(401);
  });
});

describe('settings: meal reminders', () => {
  it('start off, at 07:30, 12:30 and 19:30', async () => {
    const s = await registerUser();
    const res = await s.auth(api().get('/api/notifications/meals')).expect(200);
    expect(res.body).toEqual({
      breakfast: { enabled: false, time: '07:30' },
      lunch: { enabled: false, time: '12:30' },
      dinner: { enabled: false, time: '19:30' },
    });
    const me = await s.auth(api().get('/api/auth/me')).expect(200);
    expect(me.body.user.mealReminders).toEqual(res.body);
  });

  it('turn one meal on and move its time, leaving the others alone', async () => {
    const s = await registerUser();
    const res = await turnOn(s, { lunch: { enabled: true, time: '13:05' } });
    expect(res.body).toEqual({
      breakfast: { enabled: false, time: '07:30' },
      lunch: { enabled: true, time: '13:05' },
      dinner: { enabled: false, time: '19:30' },
    });
    const next = await turnOn(s, { lunch: { enabled: false } });
    expect(next.body.lunch).toEqual({ enabled: false, time: '13:05' });
  });

  it('reject a bad time, an unknown meal and unknown fields', async () => {
    const s = await registerUser();
    const put = (body: unknown) =>
      s.auth(
        api()
          .put('/api/notifications/meals')
          .send(body as object),
      );
    await put({ lunch: { time: '24:00' } }).expect(400);
    await put({ supper: { enabled: true } }).expect(400);
    await put({ lunch: { loud: true } }).expect(400);
  });
});

describe('meal reminders: when they are sent', () => {
  it('sends at the chosen time with the top Cook First items, their days left, and three buttons', async () => {
    const sent = fakePush();
    const { s } = await household();
    await turnOn(s, { breakfast: { enabled: true } });

    at('07:29');
    await sweep();
    expect(sent).toEqual([]);

    at('07:30');
    await sweep();
    expect(sent).toHaveLength(1);
    const { payload } = sent[0]!;
    expect(payload).toMatchObject({
      title: 'Time to cook breakfast',
      kind: 'MEAL',
      tag: `meal-breakfast-${TODAY}`,
      url: '/meal/breakfast',
    });
    expect(payload.body).toBe('Use these up first:\nBread: expected expiry today\nChicken: expected expiry in 1 day');
    expect(payload.actions.map((action) => action.title)).toEqual(['Cooked it', 'Show recipe', 'Snooze 30 min']);
    expect(payload.actions.map((action) => action.action)).toEqual(['COOKED', 'RECIPE', 'SNOOZE_MEAL']);
    expect(payload.actions[0]!.url).toBe('/add?leftover=1');
    expect(payload.actions[1]!.url).toBe('/meal/breakfast');
    expect(payload.actions[2]!.url).toBeUndefined();
    expect(payload.actionToken).toBeTruthy();
  });

  it('is sent once a day, and again the next day', async () => {
    const sent = fakePush();
    const { s } = await household();
    await turnOn(s, { breakfast: { enabled: true } });
    for (const time of ['07:30', '07:35', '07:50']) {
      at(time);
      await sweep();
    }
    expect(mealPushes(sent)).toHaveLength(1);

    // The next day: Bread and Chicken are past their expected expiry, which is still worth a reminder.
    at('07:30', '2026-10-04');
    await sweep();
    expect(mealPushes(sent)).toHaveLength(2);
    expect(mealPushes(sent)[1]!.payload.tag).toBe('meal-breakfast-2026-10-04');
  });

  it('still goes if the job was a few minutes late, but not hours later', async () => {
    const sent = fakePush();
    const { s } = await household();
    await turnOn(s, { breakfast: { enabled: true } });
    at('08:00'); // 30 minutes late: too late (the daily summary goes instead)
    await sweep();
    expect(mealPushes(sent)).toEqual([]);
    at('07:59');
    await sweep();
    expect(mealPushes(sent)).toHaveLength(1);
  });

  it('sends nothing for a meal that is switched off', async () => {
    const sent = fakePush();
    const { s } = await household();
    await turnOn(s, { lunch: { enabled: true } });
    at('07:30');
    await sweep();
    expect(sent).toEqual([]);
  });

  it('uses each person’s own time zone: dinner at 19:30 in Kolkata is 14:00 UTC', async () => {
    const sent = fakePush();
    at('06:00');
    const s = await registerUser({ timeZone: 'Asia/Kolkata' });
    await s
      .auth(
        api()
          .post('/api/push/subscriptions')
          .send({ endpoint: 'https://push.example.com/send/kolkata', keys: { p256dh: 'p', auth: 'a' } }),
      )
      .expect(201);
    await addFood(s, 'Paneer', 1);
    await turnOn(s, { dinner: { enabled: true } });

    at('13:59');
    await sweep();
    expect(mealPushes(sent)).toEqual([]);
    at('14:00');
    await sweep();
    expect(mealPushes(sent)).toHaveLength(1);
    expect(mealPushes(sent)[0]!.payload.title).toBe('Time to cook dinner');
  });

  it('follows daylight saving: dinner at 19:30 in New York is 23:30 UTC in October and 00:30 UTC in December', async () => {
    const sent = fakePush();
    at('06:00');
    const s = await registerUser({ timeZone: 'America/New_York' });
    await s
      .auth(
        api()
          .post('/api/push/subscriptions')
          .send({ endpoint: 'https://push.example.com/send/ny', keys: { p256dh: 'p', auth: 'a' } }),
      )
      .expect(201);
    await addFood(s, 'Eggs', 1);
    await turnOn(s, { dinner: { enabled: true } });

    at('23:29');
    await sweep();
    expect(mealPushes(sent)).toEqual([]);
    at('23:30');
    await sweep();
    expect(mealPushes(sent)).toHaveLength(1);

    // 25 December: 19:30 EST is 00:30 UTC the next day.
    const winter = await addFood(s, 'Milk', 1, TODAY);
    expect(winter.id).toBeTruthy();
    clock.set(new Date('2026-12-26T00:29:00Z'));
    await sweep();
    expect(mealPushes(sent)).toHaveLength(1);
    clock.set(new Date('2026-12-26T00:30:00Z'));
    await sweep();
    expect(mealPushes(sent)).toHaveLength(2);
    expect(mealPushes(sent)[1]!.payload.tag).toBe('meal-dinner-2026-12-25');
  });

  it('sends nothing when Cook First is empty and nothing is planned, and does not record one', async () => {
    const sent = fakePush();
    at('06:00');
    const s = await registerUser({ timeZone: 'UTC' });
    await s
      .auth(
        api()
          .post('/api/push/subscriptions')
          .send({ endpoint: 'https://push.example.com/send/empty', keys: { p256dh: 'p', auth: 'a' } }),
      )
      .expect(201);
    await addFood(s, 'Rice', 30); // not in Cook First
    await turnOn(s, { breakfast: { enabled: true } });
    at('07:30');
    await sweep();
    expect(sent).toEqual([]);
    expect(await MealReminderLogModel.countDocuments({ userId: s.user.id })).toBe(0);
  });

  it('is sent only to a person with a registered device', async () => {
    const sent = fakePush();
    at('06:00');
    const s = await registerUser({ timeZone: 'UTC' });
    await addFood(s, 'Bread', 0);
    await turnOn(s, { breakfast: { enabled: true } });
    at('07:30');
    await sweep();
    expect(sent).toEqual([]);
  });

  it('is tried again at the next sweep when it reached no device, and not recorded', async () => {
    const provider: PushProvider = {
      name: 'down',
      publicKey: 'K',
      async send() {
        throw new Error('push service down');
      },
    };
    setPushProvider(provider);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { s } = await household();
    await turnOn(s, { breakfast: { enabled: true } });
    at('07:30');
    await sweep();
    expect(await MealReminderLogModel.countDocuments({ userId: s.user.id })).toBe(0);
    const sent = fakePush();
    at('07:35');
    await sweep();
    expect(mealPushes(sent)).toHaveLength(1);
  });
});

describe('meal reminders: what they say', () => {
  it('1. a planned meal for that meal comes first, and another meal’s plan is not used', async () => {
    const sent = fakePush();
    const { s, bread } = await household();
    await turnOn(s, { breakfast: { enabled: true }, lunch: { enabled: true } });
    await s
      .auth(
        api()
          .put(`/api/meal-plan/${TODAY}`)
          .send({ meal: 'breakfast', title: 'Toast and eggs', foodIds: [bread.id] }),
      )
      .expect(200);
    await s.auth(api().put(`/api/meal-plan/${TODAY}`).send({ meal: 'dinner', title: 'Stew', foodIds: [] })).expect(200);

    at('07:30');
    await sweep();
    expect(mealPushes(sent)[0]!.payload.body).toMatch(/^Planned: Toast and eggs\. It uses Bread\./);
    expect(mealPushes(sent)[0]!.payload.actions[0]!.url).toBe('/add?leftover=1&from=Toast%20and%20eggs');

    at('12:30'); // lunch has no plan (the dinner plan isn't used)
    await sweep();
    expect(mealPushes(sent)[1]!.payload.body).toMatch(/^Use these up first:/);
  });

  it('1. a planned meal is sent even when nothing is in Cook First', async () => {
    const sent = fakePush();
    at('06:00');
    const s = await registerUser({ timeZone: 'UTC' });
    await s
      .auth(
        api()
          .post('/api/push/subscriptions')
          .send({ endpoint: 'https://push.example.com/send/plan-only', keys: { p256dh: 'p', auth: 'a' } }),
      )
      .expect(201);
    await turnOn(s, { dinner: { enabled: true } });
    await s.auth(api().put(`/api/meal-plan/${TODAY}`).send({ title: 'Pasta' })).expect(200); // meal defaults to dinner
    at('19:30');
    await sweep();
    expect(mealPushes(sent)).toHaveLength(1);
    expect(mealPushes(sent)[0]!.payload.body).toBe('Planned: Pasta.');
  });

  it('2. with AI on, one of today’s recipe ideas for that meal type, asked for once and then kept', async () => {
    const sent = fakePush();
    const calls = fakeAi('Cheesy toast');
    const { s } = await household();
    await turnOn(s, { breakfast: { enabled: true } });
    at('07:30');
    await sweep();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.prompt).toContain('breakfast');
    expect(mealPushes(sent)[0]!.payload.body).toMatch(/^Try Cheesy toast \(15 min\)\. It uses Bread\./);
    expect(mealPushes(sent)[0]!.payload.actions[0]!.url).toBe('/add?leftover=1&from=Cheesy%20toast');
    const cached = await RecipeIdeaCacheModel.findOne({ mealType: 'breakfast', date: TODAY });
    expect(cached?.recipes.map((recipe) => recipe.title)).toEqual(['Cheesy toast']);
  });

  it('2. uses ideas already cached today, without asking the AI again', async () => {
    const sent = fakePush();
    const calls = fakeAi('Cheesy toast');
    const { s } = await household();
    await turnOn(s, { lunch: { enabled: true } });
    at('11:00');
    const asked = await s.auth(api().post('/api/ai/recipes').send({ mealType: 'lunch' })).expect(200);
    expect(asked.body.recipes).toHaveLength(1);
    expect(calls).toHaveLength(1);

    at('12:30');
    await sweep();
    expect(calls).toHaveLength(1);
    expect(mealPushes(sent)[0]!.payload.body).toContain('Try Cheesy toast');
  });

  it('asking for ideas without a meal type keeps nothing, and a bad meal type is rejected', async () => {
    fakeAi('Soup');
    const { s } = await household();
    await s.auth(api().post('/api/ai/recipes').send({})).expect(200);
    await s.auth(api().post('/api/ai/recipes')).expect(200);
    expect(await RecipeIdeaCacheModel.countDocuments({})).toBe(0);
    const bad = await s.auth(api().post('/api/ai/recipes').send({ mealType: 'supper' })).expect(400);
    expect(bad.body.error.message).toBe('Choose breakfast, lunch or dinner.');
  });

  it('3. with AI off, a plain message naming the top items with their days left, in Cook First order', async () => {
    const sent = fakePush();
    const { s } = await household();
    await turnOn(s, { dinner: { enabled: true } });
    at('19:30');
    await sweep();
    expect(mealPushes(sent)[0]!.payload.body).toBe(
      'Use these up first:\nBread: expected expiry today\nChicken: expected expiry in 1 day',
    );
  });

  it('3. falls back to the plain message when the AI fails, and does not keep asking', async () => {
    const sent = fakePush();
    const calls: AiRequest[] = [];
    setAiClient({
      model: 'fake-model',
      async generate(request) {
        calls.push(request);
        throw new Error('AI down');
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { s } = await household();
    await turnOn(s, { breakfast: { enabled: true } });
    at('07:30');
    await sweep();
    expect(mealPushes(sent)[0]!.payload.body).toMatch(/^Use these up first:/);
    const asked = calls.length;
    expect(asked).toBeGreaterThan(0);
    // Tomorrow's cache is separate, but today's empty one stops a retry within the day.
    await MealReminderLogModel.deleteMany({ userId: s.user.id });
    at('07:40');
    await sweep();
    expect(calls).toHaveLength(asked);
  });

  it('never suggests the same recipe for two meals on the same day', async () => {
    const sent = fakePush();
    fakeAi('Cheesy toast', 'Bread soup'); // the same two ideas are offered for every meal
    const { s } = await household();
    await turnOn(s, { breakfast: { enabled: true }, lunch: { enabled: true }, dinner: { enabled: true } });
    for (const time of ['07:30', '12:30', '19:30']) {
      at(time);
      await sweep();
    }
    const bodies = mealPushes(sent).map((entry) => entry.payload.body);
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toContain('Try Cheesy toast');
    expect(bodies[1]).toContain('Try Bread soup');
    // Both recipes are used up for the day: dinner gets the plain message.
    expect(bodies[2]).toMatch(/^Use these up first:/);
    const logged = await MealReminderLogModel.find({ userId: s.user.id });
    const titles = logged.flatMap((log) => (log.recipeTitle ? [log.recipeTitle] : []));
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('the next day may use a recipe again', async () => {
    const sent = fakePush();
    fakeAi('Cheesy toast');
    const { s } = await household();
    await turnOn(s, { breakfast: { enabled: true } });
    at('07:30');
    await sweep();
    at('07:30', '2026-10-04');
    await sweep();
    expect(mealPushes(sent).map((entry) => entry.payload.body.startsWith('Try Cheesy toast'))).toEqual([true, true]);
  });

  it('asks the AI for meal-suited ideas and tells it which have been chosen for other meals', async () => {
    fakePush();
    const calls = fakeAi('Cheesy toast');
    const { s } = await household();
    await s.auth(api().post('/api/ai/recipes').send({ mealType: 'breakfast' })).expect(200);
    await s.auth(api().post('/api/ai/recipes').send({ mealType: 'lunch' })).expect(200);
    expect(calls[0]!.prompt).toContain('suit breakfast');
    expect(calls[0]!.prompt).not.toContain('Do not suggest these');
    expect(calls[1]!.prompt).toContain('suit lunch');
    expect(calls[1]!.prompt).toContain(
      'Do not suggest these, which are already chosen for other meals today: Cheesy toast.',
    );
  });

  it('leaves food that is snoozed out of the plain message', async () => {
    const sent = fakePush();
    const { s, bread } = await household();
    await api()
      .post('/api/push/actions')
      .send({ token: signActionToken(s.user.id, bread.id), action: 'SNOOZE' })
      .expect(204);
    await turnOn(s, { breakfast: { enabled: true } });
    at('07:30');
    await sweep();
    expect(mealPushes(sent)[0]!.payload.body).toBe('Use these up first:\nChicken: expected expiry in 1 day');
  });

  it('every sentence passes the banned-phrase check and uses expected-expiry wording', async () => {
    const sent = fakePush();
    fakeAi('Cheesy toast');
    const { s } = await household();
    await turnOn(s, { breakfast: { enabled: true }, lunch: { enabled: true }, dinner: { enabled: true } });
    await s.auth(api().put(`/api/meal-plan/${TODAY}`).send({ meal: 'lunch', title: 'Soup', foodIds: [] })).expect(200);
    for (const time of ['07:30', '12:30', '19:30']) {
      at(time);
      await sweep();
    }
    expect(mealPushes(sent)).toHaveLength(3);
    for (const { payload } of mealPushes(sent)) {
      for (const text of [payload.title, payload.body, ...payload.actions.map((action) => action.title)]) {
        expect(hasBannedWording(text), text).toBe(false);
        expect(text.toLowerCase(), text).not.toMatch(/\bexpir(y|es|ed)\b(?! (in|today))/);
      }
    }
    // Where an item is named with its days left, it says "expected expiry".
    expect(mealPushes(sent)[2]!.payload.body).toContain('expected expiry');
  });
});

describe('meal reminders: quiet hours, sound and vibration', () => {
  it('during quiet hours (22:00 to 07:00) it still arrives, silently: no sound, no vibration', async () => {
    const sent = fakePush();
    const { s } = await household();
    await turnOn(s, { breakfast: { enabled: true, time: '06:30' } });
    at('06:30');
    await sweep();
    expect(mealPushes(sent)).toHaveLength(1);
    expect(mealPushes(sent)[0]!.payload).toMatchObject({
      channel: 'reminders-silent',
      sound: null,
      vibrate: [],
      silent: true,
    });
  });

  it('outside quiet hours it has the meal sound, the meal channel and a vibration pattern', async () => {
    const sent = fakePush();
    const { s } = await household();
    await turnOn(s, { breakfast: { enabled: true } });
    at('07:30');
    await sweep();
    const payload = mealPushes(sent)[0]!.payload;
    expect(payload).toMatchObject({
      channel: 'meal-reminders',
      sound: 'meal',
      silent: false,
      requireInteraction: false,
    });
    expect(payload.vibrate.length).toBeGreaterThan(0);
  });

  it('quiet hours use the person’s time zone: 23:00 in Kolkata is quiet there, whatever the hour in UTC', async () => {
    const sent = fakePush();
    at('06:00');
    const s = await registerUser({ timeZone: 'Asia/Kolkata' });
    await s
      .auth(
        api()
          .post('/api/push/subscriptions')
          .send({ endpoint: 'https://push.example.com/send/kol2', keys: { p256dh: 'p', auth: 'a' } }),
      )
      .expect(201);
    await addFood(s, 'Dosa batter', 1);
    await turnOn(s, { lunch: { enabled: true, time: '23:00' } });
    at('17:30'); // 23:00 in Kolkata, but only 17:30 in UTC, which is not quiet there
    await sweep();
    expect(mealPushes(sent)[0]!.payload).toMatchObject({ silent: true, sound: null });
  });

  it('the sound switch and vibration switch each take effect', async () => {
    const sent = fakePush();
    const { s } = await household();
    await turnOn(s, { breakfast: { enabled: true }, lunch: { enabled: true }, dinner: { enabled: true } });

    await s.auth(api().put('/api/notifications/alerts').send({ sound: false })).expect(200);
    at('07:30');
    await sweep();
    expect(mealPushes(sent)[0]!.payload).toMatchObject({ sound: null, channel: 'reminders-silent' });

    await s.auth(api().put('/api/notifications/alerts').send({ sound: true, vibration: false })).expect(200);
    at('12:30');
    await sweep();
    expect(mealPushes(sent)[1]!.payload).toMatchObject({ sound: 'meal', vibrate: [], channel: 'meal-reminders' });

    await s
      .auth(
        api()
          .put('/api/notifications/alerts')
          .send({ vibration: true, quietHours: { enabled: false } }),
      )
      .expect(200);
    at('19:30');
    await sweep();
    expect(mealPushes(sent)[2]!.payload.sound).toBe('meal');
  });
});

describe('meal reminders and the daily summary', () => {
  it('within 30 minutes of each other, only the meal reminder goes, with the summary in it', async () => {
    const sent = fakePush();
    const { s } = await household(); // summary at 08:00; breakfast at 07:30 is exactly 30 minutes before
    await turnOn(s, { breakfast: { enabled: true } });

    at('07:30');
    await sweep();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload.kind).toBe('MEAL');
    const body = sent[0]!.payload.body;
    // A plain message already names the items, so the summary isn't repeated.
    expect(body.match(/Bread: expected expiry today/g)).toHaveLength(1);

    at('08:00');
    await sweep();
    at('08:05');
    await sweep();
    expect(sent).toHaveLength(1); // the summary doesn't follow
    expect((await UserModel.findById(s.user.id))!.lastDigestDate).toBe(TODAY);
  });

  it('puts the summary under a planned meal or a recipe', async () => {
    const sent = fakePush();
    const { s, bread } = await household();
    await turnOn(s, { breakfast: { enabled: true } });
    await s
      .auth(
        api()
          .put(`/api/meal-plan/${TODAY}`)
          .send({ meal: 'breakfast', title: 'Toast', foodIds: [bread.id] }),
      )
      .expect(200);
    at('07:30');
    await sweep();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload.body).toBe(
      [
        'Planned: Toast. It uses Bread.',
        '',
        'Cook First: 2 items to check',
        'Bread: expected expiry today',
        'Chicken: expected expiry in 1 day',
      ].join('\n'),
    );
  });

  it('a meal reminder after the summary time (08:20) also carries it, and the summary waits for it', async () => {
    const sent = fakePush();
    const { s, bread } = await household();
    await turnOn(s, { breakfast: { enabled: true, time: '08:20' } });
    await s
      .auth(
        api()
          .put(`/api/meal-plan/${TODAY}`)
          .send({ meal: 'breakfast', title: 'Toast', foodIds: [bread.id] }),
      )
      .expect(200);
    at('08:00');
    await sweep();
    expect(sent).toEqual([]);
    at('08:20');
    await sweep();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload.kind).toBe('MEAL');
    expect(sent[0]!.payload.body).toContain('Cook First: 2 items to check');
  });

  it('31 minutes apart they are separate: the summary at 08:00, the meal reminder later', async () => {
    const sent = fakePush();
    const { s } = await household();
    await turnOn(s, { breakfast: { enabled: true, time: '08:31' } });
    at('08:00');
    await sweep();
    expect(sent.map((entry) => entry.payload.kind)).toEqual(['DIGEST']);
    at('08:31');
    await sweep();
    expect(sent.map((entry) => entry.payload.kind)).toEqual(['DIGEST', 'MEAL']);
    expect(sent[1]!.payload.body).not.toContain('items to check');
  });

  it('a lunch reminder far from the summary is separate too', async () => {
    const sent = fakePush();
    const { s } = await household();
    await turnOn(s, { lunch: { enabled: true } });
    at('08:00');
    await sweep();
    at('12:30');
    await sweep();
    expect(sent.map((entry) => entry.payload.kind)).toEqual(['DIGEST', 'MEAL']);
  });

  it('the summary still goes if the meal reminder it was waiting for can no longer be sent', async () => {
    const sent = fakePush();
    const { s } = await household();
    await turnOn(s, { breakfast: { enabled: true } }); // 07:30, but the server was down until 08:00
    at('08:00');
    await sweep();
    expect(sent.map((entry) => entry.payload.kind)).toEqual(['DIGEST']);
  });

  it('with one reminder per item there is no summary to merge', async () => {
    const sent = fakePush();
    const { s } = await household();
    await s.auth(api().put('/api/notifications/delivery').send({ mode: 'EACH_ITEM', hour: 8 })).expect(200);
    await turnOn(s, { breakfast: { enabled: true } });
    at('07:30');
    await sweep();
    const meal = mealPushes(sent);
    expect(meal).toHaveLength(1);
    expect(meal[0]!.payload.body).not.toContain('items to check');
  });
});

describe('"Snooze 30 min" and "Show recipe"', () => {
  async function sentOnce() {
    const sent = fakePush();
    const { s, bread } = await household();
    await turnOn(s, { breakfast: { enabled: true } });
    await s
      .auth(
        api()
          .put(`/api/meal-plan/${TODAY}`)
          .send({ meal: 'breakfast', title: 'Toast', foodIds: [bread.id] }),
      )
      .expect(200);
    at('07:30');
    await sweep();
    return { sent, s, token: sent[0]!.payload.actionToken! };
  }

  it('reminds again 30 minutes later, with the same notification replaced', async () => {
    const { sent, token } = await sentOnce();
    await api().post('/api/push/actions').send({ token, action: 'SNOOZE_MEAL' }).expect(204);

    at('07:59');
    await sweep();
    expect(sent).toHaveLength(1);
    at('08:00');
    await sweep();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.payload).toMatchObject({
      kind: 'MEAL',
      tag: sent[0]!.payload.tag,
      title: 'Time to cook breakfast',
    });
    // Once only.
    at('08:30');
    await sweep();
    expect(sent).toHaveLength(2);
  });

  it('can be snoozed again', async () => {
    const { sent } = await sentOnce();
    await api()
      .post('/api/push/actions')
      .send({ token: sent[0]!.payload.actionToken, action: 'SNOOZE_MEAL' })
      .expect(204);
    at('08:00');
    await sweep();
    await api()
      .post('/api/push/actions')
      .send({ token: sent[1]!.payload.actionToken, action: 'SNOOZE_MEAL' })
      .expect(204);
    at('08:30');
    await sweep();
    expect(sent).toHaveLength(3);
  });

  it('only works with a meal token: a food token, an invalid token or another action is refused', async () => {
    const { s, sent } = await sentOnce();
    const foodToken = signActionToken(s.user.id, 'a'.repeat(24));
    await api().post('/api/push/actions').send({ token: foodToken, action: 'SNOOZE_MEAL' }).expect(401);
    await api().post('/api/push/actions').send({ token: 'not-a-token', action: 'SNOOZE_MEAL' }).expect(401);
    // A meal token can't be used to snooze or use food.
    await api().post('/api/push/actions').send({ token: sent[0]!.payload.actionToken, action: 'SNOOZE' }).expect(401);
    await api().post('/api/push/actions').send({ token: sent[0]!.payload.actionToken, action: 'USED' }).expect(401);
    // And it isn't a login token.
    await api().get('/api/foods').set('Authorization', `Bearer ${sent[0]!.payload.actionToken}`).expect(401);
  });

  it('is refused for a reminder that was never sent that day', async () => {
    const { s } = await sentOnce();
    const token = signMealActionToken(s.user.id, 'lunch', TODAY);
    await api().post('/api/push/actions').send({ token, action: 'SNOOZE_MEAL' }).expect(404);
  });

  it('GET /meal-reminders/:meal shows what today’s reminder said, only to its owner', async () => {
    const { s } = await sentOnce();
    const res = await s.auth(api().get('/api/meal-reminders/breakfast')).expect(200);
    expect(res.body).toMatchObject({ meal: 'breakfast', date: TODAY, content: { source: 'plan', title: 'Toast' } });
    await s.auth(api().get('/api/meal-reminders/lunch')).expect(404);
    await s.auth(api().get('/api/meal-reminders/supper')).expect(400);
    const other = await registerUser();
    await other.auth(api().get('/api/meal-reminders/breakfast')).expect(404);
    await api().get('/api/meal-reminders/breakfast').expect(401);
  });

  it('shows the recipe with its steps when the reminder was a recipe idea', async () => {
    fakePush();
    fakeAi('Cheesy toast');
    const { s } = await household();
    await turnOn(s, { breakfast: { enabled: true } });
    at('07:30');
    await sweep();
    const res = await s.auth(api().get('/api/meal-reminders/breakfast')).expect(200);
    expect(res.body.content).toMatchObject({
      source: 'recipe',
      recipe: { title: 'Cheesy toast', minutes: 15, steps: ['Cook it.', 'Serve it.'] },
    });
  });
});

describe('push payloads: channel and sound for each reminder type', () => {
  /** One reminder per item at 08:00, for one food in each state. */
  async function oneEach() {
    const sent = fakePush();
    at('06:00');
    const s = await registerUser({ timeZone: 'UTC' });
    await s
      .auth(
        api()
          .post('/api/push/subscriptions')
          .send({ endpoint: 'https://push.example.com/send/each', keys: { p256dh: 'p', auth: 'a' } }),
      )
      .expect(201);
    await s.auth(api().put('/api/notifications/delivery').send({ mode: 'EACH_ITEM', hour: 8 })).expect(200);
    await addFood(s, 'Yoghurt', 2); // approaching: 2 days left
    await addFood(s, 'Bread', 0); // due today
    await addFood(s, 'Ham', 1, '2026-10-01'); // expected expiry was yesterday: overdue
    return { sent, s };
  }
  const byBody = (sent: { payload: PushPayload }[], text: string) =>
    sent.find((e) => e.payload.body.includes(text))!.payload;

  it('approaching expiry: gentle sound, the food-soon channel, and it does not stay on screen', async () => {
    const { sent } = await oneEach();
    at('08:00');
    await sweep();
    expect(byBody(sent, 'Yoghurt')).toMatchObject({
      kind: 'APPROACHING_EXPIRY',
      channel: 'food-soon',
      sound: 'gentle',
      requireInteraction: false,
      silent: false,
    });
  });

  it('due and overdue: the strong sound, the food-urgent channel, vibration, and they stay until acted on', async () => {
    const { sent } = await oneEach();
    at('08:00');
    await sweep();
    for (const [food, kind] of [
      ['Bread', 'DUE'],
      ['Ham', 'OVERDUE'],
    ] as const) {
      const payload = byBody(sent, food);
      expect(payload, food).toMatchObject({
        kind,
        channel: 'food-urgent',
        sound: 'strong',
        requireInteraction: true,
        silent: false,
      });
      expect(payload.vibrate.length, food).toBeGreaterThan(2);
      expect(payload.tag).toMatch(/^food-/); // a repeat replaces the earlier notification
    }
  });

  it('the daily summary is gentle', async () => {
    const sent = fakePush();
    const { s } = await household();
    expect(s).toBeTruthy();
    at('08:00');
    await sweep();
    expect(sent[0]!.payload).toMatchObject({
      kind: 'DIGEST',
      channel: 'food-soon',
      sound: 'gentle',
      requireInteraction: false,
    });
  });

  it('in quiet hours every kind arrives silently, but due and overdue still stay on screen', async () => {
    const { sent, s } = await oneEach();
    await s.auth(api().put('/api/notifications/delivery').send({ hour: 23 })).expect(200);
    at('23:00');
    await sweep();
    expect(sent).toHaveLength(3);
    for (const { payload } of sent) {
      expect(payload).toMatchObject({ channel: 'reminders-silent', sound: null, vibrate: [], silent: true });
    }
    expect(byBody(sent, 'Bread').requireInteraction).toBe(true);
    expect(byBody(sent, 'Ham').requireInteraction).toBe(true);
    expect(byBody(sent, 'Yoghurt').requireInteraction).toBe(false);
  });

  it('with sounds off, due reminders still vibrate on their own channel; with vibration off they only sound', async () => {
    const { sent, s } = await oneEach();
    await s.auth(api().put('/api/notifications/alerts').send({ sound: false })).expect(200);
    at('08:00');
    await sweep();
    expect(byBody(sent, 'Bread')).toMatchObject({ channel: 'reminders-vibrate', sound: null, silent: false });

    sent.length = 0;
    await s.auth(api().put('/api/notifications/alerts').send({ sound: true, vibration: false })).expect(200);
    await MealReminderLogModel.deleteMany({});
    await UserModel.updateOne({ _id: s.user.id }, { $set: { lastDigestDate: null } });
    // The same reminders have been pushed already today; a new day sends them again.
    at('08:00', '2026-10-04');
    await sweep();
    expect(sent.length).toBeGreaterThan(0);
    for (const { payload } of sent.filter((e) => e.payload.requireInteraction)) {
      expect(payload).toMatchObject({ channel: 'food-urgent-sound', sound: 'strong', vibrate: [] });
    }
  });
});

describe('the Firebase provider, for the sounds', () => {
  const target = (platform: 'android' | 'ios'): PushTarget => ({
    platform,
    endpoint: `${platform}:t`,
    token: 'device-token',
  });
  function fake() {
    const messages: Record<string, unknown>[] = [];
    return {
      messages,
      messaging: { send: async (message: Record<string, unknown>) => (messages.push(message), 'id') },
    };
  }
  const payload = (overrides: Partial<PushPayload> = {}): PushPayload => ({
    title: 'Time to cook dinner',
    body: 'Planned: Stew.',
    tag: 'meal-dinner-2026-10-03',
    url: '/meal/dinner',
    kind: 'MEAL',
    channel: 'meal-reminders',
    sound: 'meal',
    vibrate: [160, 80, 160],
    requireInteraction: false,
    silent: false,
    actionToken: 'meal-token',
    actions: [
      { action: 'COOKED', title: 'Cooked it', url: '/add?leftover=1' },
      { action: 'RECIPE', title: 'Show recipe', url: '/meal/dinner' },
      { action: 'SNOOZE_MEAL', title: 'Snooze 30 min' },
    ],
    ...overrides,
  });

  it('sends Android the channel to use, and which buttons open a page', async () => {
    const { messages, messaging } = fake();
    await createFcmPushProvider(messaging).send(target('android'), payload());
    const data = (messages[0] as { data: Record<string, string> }).data;
    expect(data).toMatchObject({ channelId: 'meal-reminders', kind: 'MEAL', silent: 'false' });
    expect(JSON.parse(data.actionUrls!)).toEqual({ COOKED: '/add?leftover=1', RECIPE: '/meal/dinner' });
    for (const value of Object.values(data)) expect(typeof value).toBe('string');
  });

  it('sends Android a due reminder on the urgent channel, and a quiet one on the silent channel', async () => {
    const { messages, messaging } = fake();
    const provider = createFcmPushProvider(messaging);
    await provider.send(target('android'), payload({ kind: 'DUE', channel: 'food-urgent', sound: 'strong' }));
    await provider.send(
      target('android'),
      payload({ channel: 'reminders-silent', sound: null, vibrate: [], silent: true }),
    );
    const [urgent, quiet] = messages as { data: Record<string, string> }[];
    expect(urgent!.data.channelId).toBe('food-urgent');
    expect(quiet!.data).toMatchObject({ channelId: 'reminders-silent', silent: 'true' });
  });

  it('sends iPhone the bundled .caf sound for each kind, and the meal category', async () => {
    const { messages, messaging } = fake();
    const provider = createFcmPushProvider(messaging);
    await provider.send(target('ios'), payload());
    await provider.send(target('ios'), payload({ kind: 'DUE', sound: 'strong', channel: 'food-urgent' }));
    await provider.send(target('ios'), payload({ kind: 'DIGEST', sound: 'gentle', channel: 'food-soon' }));
    const aps = (messages as { apns: { payload: { aps: Record<string, unknown> } } }[]).map((m) => m.apns.payload.aps);
    expect(aps.map((a) => a.sound)).toEqual(['meal.caf', 'strong.caf', 'gentle.caf']);
    expect(aps[0]).toMatchObject({ category: IOS_MEAL_CATEGORY, 'interruption-level': 'active' });
    expect(aps[1]).toMatchObject({ category: 'FOOD_ITEM' });
  });

  it('sends iPhone no sound at all, and a passive interruption level, when delivered silently', async () => {
    const { messages, messaging } = fake();
    await createFcmPushProvider(messaging).send(target('ios'), payload({ sound: null, vibrate: [], silent: true }));
    const aps = (messages[0] as { apns: { payload: { aps: Record<string, unknown> } } }).apns.payload.aps;
    expect(aps).not.toHaveProperty('sound');
    expect(aps['interruption-level']).toBe('passive');
  });

  it('never asks for a critical alert, a full-screen alarm or a ringing notification', async () => {
    const { messages, messaging } = fake();
    const provider = createFcmPushProvider(messaging);
    for (const kind of ['DUE', 'OVERDUE', 'MEAL'] as const) {
      await provider.send(target('ios'), payload({ kind, requireInteraction: true }));
      await provider.send(target('android'), payload({ kind, requireInteraction: true }));
    }
    const text = JSON.stringify(messages);
    expect(text).not.toMatch(/critical|fullScreen|full_screen|alarm|ongoing/i);
    for (const message of messages as { apns?: { payload: { aps: Record<string, unknown> } } }[]) {
      expect(message.apns?.payload.aps['interruption-level']).not.toBe('critical');
      expect(message.apns?.payload.aps['interruption-level']).not.toBe('time-sensitive');
    }
  });
});

describe('meal plans with a meal', () => {
  it('keep a breakfast, a lunch and a dinner on one day; the dinner is the day’s main entry', async () => {
    const s = await registerUser();
    at('06:00');
    const put = (meal: string, title: string) =>
      s.auth(api().put(`/api/meal-plan/${TODAY}`).send({ meal, title })).expect(200);
    await put('breakfast', 'Porridge');
    await put('dinner', 'Stew');
    await put('lunch', 'Soup');
    const plan = await s.auth(api().get('/api/meal-plan')).expect(200);
    const day = plan.body.days[0];
    expect(day.entry).toMatchObject({ meal: 'dinner', title: 'Stew' });
    expect(Object.keys(day.meals).sort()).toEqual(['breakfast', 'dinner', 'lunch']);
    expect(day.meals.breakfast.title).toBe('Porridge');
  });

  it('default to dinner, replace the same meal, and clear one meal at a time', async () => {
    const s = await registerUser();
    at('06:00');
    await s.auth(api().put(`/api/meal-plan/${TODAY}`).send({ title: 'Stew' })).expect(200);
    await s.auth(api().put(`/api/meal-plan/${TODAY}`).send({ title: 'Curry' })).expect(200);
    await s.auth(api().put(`/api/meal-plan/${TODAY}`).send({ meal: 'lunch', title: 'Soup' })).expect(200);
    let day = (await s.auth(api().get('/api/meal-plan'))).body.days[0];
    expect(day.entry.title).toBe('Curry');
    expect(day.meals.lunch.title).toBe('Soup');

    await s.auth(api().delete(`/api/meal-plan/${TODAY}?meal=lunch`)).expect(204);
    day = (await s.auth(api().get('/api/meal-plan'))).body.days[0];
    expect(day.meals.lunch).toBeUndefined();
    expect(day.entry.title).toBe('Curry');

    await s.auth(api().delete(`/api/meal-plan/${TODAY}`)).expect(204); // no meal: the dinner
    day = (await s.auth(api().get('/api/meal-plan'))).body.days[0];
    expect(day.entry).toBeNull();
  });

  it('reject an unknown meal', async () => {
    const s = await registerUser();
    at('06:00');
    await s.auth(api().put(`/api/meal-plan/${TODAY}`).send({ meal: 'supper', title: 'Stew' })).expect(400);
    await s.auth(api().delete(`/api/meal-plan/${TODAY}?meal=supper`)).expect(400);
  });
});
