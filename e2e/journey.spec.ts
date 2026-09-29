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
  await expect(page.getByRole('heading', { name: `Hi, ${name}` })).toBeVisible();
  return email;
}

async function addFood(page: Page, name: string, lifespan: string, unit = 'pcs') {
  await page.getByRole('link', { name: 'Add food', exact: true }).first().click();
  await page.getByLabel('Food', { exact: true }).fill(name);
  await page.getByLabel('Unit').selectOption(unit);
  await page.getByLabel('Lifespan (days)').fill(lifespan);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL('/');
}

const allFood = (page: Page) =>
  page.getByRole('heading', { name: /^All food/ }).locator('xpath=../..').getByRole('listitem');

/** Nothing the user sees may call food "safe" (BRD §10.3). */
async function expectNoSafetyClaim(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/\bsafe\b|guaranteed|good until|fresh until|still good|safe until|safe to eat|safe to consume/i);
}

/** Phone layouts must never scroll sideways. */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Every visible button, link and field must be at least 44 px tall (large tap targets). */
async function expectLargeTapTargets(page: Page) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('a[href], button, input:not([type=hidden]), select, textarea')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.classList.contains('sr-only') && getComputedStyle(el).visibility !== 'hidden';
      })
      .filter((el) => el.getBoundingClientRect().height < 44)
      .map((el) => `${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`),
  );
  expect(small).toEqual([]);
}

/** Viewport-sized, after animations settle, as the user would see it. */
const REQUIRED_LINE = 'Expected expiry is an estimate to help you plan. Always check your food before eating it.';

async function shot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(350);
  await expectNoHorizontalScroll(page);
  await expectLargeTapTargets(page);
  await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}/${name}.png` });
}

test('register → add food → Cook First → mark used → history', async ({ page }) => {
  await register(page);
  await expect(page.getByText('Your fridge is empty. Add your first item.')).toBeVisible();
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
  await expect(page.getByText(REQUIRED_LINE)).toBeVisible();
  await expectNoSafetyClaim(page);
  await shot(page, '03-cook-first');

  // One tap: used it all.
  await page.getByRole('button', { name: 'Used: Chicken' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Used all/ }).click();
  await expect(page.getByRole('dialog', { name: 'Mark Chicken as used?' })).toBeVisible();
  await shot(page, '04-action-sheet');
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, used all' }).click();
  await expect(page.getByText('Marked as used: Chicken')).toBeVisible();
  await expect(cookFirst).toHaveCount(2);
  await expect(page.getByRole('main')).not.toContainText('Chicken');

  // History records it.
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('main').getByRole('link', { name: /Chicken/ })).toContainText('Used');
  await shot(page, '05-history');
});

test('partial use keeps the item; throwing it away closes the rest', async ({ page }) => {
  await register(page, 'Ben Okafor');
  await addFood(page, 'Milk', '4', 'l');
  await page.getByRole('link', { name: /Milk/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Milk' })).toBeVisible();
  await shot(page, '06-food-detail');

  // The quantity defaults to 1 l; use 0.25.
  await page.getByRole('region', { name: 'Actions' }).getByRole('button', { name: 'Used some' }).click();
  await page.getByLabel(/How much did you use/).fill('0.25');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('0.75 l')).toBeVisible();

  // Another partial use, then waste the rest (with one confirmation).
  await page.getByRole('region', { name: 'Actions' }).getByRole('button', { name: 'Used some' }).click();
  await page.getByLabel(/How much did you use/).fill('0.25');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('0.5 l')).toBeVisible();

  await page.getByRole('region', { name: 'Actions' }).getByRole('button', { name: 'Wasted' }).click();
  await page.getByRole('dialog', { name: 'Mark Milk as wasted?' }).getByRole('button', { name: 'Yes, wasted' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('Your fridge is empty. Add your first item.')).toBeVisible();

  await page.getByRole('link', { name: 'History' }).click();
  const history = page.getByRole('main').getByRole('listitem').filter({ hasText: 'Milk' });
  await expect(history).toHaveCount(3);
  await expect(history.first()).toContainText('Wasted');
  await expect(history.first()).toContainText('0.5 l');
});

test('validation messages and the expected-expiry preview', async ({ page }) => {
  await register(page, 'Chen Wei');
  await page.getByRole('link', { name: 'Add food', exact: true }).first().click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Food name is required.')).toBeVisible();
  await expect(page.getByText('Lifespan must be a whole number of days from 0 to 365.')).toBeVisible();

  await page.getByLabel('Food', { exact: true }).fill('Bread');
  await expect(page.getByText('Food name is required.')).toBeHidden();
  await page.getByLabel('Added on').fill('2099-01-01');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText("Added date must be a valid date that isn't in the future.")).toBeVisible();
  await page.getByRole('button', { name: 'Today' }).click();
  await page.getByRole('button', { name: '3 days' }).click();
  await expect(page.getByText('Lifespan must be a whole number of days from 0 to 365.')).toBeHidden();
  await expect(page.getByText('3 days left')).toBeVisible();
  await expect(page.getByText(REQUIRED_LINE)).toBeVisible();
  await expectNoSafetyClaim(page);
  await shot(page, '07-add-food');
});

test('reminders appear under the bell', async ({ page }) => {
  await register(page, 'Dana Ruiz');
  await addFood(page, 'Prawns', '1', 'g');
  await page.getByRole('link', { name: /Reminders/ }).first().click();
  await expect(page.getByText('Prawns: expected expiry in 1 day', { exact: false })).toBeVisible();
  await expectNoSafetyClaim(page);
  await shot(page, '08-reminders');
  // Opening the screen marks them read: the unread badge disappears.
  await expect(page.getByText('New', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Home' }).first().click();
  await expect(page.getByRole('link', { name: /Reminders, \d+ unread/ })).toHaveCount(0);
});

test("one user never sees another user's food", async ({ browser }) => {
  const a = await browser.newPage();
  await register(a, 'Ava First');
  await addFood(a, 'Secret salmon', '2', 'g');
  const foodUrl = await a.getByRole('link', { name: /Secret salmon/ }).first().getAttribute('href');

  const bCtx = await browser.newContext();
  const b = await bCtx.newPage();
  await register(b, 'Bo Second');
  await expect(b.getByText('Your fridge is empty. Add your first item.')).toBeVisible();
  await b.goto(foodUrl!);
  await expect(b.getByText('This item doesn’t exist or isn’t yours.')).toBeVisible();
  await expect(b.locator('body')).not.toContainText('Secret salmon');
  await bCtx.close();
});

test('settings: reminder switches persist; sign out returns to login', async ({ page }) => {
  await register(page, 'Eli Stone');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const onTheDay = page.getByRole('switch', { name: /On the day/ });
  await expect(onTheDay).toBeChecked();
  await onTheDay.uncheck({ force: true });
  await expect(onTheDay).not.toBeChecked();
  await shot(page, '09-settings');
  await page.reload();
  await expect(page.getByRole('switch', { name: /On the day/ })).not.toBeChecked();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL('/login');
  await shot(page, '10-login');
});
