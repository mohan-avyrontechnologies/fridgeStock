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

// [name, quantity, unit, storage, days ago it was added, lifespan in days, price]
// Expected expiry = added + lifespan, so these land on every urgency level.
type Row = [string, number, FoodInput['unit'], StorageLocation, number, number, number];
const SAMPLE: Row[] = [
  ['Spinach', 1, 'bunch', 'FRIDGE', 7, 5, 2.5], // overdue (2 days)
  ['Chicken breast', 500, 'g', 'FRIDGE', 3, 2, 6.8], // overdue (1 day)
  ['Milk', 1, 'l', 'FRIDGE', 4, 4, 1.4], // due today
  ['Natural yoghurt', 2, 'pcs', 'FRIDGE', 5, 6, 3], // approaching (1 day)
  ['Mushrooms', 250, 'g', 'FRIDGE', 2, 5, 2.2], // approaching (3 days)
  ['Tomatoes', 6, 'pcs', 'FRIDGE', 1, 7, 3.6], // not urgent (6 days)
  ['Cheddar', 400, 'g', 'FRIDGE', 2, 21, 5.5], // not urgent
  ['Bread', 1, 'pack', 'PANTRY', 3, 7, 2.1], // not urgent
  ['Rice', 2, 'kg', 'PANTRY', 10, 365, 4.8], // not urgent
  ['Frozen peas', 1, 'kg', 'FREEZER', 20, 180, 3.2], // not urgent
];

// Food that is already finished, so Insights has something to show: used, wasted, or both.
const FINISHED: { row: Row; action: 'use' | 'waste' | 'partWaste' }[] = [
  { row: ['Eggs', 12, 'pcs', 'FRIDGE', 6, 21, 4.2], action: 'use' },
  { row: ['Pasta', 1, 'pack', 'PANTRY', 5, 300, 1.9], action: 'use' },
  { row: ['Lettuce', 1, 'pcs', 'FRIDGE', 8, 5, 1.8], action: 'waste' },
  { row: ['Spinach', 1, 'bunch', 'FRIDGE', 9, 5, 2.5], action: 'waste' },
  { row: ['Strawberries', 4, 'pcs', 'FRIDGE', 5, 4, 4], action: 'partWaste' },
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
    const add = (row: Row) => {
      const [name, quantity, unit, storage, daysAgo, lifespanDays, price] = row;
      const food: FoodInput = {
        name,
        quantity,
        unit,
        storage,
        addedDate: addDays(today, -daysAgo),
        lifespanDays,
        price,
      };
      return call<{ id: string; quantity: number }>('POST', '/foods', token, food);
    };
    for (const row of SAMPLE) await add(row);
    for (const { row, action } of FINISHED) {
      const { id, quantity } = await add(row);
      if (action === 'use') await call('POST', `/foods/${id}/use`, token, { quantity });
      else {
        if (action === 'partWaste') await call('POST', `/foods/${id}/use`, token, { quantity: quantity / 2 });
        await call('POST', `/foods/${id}/waste`, token, {});
      }
    }
    console.log(`Added ${SAMPLE.length} sample items and ${FINISHED.length} finished ones for Insights.`);
  }

  console.log(`\nDemo login\n  email:    ${DEMO.email}\n  password: ${DEMO.password}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error('Is the server running? Start it with `npm run dev:server`.');
  process.exit(1);
});
