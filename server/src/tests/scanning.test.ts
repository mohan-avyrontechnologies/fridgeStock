import { BANNED_PHRASES, FOOD_REFERENCE } from '@cook-first/shared';
import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_DAILY_LIMIT } from '../config/ai.js';
import { AiUsageModel } from '../models/AiUsage.js';
import { FoodItemModel } from '../models/FoodItem.js';
import { setAiClient, type AiRequest } from '../services/aiClient.js';
import {
  createOpenFoodFactsClient,
  setProductClient,
  type ProductClient,
  type RawProduct,
} from '../services/productClient.js';
import { api, registerUser, setToday } from './helpers.js';

/** Phase 6: barcode and receipt scanning. Nothing here reaches the internet or the real AI. */

// Banned phrases are taken from the shared list so this file never spells them out (the source guard scans it).
const SAFE_TO_EAT = BANNED_PHRASES[1];

afterEach(() => {
  setAiClient(null);
  setProductClient(null);
  vi.restoreAllMocks();
});

type Session = Awaited<ReturnType<typeof registerUser>>;

// ---- barcodes ----

const EAN = '4006381333931';

function fakeProducts(result: RawProduct | null | Error) {
  const calls: string[] = [];
  const client: ProductClient = {
    async lookup(barcode) {
      calls.push(barcode);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  setProductClient(client);
  return calls;
}

const lookup = (s: Session, code: string) => s.auth(api().get('/api/products/barcode').query({ code }));

const milk: RawProduct = { name: 'Whole milk', brands: 'Acme Dairy, Other', quantity: 1000, quantityUnit: 'ml' };

describe('GET /api/products/barcode', () => {
  it('needs a signed-in user', async () => {
    await api().get('/api/products/barcode').query({ code: EAN }).expect(401);
  });

  it('rejects a missing, non-numeric or mistyped code before any lookup', async () => {
    const calls = fakeProducts(milk);
    const s = await registerUser();
    for (const code of ['', 'abc', '123', '4006381333932', '12345678901234567']) {
      const res = await lookup(s, code).expect(400);
      expect(res.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        field: 'code',
        message: 'Enter the 8 to 14 digits printed under the barcode.',
      });
    }
    await s.auth(api().get('/api/products/barcode')).expect(400);
    expect(calls).toEqual([]);
  });

  it('returns the name, first brand and pack size of a product it finds', async () => {
    const calls = fakeProducts(milk);
    const s = await registerUser();
    const res = await lookup(s, EAN).expect(200);
    expect(res.body).toEqual({
      found: true,
      barcode: EAN,
      name: 'Whole milk',
      brand: 'Acme Dairy',
      quantity: 1000,
      unit: 'ml',
    });
    expect(calls).toEqual([EAN]);
  });

  it('accepts spaces and dashes in the number and looks up the digits only', async () => {
    const calls = fakeProducts(milk);
    const s = await registerUser();
    await lookup(s, '4006 3813-33931').expect(200);
    expect(calls).toEqual([EAN]);
  });

  it('converts centilitres and decilitres to millilitres, and keeps grams and kilograms', async () => {
    const s = await registerUser();
    fakeProducts({ ...milk, quantity: 50, quantityUnit: 'cl' });
    expect((await lookup(s, EAN).expect(200)).body).toMatchObject({ quantity: 500, unit: 'ml' });
    fakeProducts({ ...milk, quantity: 2, quantityUnit: 'dl' });
    expect((await lookup(s, EAN).expect(200)).body).toMatchObject({ quantity: 200, unit: 'ml' });
    fakeProducts({ ...milk, quantity: 400, quantityUnit: 'g' });
    expect((await lookup(s, EAN).expect(200)).body).toMatchObject({ quantity: 400, unit: 'g' });
    fakeProducts({ ...milk, quantity: 1.5, quantityUnit: 'KG' });
    expect((await lookup(s, EAN).expect(200)).body).toMatchObject({ quantity: 1.5, unit: 'kg' });
  });

  it('leaves the pack size blank when its unit is not one the app knows', async () => {
    const s = await registerUser();
    fakeProducts({ ...milk, quantity: 12, quantityUnit: 'oz' });
    expect((await lookup(s, EAN).expect(200)).body).toMatchObject({ found: true, quantity: null, unit: null });
    fakeProducts({ ...milk, quantity: null, quantityUnit: null });
    expect((await lookup(s, EAN).expect(200)).body).toMatchObject({ found: true, quantity: null, unit: null });
  });

  it('says "not found" (not an error) for an unknown product or one with no name', async () => {
    const s = await registerUser();
    const none = { found: false, barcode: EAN, name: null, brand: null, quantity: null, unit: null };
    fakeProducts(null);
    expect((await lookup(s, EAN).expect(200)).body).toEqual(none);
    fakeProducts({ ...milk, name: null });
    expect((await lookup(s, EAN).expect(200)).body).toEqual(none);
  });

  it('never shows a product name that breaks the wording rules', async () => {
    fakeProducts({ ...milk, name: `Tinned beans, ${SAFE_TO_EAT}` });
    const s = await registerUser();
    expect((await lookup(s, EAN).expect(200)).body).toMatchObject({ found: false, name: null });
  });

  it('keeps a very long name within the 60 characters a food name may have', async () => {
    fakeProducts({ ...milk, name: 'A'.repeat(200) });
    const s = await registerUser();
    expect((await lookup(s, EAN).expect(200)).body.name).toHaveLength(60);
  });

  it('is a 503 with a helpful message when the product database cannot be reached', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fakeProducts(new Error('connect ETIMEDOUT'));
    const s = await registerUser();
    const res = await lookup(s, EAN).expect(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body.error.message).toContain('Type the name instead');
    expect(JSON.stringify(res.body)).not.toContain('ETIMEDOUT');
  });
});

describe('the Open Food Facts client', () => {
  const reply = (status: number, body: unknown = {}) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('asks for only the fields it needs, says who it is, and times out', async () => {
    const fetchFn = reply(200, {
      status: 1,
      product: { product_name: ' Oat drink ', brands: 'Oatly', product_quantity: '1000', product_quantity_unit: 'ml' },
    });
    const client = createOpenFoodFactsClient('https://off.example/', fetchFn);
    expect(await client.lookup(EAN)).toEqual({
      name: 'Oat drink',
      brands: 'Oatly',
      quantity: 1000,
      quantityUnit: 'ml',
    });
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://off.example/api/v2/product/${EAN}.json?fields=product_name,brands,product_quantity,product_quantity_unit`,
    );
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^CookFirst\//);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('treats a 404 or status 0 as "not in the database", and anything else as a failure', async () => {
    expect(await createOpenFoodFactsClient('https://x', reply(404)).lookup(EAN)).toBeNull();
    expect(await createOpenFoodFactsClient('https://x', reply(200, { status: 0 })).lookup(EAN)).toBeNull();
    await expect(createOpenFoodFactsClient('https://x', reply(500)).lookup(EAN)).rejects.toThrow('500');
  });

  it('ignores blank or invalid fields', async () => {
    const client = createOpenFoodFactsClient(
      'https://x',
      reply(200, { status: 1, product: { product_name: '  ', product_quantity: 'lots', brands: 7 } }),
    );
    expect(await client.lookup(EAN)).toEqual({ name: null, brands: null, quantity: null, quantityUnit: null });
  });
});

// ---- receipts ----

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

const PHOTO = Buffer.from('not really a jpeg, but it is base64 text').toString('base64');
const scan = (s: Session, body: Record<string, unknown> = {}) =>
  s.auth(
    api()
      .post('/api/parse/receipt')
      .send({ mediaType: 'image/jpeg', image: PHOTO, ...body }),
  );

const receipt = {
  purchaseDate: '2026-09-28',
  items: [
    { name: 'Milk', quantity: 2, unit: 'l', price: 2.4 },
    { name: 'Chicken', quantity: 0.6504, unit: 'kg', price: 5.499 },
    { name: 'Bananas', quantity: 1, unit: 'bunch', price: null },
  ],
};

describe('POST /api/parse/receipt', () => {
  it('needs a signed-in user, and AI turned on', async () => {
    await api().post('/api/parse/receipt').send({ mediaType: 'image/jpeg', image: PHOTO }).expect(401);
    const s = await registerUser();
    const res = await scan(s).expect(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
  });

  it('rejects a missing, unsupported or malformed photo before asking the AI', async () => {
    const calls = fakeAi(receipt);
    const s = await registerUser();
    await scan(s, { image: '' }).expect(400);
    await scan(s, { image: undefined }).expect(400);
    await scan(s, { mediaType: 'image/gif' }).expect(400);
    await scan(s, { mediaType: undefined }).expect(400);
    const prefixed = await scan(s, { image: `data:image/jpeg;base64,${PHOTO}` }).expect(400);
    expect(prefixed.body.error.field).toBe('image');
    await scan(s, { image: 'not base64 !!' }).expect(400);
    expect(calls).toEqual([]);
  });

  it('sends the photo with a receipt-reading prompt, and returns the lines as a draft', async () => {
    setToday('2026-09-29');
    const calls = fakeAi(receipt);
    const s = await registerUser();
    const res = await scan(s).expect(200);
    expect(res.body).toEqual({
      purchaseDate: '2026-09-28',
      items: [
        { name: 'Milk', quantity: 2, unit: 'l', price: 2.4 },
        { name: 'Chicken', quantity: 0.65, unit: 'kg', price: 5.5 },
        { name: 'Bananas', quantity: 1, unit: 'bunch', price: null },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.images).toEqual([{ mediaType: 'image/jpeg', base64: PHOTO }]);
    expect(calls[0]!.system).toContain('grocery receipts');
    expect(calls[0]!.prompt).toContain('Today is 2026-09-29');
    for (const known of FOOD_REFERENCE.slice(0, 5)) expect(calls[0]!.prompt).toContain(known.name);
    // The schema allows only the units the app knows.
    expect(JSON.stringify(calls[0]!.schema)).toContain('"bunch"');
  });

  it('saves nothing: the lines are a draft for the person to check', async () => {
    fakeAi(receipt);
    const s = await registerUser();
    await scan(s).expect(200);
    expect(await FoodItemModel.countDocuments({})).toBe(0);
  });

  it('leaves the date blank when it is in the future or not a real day', async () => {
    setToday('2026-09-29');
    const s = await registerUser();
    for (const purchaseDate of ['2026-10-05', '2026-02-31', 'last Tuesday', null]) {
      fakeAi({ ...receipt, purchaseDate });
      expect((await scan(s).expect(200)).body.purchaseDate, String(purchaseDate)).toBeNull();
    }
    fakeAi({ ...receipt, purchaseDate: '2026-09-29' });
    expect((await scan(s).expect(200)).body.purchaseDate).toBe('2026-09-29');
  });

  it('can come back with no food lines at all', async () => {
    fakeAi({ purchaseDate: null, items: [] });
    const s = await registerUser();
    expect((await scan(s).expect(200)).body).toEqual({ purchaseDate: null, items: [] });
  });

  it('counts toward the daily AI allowance, and stops at the limit', async () => {
    setToday('2026-09-29');
    fakeAi(receipt);
    const s = await registerUser();
    await scan(s).expect(200);
    expect((await AiUsageModel.findOne({ date: '2026-09-29' }))!.count).toBe(1);
    await AiUsageModel.updateOne({ date: '2026-09-29' }, { $set: { count: AI_DAILY_LIMIT } });
    const res = await scan(s).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('asks again when the answer is not usable, then gives up without using up the allowance', async () => {
    setToday('2026-09-29');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = { purchaseDate: null, items: [{ name: 'Milk', quantity: 1, unit: 'oz', price: null }] };
    const calls = fakeAi(bad);
    const s = await registerUser();
    const res = await scan(s).expect(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
    expect(calls).toHaveLength(3);
    expect((await AiUsageModel.findOne({ date: '2026-09-29' }))!.count).toBe(0);
  });

  it('asks again when a name breaks the wording rules, and never returns it', async () => {
    const dodgy = {
      ...receipt,
      items: [{ name: `Tinned beans, ${SAFE_TO_EAT}`, quantity: 1, unit: 'pack', price: null }],
    };
    const calls = fakeAi(dodgy, receipt);
    const s = await registerUser();
    const res = await scan(s).expect(200);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(res.body)).not.toContain(SAFE_TO_EAT);
    expect(calls[1]!.prompt).toContain('wording');
  });

  it('accepts a large photo on this route only, and never stores it', async () => {
    const marker = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo';
    const big = marker + 'A'.repeat(3_900_000);
    fakeAi(receipt);
    const s = await registerUser();
    await scan(s, { image: big }).expect(200);
    // Other routes keep the small 20 KB limit.
    await s
      .auth(
        api()
          .post('/api/foods')
          .send({ name: 'x'.repeat(30_000) }),
      )
      .expect(413)
      .then((res) =>
        expect(res.body.error).toEqual({ code: 'VALIDATION_ERROR', message: 'That request is too large.' }),
      );
    // Nothing in any collection holds the photo.
    for (const collection of await mongoose.connection.db!.collections()) {
      const docs = await collection.find({}).toArray();
      expect(JSON.stringify(docs), collection.collectionName).not.toContain(marker);
    }
  });

  it('refuses a photo over the size limit with a clear message', async () => {
    fakeAi(receipt);
    const s = await registerUser();
    const res = await scan(s, { image: 'A'.repeat(4_000_001) }).expect(400);
    expect(res.body.error.message).toBe('That photo is too large. Try a smaller one.');
  });
});

describe('bulk add with prices (what a checked receipt becomes)', () => {
  it('keeps each row’s optional price', async () => {
    const s = await registerUser();
    await s
      .auth(
        api()
          .post('/api/foods/bulk')
          .send({
            addedDate: '2026-09-28',
            items: [
              { name: 'Milk', quantity: 2, unit: 'l', lifespanDays: 5, price: 2.4 },
              { name: 'Bananas', quantity: 1, unit: 'bunch', lifespanDays: 4 },
            ],
          }),
      )
      .expect(201);
    const prices = Object.fromEntries((await FoodItemModel.find({})).map((f) => [f.name, f.price ?? null]));
    expect(prices).toEqual({ Milk: 2.4, Bananas: null });
    await s
      .auth(
        api()
          .post('/api/foods/bulk')
          .send({
            addedDate: '2026-09-28',
            items: [{ name: 'Rice', quantity: 1, unit: 'kg', lifespanDays: 300, price: -1 }],
          }),
      )
      .expect(400);
  });
});
