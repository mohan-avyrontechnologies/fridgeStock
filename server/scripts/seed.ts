/**
 * Creates a demo account with food at every urgency level, through the public
 * API of a running server (so it works with the embedded or a real database).
 *
 *   npm run seed -w server            # create the account and sample food
 *   npm run seed -w server -- --reset # remove its active food first, then re-add
 *
 * Environment: API_URL (default http://localhost:4000/api).
 */
import { addDays, todayInTz, type FoodInput, type StorageLocation } from '@cook-first/shared';

const API = (process.env.API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');
const DEMO = { name: 'Demo Cook', email: 'demo@cookfirst.local', password: 'cookfirst-demo' };
const reset = process.argv.includes('--reset');

async function call<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(`${method} ${path} failed (${res.status}): ${text}`);
  return data as T;
}

interface Auth {
  token: string;
}

async function signIn(timeZone: string): Promise<string> {
  try {
    return (await call<Auth>('POST', '/auth/register', undefined, { ...DEMO, timeZone })).token;
  } catch (error) {
    if (!String(error).includes('(409)')) throw error;
    const { email, password } = DEMO;
    return (await call<Auth>('POST', '/auth/login', undefined, { email, password, timeZone })).token;
  }
}

// [name, quantity, unit, storage, days ago it was added, lifespan in days]
// Expected expiry = added + lifespan, so these land on every urgency level.
const SAMPLE: [string, number, FoodInput['unit'], StorageLocation, number, number][] = [
  ['Spinach', 1, 'bunch', 'FRIDGE', 7, 5], // overdue (2 days)
  ['Chicken breast', 500, 'g', 'FRIDGE', 3, 2], // overdue (1 day)
  ['Milk', 1, 'l', 'FRIDGE', 4, 4], // due today
  ['Natural yoghurt', 2, 'pcs', 'FRIDGE', 5, 6], // approaching (1 day)
  ['Mushrooms', 250, 'g', 'FRIDGE', 2, 5], // approaching (3 days)
  ['Tomatoes', 6, 'pcs', 'FRIDGE', 1, 7], // not urgent (6 days)
  ['Cheddar', 400, 'g', 'FRIDGE', 2, 21], // not urgent
  ['Bread', 1, 'pack', 'PANTRY', 3, 7], // not urgent
  ['Rice', 2, 'kg', 'PANTRY', 10, 365], // not urgent
  ['Frozen peas', 1, 'kg', 'FREEZER', 20, 180], // not urgent
];

async function main() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const token = await signIn(timeZone);
  const today = todayInTz(timeZone);

  const { items } = await call<{ items: { id: string }[] }>('GET', '/foods', token);
  if (items.length > 0 && !reset) {
    console.log(`The demo account already has ${items.length} active items; nothing added. Use --reset to re-seed.`);
  } else {
    for (const { id } of items) await call('DELETE', `/foods/${id}`, token);
    for (const [name, quantity, unit, storage, daysAgo, lifespanDays] of SAMPLE) {
      const food: FoodInput = { name, quantity, unit, storage, addedDate: addDays(today, -daysAgo), lifespanDays };
      await call('POST', '/foods', token, food);
    }
    console.log(`Added ${SAMPLE.length} sample items.`);
  }

  console.log(`\nDemo login\n  email:    ${DEMO.email}\n  password: ${DEMO.password}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error('Is the server running? Start it with `npm run dev:server`.');
  process.exit(1);
});
