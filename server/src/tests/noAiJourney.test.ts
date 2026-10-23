import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PushPayload } from '@cook-first/shared';
import { setAiClient } from '../services/aiClient.js';
import { clock } from '../services/clock.js';
import { sweep } from '../services/notificationService.js';
import { setProductClient, type ProductClient } from '../services/productClient.js';
import { setPushProvider } from '../services/pushProvider.js';
import { api, registerUser } from './helpers.js';

/**
 * The main user journey with AI completely unavailable (no provider, no key, so aiClient() is null). Every
 * feature that does not need a model must work exactly the same: barcode look-up, automatic expiry estimation,
 * manual entry, reminders in plain text and the Cook First list. The AI-only extras say so plainly instead of failing.
 */

afterEach(() => {
  setAiClient(null);
  setProductClient(null);
  setPushProvider(null);
  clock.set(null);
  vi.restoreAllMocks();
});

const EAN = '4006381333931';

function fakeProducts() {
  const client: ProductClient = {
    async lookup() {
      return { name: 'Whole milk', brands: 'Acme Dairy', quantity: 1000, quantityUnit: 'ml' };
    },
  };
  setProductClient(client);
}

describe('with AI unavailable', () => {
  it('runs the whole journey: scan, estimate, type in, list, remind', async () => {
    const at = (hhmm: string) => clock.set(new Date(`2026-09-29T${hhmm}:00Z`));
    at('06:00');
    setAiClient(null);
    fakeProducts();
    const sent: PushPayload[] = [];
    setPushProvider({
      name: 'fake',
      publicKey: 'PUBLIC-KEY',
      async send(_target, payload) {
        sent.push(payload);
        return 'SENT';
      },
    });
    const s = await registerUser({ timeZone: 'UTC' });
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

    // The app reports AI as off, and nothing else depends on it.
    const status = await s.auth(api().get('/api/ai/status')).expect(200);
    expect(status.body).toMatchObject({ enabled: false, photoCheck: false });

    // 1. Barcode look-up uses the product database, not the AI.
    const scanned = await s.auth(api().get('/api/products/barcode').query({ code: EAN })).expect(200);
    expect(scanned.body).toMatchObject({ found: true, name: 'Whole milk', quantity: 1000, unit: 'ml' });

    // 2. Adding it needs no lifespan: the expected expiry is estimated, and the date printed on the pack
    //    (typed or read on the device) is used when it is the earliest.
    const milk = await s
      .auth(
        api().post('/api/foods').send({
          name: scanned.body.name,
          quantity: scanned.body.quantity,
          unit: scanned.body.unit,
          printedDate: '2026-09-30',
          printedDateType: 'USE_BY',
        }),
      )
      .expect(201);
    expect(milk.body).toMatchObject({
      storage: 'FRIDGE',
      addedDate: '2026-09-29',
      expiryDate: '2026-09-30',
      expirySource: 'PRINTED_DATE',
    });

    // 3. Manual entry, with and without a lifespan.
    const bread = await s.auth(api().post('/api/foods').send({ name: 'Bread', quantity: 1, unit: 'pack' })).expect(201);
    expect(bread.body).toMatchObject({ storage: 'PANTRY', expirySource: 'CATALOG' });
    const jam = await s
      .auth(api().post('/api/foods').send({ name: 'Jam', quantity: 1, unit: 'pcs', lifespanDays: 90 }))
      .expect(201);
    expect(jam.body).toMatchObject({ expirySource: 'USER', lifespanDays: 90 });

    // 4. Moving and opening re-estimate without any AI, and never extend the expected expiry.
    const opened = await s.auth(api().post(`/api/foods/${bread.body.id}/open`).send({})).expect(200);
    expect(opened.body.expiryDate <= bread.body.expiryDate).toBe(true);

    // 5. The Cook First list is the most urgent food, in order.
    const cookFirst = await s.auth(api().get('/api/foods/cook-first')).expect(200);
    expect(cookFirst.body.items[0]).toMatchObject({ id: milk.body.id, urgency: 'APPROACHING_EXPIRY' });

    // 6. A meal reminder is plain text built from the Cook First list, with no recipe idea behind it.
    await s
      .auth(
        api()
          .put('/api/notifications/meals')
          .send({ breakfast: { enabled: true, time: '07:30' } }),
      )
      .expect(200);
    at('07:30');
    await sweep();
    const mealPush = sent.find((payload) => payload.kind === 'MEAL');
    expect(mealPush?.body).toMatch(/Whole milk/);
    expect(mealPush?.body).toMatch(/expected expiry/i);

    // 7. The AI-only extras say so plainly instead of failing.
    const photo = { mediaType: 'image/png', image: 'AAAA' };
    for (const [path, body] of [
      ['/api/ai/recipes', {}],
      ['/api/ai/meal-plan', {}],
      ['/api/parse/receipt', photo],
      ['/api/parse/date', photo],
    ] as const) {
      const res = await s.auth(api().post(path).send(body)).expect(503);
      expect(res.body.error.code).toBe('AI_UNAVAILABLE');
    }
  });
});
