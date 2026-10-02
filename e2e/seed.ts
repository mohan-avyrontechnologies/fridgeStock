import { expect, type Page } from '@playwright/test';

/** Shared by the design-review screenshots and the accessibility checks: a signed-in user with realistic food. */

const API = 'http://localhost:4100/api';
let counter = 0;

/** Registers through the sign-up form (so the app is signed in), and returns the API token. */
export async function signUp(page: Page, name = 'Asha Rao'): Promise<string> {
  await page.goto('/register');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(`design-${Date.now()}-${++counter}@example.com`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('heading', { name: `Hi, ${name}` })).toBeVisible();
  return page.evaluate(() => JSON.parse(localStorage.getItem('cook-first-auth')!).state.token as string);
}

/** Today, in the browser's time zone, as YYYY-MM-DD (the zone the app sends when registering). */
const today = (page: Page) => page.evaluate(() => new Date().toLocaleDateString('en-CA'));

const daysAgo = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

/** Food in every state (past expected expiry, today, use soon, not urgent), a leftover, a plan, a list and some history. */
export async function seed(page: Page, token: string): Promise<{ foodId: string }> {
  const headers = { Authorization: `Bearer ${token}` };
  const now = await today(page);
  const post = async (path: string, data: object) => {
    const res = await page.request.post(`${API}${path}`, { headers, data });
    expect(res.ok(), `${path} ${res.status()}`).toBe(true);
    return res.json();
  };
  const food = (name: string, lifespanDays: number, extra: object = {}) =>
    post('/foods', { name, quantity: 1, unit: 'pcs', addedDate: now, lifespanDays, ...extra });

  const salmon = await post('/foods', {
    name: 'Salmon',
    quantity: 2,
    unit: 'pcs',
    addedDate: daysAgo(now, 3),
    lifespanDays: 2,
  });
  const chicken = await food('Chicken breast', 0, { quantity: 500, unit: 'g' });
  await food('Spinach', 1, { quantity: 1, unit: 'bunch' });
  await food('Greek yoghurt', 2, { quantity: 2, unit: 'pack' });
  await food('Leftover curry', 3, { leftover: true });
  await food('Milk', 5, { quantity: 1, unit: 'l' });
  await food('Carrots', 8, { quantity: 6 });
  await food('Eggs', 14, { quantity: 12 });
  await food('Mystery jar', 20, { quantity: 1, unit: 'pcs' });

  // Some history: one thing used, one wasted.
  const bread = await food('Bread', 4);
  await post(`/foods/${bread.id}/use`, {});
  const apples = await food('Apples', 7, { quantity: 4 });
  await post(`/foods/${apples.id}/waste`, {});

  await post('/shopping', { name: 'Olive oil' });
  await post('/shopping', { name: 'Chicken stock', quantity: 2, unit: 'pack' });
  await page.request.put(`${API}/meal-plan/${now}`, {
    headers,
    data: { meal: 'dinner', title: 'Chicken curry', foodIds: [chicken.id] },
  });
  void salmon;
  return { foodId: chicken.id };
}

/** The main screens, in the order they are reviewed. `path` may use the seeded food's id. */
export const SCREENS = (foodId: string) => [
  { name: 'home', path: '/' },
  { name: 'cook-first', path: '/cook-first' },
  { name: 'add-food', path: '/add' },
  { name: 'food-details', path: `/food/${foodId}` },
  { name: 'shopping', path: '/shopping' },
  { name: 'meal-plan', path: '/plan' },
  { name: 'reminders', path: '/notifications' },
  { name: 'history', path: '/history' },
  { name: 'insights', path: '/insights' },
  { name: 'household', path: '/household' },
  { name: 'settings', path: '/settings' },
];

/** Waits until a screen has loaded its data and its fonts, so a picture isn't taken half-drawn. */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}
