/**
 * Writes shared/test-cases/validation.json: what each request schema in shared/src/schemas.ts says about a
 * bank of inputs, in the form the API answers with. The server reports only the first problem
 * (server/src/middleware/validate.ts), so each case records that issue's message and dotted field, or, for a
 * valid input, the parsed value (with defaults filled in and text trimmed).
 *
 * The Python server's Pydantic models must give the same answers, word for word. Run this again on purpose
 * after changing a schema or upgrading zod (npm run cases:validation -w shared); Vitest fails until you do.
 *
 * Inputs: a valid example of each schema, then every field removed, set to null, given the wrong type,
 * emptied, made too long or pushed past its limits, plus hand-written cases for each schema's own rules.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZodType } from 'zod';
import * as schemas from '../src/schemas.js';
import { validationResult } from '../src/validationResult.js';

type Input = unknown;
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-cases/validation.json');
const ID = '0123456789abcdef01234567';
/** A UUIDv7, the Python server's form of an id, and near misses of it. */
const UUID = '0192f3c4-7b1e-7c2a-9d4e-3f6a8b2c1d00';
const NOT_UUIDS = [UUID.replaceAll('-', ''), `{${UUID}}`, UUID.slice(0, -1), `${UUID}0`, UUID.replace('0192', '0g92')];
const long = (n: number) => 'a'.repeat(n);
const emoji = (n: number) => String.fromCodePoint(0x1f600).repeat(n);

/** Changes every field of `base` in the usual ways, one at a time. */
function mutations(base: Record<string, unknown>): Input[] {
  const out: Input[] = [];
  for (const [key, value] of Object.entries(base)) {
    const without = { ...base };
    delete without[key];
    out.push(without, { ...base, [key]: null });
    if (typeof value === 'string') {
      out.push({ ...base, [key]: 123 }, { ...base, [key]: '' }, { ...base, [key]: '   ' });
      for (const n of [41, 61, 81, 129, 201, 1001]) out.push({ ...base, [key]: long(n) });
      // zod counts code points and text.length counts UTF-16 units: an emoji is one and two.
      for (const n of [26, 41, 61]) out.push({ ...base, [key]: emoji(n) });
      out.push({ ...base, [key]: ` ${value} ` });
    } else if (typeof value === 'number') {
      out.push({ ...base, [key]: String(value) }, { ...base, [key]: 0 }, { ...base, [key]: -1 });
      out.push({ ...base, [key]: 1.5 }, { ...base, [key]: 366 }, { ...base, [key]: 1e12 }, { ...base, [key]: true });
    } else if (typeof value === 'boolean') {
      out.push({ ...base, [key]: 'true' }, { ...base, [key]: 1 });
    } else if (Array.isArray(value)) {
      out.push({ ...base, [key]: 'x' }, { ...base, [key]: [] }, { ...base, [key]: {} });
    } else if (value && typeof value === 'object') {
      out.push({ ...base, [key]: 'x' }, { ...base, [key]: [] }, { ...base, [key]: {} });
    }
  }
  return out;
}

/** Inputs that are not an object at all, an empty object, an unknown field, and every field wrong at once. */
function shapes(base: Record<string, unknown>): Input[] {
  const allWrong = Object.fromEntries(Object.keys(base).map((key) => [key, { wrong: true }]));
  return [{}, null, [], 'text', 5, { ...base, unknownField: 'x' }, allWrong];
}

const food = {
  name: 'Milk',
  quantity: 1,
  unit: 'l',
  addedDate: '2026-10-23',
  lifespanDays: 5,
  notes: 'Top shelf',
  storage: 'FRIDGE',
  openedDate: null,
  leftover: false,
  price: 2.5,
  printedDate: '2026-10-30',
  printedDateType: 'USE_BY',
  category: 'dairy',
};
const web = {
  endpoint: 'https://push.example.com/send/abc',
  keys: { p256dh: 'p256', auth: 'auth' },
  browser: 'Chrome',
};
const native = { platform: 'android', token: 'f'.repeat(30), browser: 'FridgeStock app on Android' };
const image = { mediaType: 'image/jpeg', image: 'aGVsbG8gd29ybGQ=' };

/** Each schema with its valid example and its own cases. */
const SCHEMAS: Record<string, { base: Record<string, unknown>; extra?: Input[] }> = {
  registerSchema: {
    base: { name: 'Sam', email: 'Sam@Example.com', password: 'password1', timeZone: 'Europe/London' },
    extra: [
      { name: 'Sam', email: '  SAM@EXAMPLE.COM ', password: 'password1' },
      { name: 'Sam', email: 'not-an-email', password: 'password1' },
      { name: 'Sam', email: 'sam@localhost', password: 'password1' },
      { name: 'Sam', email: 'sam@example.com', password: '1234567' },
      { name: 'Sam', email: 'sam@example.com', password: '12345678' },
      { name: 'Sam', email: 'sam@example.com', password: long(128) },
      { name: 'Sam', email: 'sam@example.com', password: long(129) },
      { name: ' Sam ', email: 'sam@example.com', password: 'password1' },
      { name: long(50), email: 'sam@example.com', password: 'password1' },
      { name: long(51), email: 'sam@example.com', password: 'password1' },
    ],
  },
  loginSchema: { base: { email: 'sam@example.com', password: 'x', timeZone: 'UTC' } },
  deleteAccountSchema: { base: { password: 'x' } },
  joinHouseholdSchema: {
    base: { code: 'ab12-cd34' },
    extra: [{ code: ' AB12 CD34 ' }, { code: '--' }, { code: long(20) }, { code: long(21) }, { code: 'a-b-c' }],
  },
  inviteCodeParamSchema: { base: { code: 'AB12CD34' } },
  updateAccountSchema: {
    base: { name: 'Sam', timeZone: 'UTC', currency: 'GBP', savePhotos: true, firstRunDone: false },
    extra: [{ currency: 'JPY' }, { currency: 'gbp' }, { name: '   ' }],
  },
  createFoodSchema: {
    base: food,
    extra: [
      { name: 'Milk', quantity: 1, unit: 'l' },
      { ...food, addedDate: '2026-02-30' },
      { ...food, openedDate: '2026-10-24' },
      { ...food, openedDate: 'yesterday' },
      { ...food, lifespanDays: 365 },
      { ...food, quantity: 1_000_000 },
      { ...food, quantity: 1_000_001 },
      { ...food, price: 0 },
      { ...food, price: 100_000 },
      { ...food, price: 100_000.01 },
      { ...food, unit: 'cups' },
      { ...food, storage: 'fridge' },
      { ...food, printedDateType: 'SELL_BY' },
      { ...food, expiryDate: '2030-01-01', status: 'USED' },
      { ...food, category: ` ${long(40)} ` },
      { ...food, notes: ` ${long(200)} ` },
    ],
  },
  updateFoodSchema: {
    base: { name: 'Milk', quantity: 2 },
    extra: [{ lifespanDays: 3 }, { notes: '' }, { expiryDate: '2030-01-01' }, { openedDate: null }],
  },
  receiptSchema: {
    base: image,
    extra: [
      { ...image, image: 'not base64!' },
      { ...image, image: 'aGVsbG8===' },
      { ...image, mediaType: 'image/gif' },
      { ...image, image: 'data:image/jpeg;base64,aGVsbG8=' },
    ],
  },
  barcodeSchema: {
    base: { code: '4006381333931' },
    extra: [{ code: '4006 3813-33931' }, { code: '4006381333932' }, { code: 'abc' }, { code: '96385074' }],
  },
  bulkCreateSchema: {
    base: { addedDate: '2026-10-23', storage: 'FRIDGE', items: [{ name: 'Milk', quantity: 1, unit: 'l' }] },
    extra: [
      { addedDate: '2026-10-23', items: Array.from({ length: 50 }, () => ({ name: 'Milk', quantity: 1, unit: 'l' })) },
      { addedDate: '2026-10-23', items: Array.from({ length: 51 }, () => ({ name: 'Milk', quantity: 1, unit: 'l' })) },
      {
        addedDate: '2026-10-23',
        items: [
          { name: 'Milk', quantity: 1, unit: 'l' },
          { name: '', quantity: 1, unit: 'l' },
        ],
      },
      { addedDate: '2026-10-23', items: [{ name: 'Milk', quantity: -1, unit: 'cups' }] },
      { addedDate: '2026-10-23', items: [{ name: 'Milk', quantity: 1, unit: 'l', lifespanDays: 3.5 }] },
      { addedDate: '2026-10-23', items: [{ name: 'Milk', quantity: 1, unit: 'l', printedDate: '2026-13-01' }] },
      { addedDate: '2026-10-23', items: ['Milk'] },
    ],
  },
  favouriteSchema: {
    base: { name: 'Eggs', quantity: 6, unit: 'pcs', lifespanDays: 14, storage: 'PANTRY' },
    extra: [{ name: 'Eggs', quantity: 6, unit: 'pcs', lifespanDays: 14 }],
  },
  openFoodSchema: {
    base: { openedDate: '2026-10-23', daysLeft: 3 },
    extra: [{ daysLeft: 365 }, { openedDate: '2026-2-1' }],
  },
  moveFoodSchema: { base: { storage: 'FREEZER', daysLeft: 30 } },
  useFoodSchema: { base: { quantity: 0.5 }, extra: [{ quantity: 1_000_000 }] },
  wasteFoodSchema: { base: {}, extra: [{ quantity: 2 }] },
  preferencesSchema: { base: { approachingExpiry: true, due: false, overdue: true }, extra: [{ due: true }] },
  deliverySchema: { base: { mode: 'DIGEST', hour: 8 }, extra: [{ hour: 23 }, { hour: 24 }, { mode: 'WEEKLY' }] },
  pushSubscriptionSchema: {
    base: web,
    extra: [
      ...mutations(native),
      native,
      { ...web, platform: 'web' },
      { ...web, endpoint: 'http://push.example.com/abc' },
      { ...web, endpoint: 'not a url' },
      { ...web, endpoint: `https://push.example.com/${long(1000)}` },
      { ...web, keys: { p256dh: '', auth: 'a' } },
      { ...web, keys: { p256dh: long(201), auth: 'a' } },
      { ...native, platform: 'windows' },
      { ...native, token: 'has spaces in the token here' },
      { ...native, token: 'f'.repeat(19) },
      { ...native, token: 'f'.repeat(4097) },
      { platform: 'ios', token: 'f'.repeat(30) },
    ],
  },
  pushUnsubscribeSchema: {
    base: { endpoint: web.endpoint },
    extra: [{ token: native.token }, { token: 'short' }, { endpoint: 'http://x.example' }],
  },
  pushActionSchema: {
    base: { token: 'a.b.c', action: 'USED' },
    extra: [
      { token: 'a.b.c', action: 'SNOOZE_MEAL' },
      { token: 'a.b.c', action: 'COOKED' },
      { token: long(2001), action: 'USED' },
    ],
  },
  alertSettingsSchema: {
    base: { sound: true, vibration: false, quietHours: { enabled: true, start: '22:00', end: '07:00' } },
    extra: [
      { quietHours: { start: '24:00' } },
      { quietHours: { start: '7:30' } },
      { quietHours: { end: '23:59', extra: 1 } },
      { quietHours: {} },
    ],
  },
  mealRemindersSchema: {
    base: { breakfast: { enabled: true, time: '07:30' }, lunch: { enabled: false }, dinner: { time: '19:30' } },
    extra: [{ supper: { enabled: true } }, { lunch: { time: '12:60' } }, { dinner: { enabled: 'yes' } }],
  },
  recipesRequestSchema: { base: { mealType: 'lunch' }, extra: [{ mealType: 'supper' }] },
  mealParamSchema: { base: { meal: 'lunch' }, extra: [{ meal: 'Lunch' }] },
  mealDateParamSchema: { base: { date: '2026-10-23' }, extra: [{ date: '2026-02-30' }, { date: 'today' }] },
  mealQuerySchema: { base: { meal: 'breakfast' }, extra: [{ meal: 'brunch' }] },
  shoppingItemSchema: {
    base: { name: 'Milk', quantity: 2, unit: 'l' },
    extra: [
      { name: 'Milk', quantity: 100_000 },
      { name: 'Milk', quantity: 100_001 },
      { name: long(60) },
      { name: long(61) },
    ],
  },
  shoppingUpdateSchema: {
    base: { name: 'Milk', checked: true },
    extra: [{ checked: 'yes' }, { quantity: null, unit: null }],
  },
  mealPlanEntrySchema: {
    base: { meal: 'dinner', title: 'Curry', foodIds: [ID] },
    extra: [
      { title: 'Curry' },
      { title: long(80) },
      { title: long(81) },
      { title: 'Curry', foodIds: ['not-an-id'] },
      { title: 'Curry', foodIds: [ID.toUpperCase()] },
      { title: 'Curry', foodIds: [UUID] },
      { title: 'Curry', foodIds: [UUID.toUpperCase()] },
      { title: 'Curry', foodIds: [ID, UUID] },
      ...NOT_UUIDS.map((id) => ({ title: 'Curry', foodIds: [id] })),
      { title: 'Curry', foodIds: Array.from({ length: 10 }, () => ID) },
      { title: 'Curry', foodIds: Array.from({ length: 11 }, () => ID) },
    ],
  },
  paginationSchema: {
    base: { limit: '10', offset: '5' },
    extra: [
      { limit: '0' },
      { limit: '100' },
      { limit: '101' },
      { limit: '2.5' },
      { limit: 'abc' },
      { limit: '' },
      { limit: ' 7 ' },
      { offset: '-1' },
      { limit: '1e1' },
      { limit: '0x10' },
      { limit: true },
    ],
  },
  notificationPageSchema: { base: { limit: '50', offset: '0' }, extra: [{ limit: '51' }, {}] },
  photoCheckSchema: {
    base: { ...image, foodId: ID },
    extra: [
      { ...image, foodId: 'nope' },
      image,
      { ...image, foodId: UUID },
      { ...image, foodId: UUID.toUpperCase() },
      ...NOT_UUIDS.map((foodId) => ({ ...image, foodId })),
    ],
  },
  printedDateSchema: {
    base: { ...image, locale: 'en-GB' },
    extra: [
      { ...image, locale: 'en_GB' },
      { ...image, locale: 'sr-Latn-RS' },
      { ...image, locale: 'english' },
      { ...image, locale: 'e' },
      { ...image, locale: ' fr ' },
      { ...image, locale: 'en-GB-oxendict-x' },
      { ...image, locale: `en-${'abcdefgh-'.repeat(4)}x` },
    ],
  },
  photoSizeSchema: {
    base: { size: 'thumb', v: '2026-10-23T10:00:00.000Z' },
    extra: [{}, { size: 'large' }, { v: long(41) }],
  },
};

const functions: Record<string, { args: [Input]; expected: unknown }[]> = {};
const exported = schemas as unknown as Record<string, ZodType>;
const missing = Object.keys(exported).filter((key) => key.endsWith('Schema') && !(key in SCHEMAS));
if (missing.length) throw new Error(`No validation cases for: ${missing.join(', ')}`);

for (const [name, { base, extra = [] }] of Object.entries(SCHEMAS)) {
  const inputs = [base, ...mutations(base), ...shapes(base), ...extra];
  const seen = new Set<string>();
  functions[name] = [];
  for (const input of inputs) {
    const key = JSON.stringify(input) ?? 'undefined';
    if (seen.has(key)) continue;
    seen.add(key);
    functions[name].push({ args: [input], expected: validationResult(exported[name]!, input) });
  }
}

writeFileSync(
  OUT,
  JSON.stringify(
    {
      description:
        'What each request schema (shared/src/schemas.ts) answers for each input, as the API reports it: {valid: true, data} with defaults filled in and text trimmed, or {valid: false, message, field} for the first problem (field is the dotted path, or null). Written by shared/scripts/generate-validation-cases.ts.',
      functions,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `validation.json: ${Object.values(functions).flat().length} cases for ${Object.keys(functions).length} schemas`,
);
