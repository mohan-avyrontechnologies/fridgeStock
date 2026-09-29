import { expect, test, type Page } from '@playwright/test';

let counter = 0;
const uniqueEmail = () => `e2e-${Date.now()}-${++counter}@example.com`;
const PASSWORD = 'e2e-password-123';

async function register(page: Page, name = 'Asha Rao') {
  const email = uniqueEmail();
  await page.goto('/register');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: `Hi, ${name.split(' ')[0]}` })).toBeVisible();
  return email;
}

async function addFood(page: Page, name: string, lifespan: string, unit = 'pcs') {
  await page.getByRole('link', { name: 'Add food' }).click();
  await page.getByLabel('Food', { exact: true }).fill(name);
  await page.getByRole('button', { name: unit, exact: true }).click();
  await page.getByLabel('Lifespan (days)').fill(lifespan);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL('/');
}

const allFood = (page: Page) =>
  page.getByRole('heading', { name: /^All food/ }).locator('xpath=../..').getByRole('listitem');

/** Nothing the user sees may call food "safe" (BRD §10.3). */
async function expectNoSafetyClaim(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/\bsafe\b|guaranteed|good until|fresh until/i);
}

/** Phone layouts must never scroll sideways. */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Viewport-sized, after animations settle, as the user would see it. */
async function shot(page: Page, name: string) {
  await page.waitForTimeout(350);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}/${name}.png` });
}

test('register → add food → Cook First → mark used → history', async ({ page }) => {
  await register(page);
  await expect(page.getByText('Nothing logged yet')).toBeVisible();
  await shot(page, '01-empty-dashboard');

  await addFood(page, 'Eggs', '8');
  await addFood(page, 'Chicken', '1', 'g');
  await addFood(page, 'Yoghurt', '0');
  await addFood(page, 'Spinach', '2', 'bunch');

  // Dashboard: soonest expected expiry first, each with its label.
  const rows = allFood(page);
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Yoghurt');
  await expect(rows.nth(0)).toContainText('Expected expiry today');
  await expect(rows.nth(1)).toContainText('Chicken');
  await expect(rows.nth(1)).toContainText('Use soon');
  await expect(rows.nth(2)).toContainText('Spinach');
  await expect(rows.nth(3)).toContainText('Eggs');
  await expect(rows.nth(3)).toContainText('Not urgent');
  await expectNoSafetyClaim(page);
  await shot(page, '02-dashboard');

  // Cook First: everything except "Not urgent".
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Cook First/ }).click();
  await expect(page.getByRole('heading', { name: 'Cook First', level: 1 })).toBeVisible();
  const cookFirst = page.getByRole('main').getByRole('listitem');
  await expect(cookFirst).toHaveCount(3);
  await expect(page.getByRole('main')).not.toContainText('Eggs');
  await expectNoSafetyClaim(page);
  await shot(page, '03-cook-first');

  // One tap: used it all.
  await page.getByRole('button', { name: 'Update Chicken' }).click();
  await shot(page, '04-action-sheet');
  await page.getByRole('dialog').getByRole('button', { name: /Used it all/ }).click();
  await expect(page.getByText('Marked as used: Chicken')).toBeVisible();
  await expect(cookFirst).toHaveCount(2);
  await expect(page.getByRole('main')).not.toContainText('Chicken');

  // History records it.
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('main').getByRole('link', { name: /Chicken/ })).toContainText('Used');
  await shot(page, '05-history');
});

test('partial use keeps the item; partial waste then full waste closes it', async ({ page }) => {
  await register(page, 'Ben Okafor');
  await addFood(page, 'Milk', '4', 'l');
  await page.getByRole('link', { name: /Milk/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Milk' })).toBeVisible();
  await shot(page, '06-food-detail');

  // The quantity defaults to 1 l; use 0.25.
  await page.getByRole('button', { name: 'Used / wasted…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Used some/ }).click();
  await page.getByLabel(/How much did you use/).fill('0.25');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('0.75 l')).toBeVisible();

  // Throw away part of what's left, then the rest.
  await page.getByRole('button', { name: 'Used / wasted…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Threw it away/ }).click();
  await page.getByLabel(/How much did you throw away/).fill('0.25');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('0.5 l')).toBeVisible();

  await page.getByRole('button', { name: 'Used / wasted…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Threw it away/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('Nothing logged yet')).toBeVisible();

  await page.getByRole('link', { name: 'History' }).click();
  const history = page.getByRole('main').getByRole('listitem').filter({ hasText: 'Milk' });
  await expect(history).toHaveCount(3);
});

test('validation messages and the expected-expiry preview', async ({ page }) => {
  await register(page, 'Chen Wei');
  await page.getByRole('link', { name: 'Add food' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Food name is required.')).toBeVisible();
  await expect(page.getByText('Lifespan must be zero or a positive number of days.')).toBeVisible();

  await page.getByLabel('Food', { exact: true }).fill('Bread');
  await expect(page.getByText('Food name is required.')).toBeHidden();
  await page.getByRole('button', { name: '3 days' }).click();
  await expect(page.getByText('Lifespan must be zero or a positive number of days.')).toBeHidden();
  await expect(page.getByText('Expected expiry in 3 days')).toBeVisible();
  await expectNoSafetyClaim(page);
  await shot(page, '07-add-food');
});

test('reminders appear under the bell', async ({ page }) => {
  await register(page, 'Dana Ruiz');
  await addFood(page, 'Prawns', '1', 'g');
  await page.getByRole('link', { name: /Reminders/ }).click();
  await expect(page.getByText('Prawns: expected expiry in 1 day', { exact: false })).toBeVisible();
  await expectNoSafetyClaim(page);
  await shot(page, '08-reminders');
  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.getByRole('link', { name: 'Reminders', exact: true })).toBeVisible();
});

test("one user never sees another user's food", async ({ browser }) => {
  const a = await browser.newPage();
  await register(a, 'Ava First');
  await addFood(a, 'Secret salmon', '2', 'g');
  const foodUrl = await a.getByRole('link', { name: /Secret salmon/ }).first().getAttribute('href');

  const bCtx = await browser.newContext();
  const b = await bCtx.newPage();
  await register(b, 'Bo Second');
  await expect(b.getByText('Nothing logged yet')).toBeVisible();
  await b.goto(foodUrl!);
  await expect(b.getByText('This item doesn’t exist or isn’t yours.')).toBeVisible();
  await expect(b.locator('body')).not.toContainText('Secret salmon');
  await bCtx.close();
});

test('settings: reminder switches persist; sign out returns to login', async ({ page }) => {
  await register(page, 'Eli Stone');
  await page.getByRole('link', { name: 'Settings' }).click();
  const onTheDay = page.getByRole('switch', { name: /On the day/ });
  await expect(onTheDay).toBeChecked();
  await onTheDay.uncheck({ force: true });
  await expect(onTheDay).not.toBeChecked();
  await shot(page, '09-settings');
  await page.reload();
  await expect(page.getByRole('switch', { name: /On the day/ })).not.toBeChecked();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/login');
  await shot(page, '10-login');
});
