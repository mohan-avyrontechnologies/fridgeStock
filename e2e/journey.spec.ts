import { devices, expect, test, type Page } from '@playwright/test';

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

/** Settings: the header gear on phones, the sidebar on desktop. */
async function openSettings(page: Page) {
  await page
    .getByRole('link', { name: /^(Settings|Open settings)$/ })
    .first()
    .click();
  await expect(page).toHaveURL('/settings');
}

/** History is linked from Settings (and from the sidebar on desktop). */
async function openHistory(page: Page) {
  await openSettings(page);
  await page.getByRole('link', { name: 'History' }).first().click();
  await expect(page).toHaveURL('/history');
}

const allFood = (page: Page) =>
  page
    .getByRole('heading', { name: /^All food/ })
    .locator('xpath=../..')
    .getByRole('listitem');

/** Nothing the user sees may call food "safe" (BRD §10.3). */
async function expectNoSafetyClaim(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(
    /\bsafe\b|guaranteed|good until|fresh until|still good|safe until|safe to eat|safe to consume/i,
  );
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
        return (
          r.width > 0 &&
          r.height > 0 &&
          !el.classList.contains('sr-only') &&
          getComputedStyle(el).visibility !== 'hidden'
        );
      })
      .filter((el) => el.getBoundingClientRect().height < 44)
      .map(
        (el) =>
          `${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(el.getBoundingClientRect().height)}px`,
      ),
  );
  expect(small).toEqual([]);
}

/** Viewport-sized, after animations settle, as the user would see it. */
/** A 1 x 1 PNG: enough for the browser to decode; the stand-in AI doesn't look at it. */
const PNG = {
  name: 'photo.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
};

/** Chooses what the stand-in AI says about the next photo: milk, mouldy or unsure. */
async function nextPhoto(scenario: 'milk' | 'mouldy' | 'unsure') {
  const res = await fetch('http://localhost:4102/__photo', { method: 'POST', body: JSON.stringify({ scenario }) });
  expect(res.ok).toBe(true);
}

const REQUIRED_LINE = 'Expected expiry is an estimate to help you plan. Always check your food before eating it.';

async function shot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(350);
  await expectNoHorizontalScroll(page);
  await expectLargeTapTargets(page);
  // Hide passing toasts so they don't cover the screen being shown.
  await page.screenshot({
    path: `e2e/screenshots/${test.info().project.name}/${name}.png`,
    style: '[aria-live="polite"] { visibility: hidden !important; }',
  });
}

test('spec journey: chicken (1 day) and eggs (8 days); only chicken in Cook First; used chicken disappears', async ({
  page,
}) => {
  await register(page, 'Sam Patel');
  await addFood(page, 'Chicken', '1', 'g');
  await addFood(page, 'Eggs', '8');

  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: /Cook First/ }).click();
  const cookFirst = page.getByRole('main').getByRole('listitem');
  await expect(cookFirst).toHaveCount(1);
  await expect(cookFirst.first()).toContainText('Chicken');
  await expect(page.getByRole('main')).not.toContainText('Eggs');

  await page.getByRole('button', { name: 'Used: Chicken' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Used all/ })
    .click();
  await expect(page.getByText('Nothing needs attention right now.')).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText('Chicken');

  await nav.getByRole('link', { name: 'Home' }).click();
  const allFood = page.getByRole('region', { name: /All food/ });
  await expect(allFood.getByRole('listitem')).toHaveCount(1);
  await expect(allFood).toContainText('Eggs');
  await expect(page.getByRole('main')).not.toContainText('Chicken');
  await expect(page.getByText('Nothing urgent right now.')).toBeVisible();
});

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
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: /Cook First/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Cook First', level: 1 })).toBeVisible();
  const cookFirst = page.getByRole('main').getByRole('listitem');
  await expect(cookFirst).toHaveCount(3);
  await expect(page.getByRole('main')).not.toContainText('Eggs');
  await expect(page.getByText(REQUIRED_LINE)).toBeVisible();
  await expectNoSafetyClaim(page);
  await shot(page, '03-cook-first');

  // Used → Used all: acts at once, with Undo in the toast.
  await page.getByRole('button', { name: 'Used: Chicken' }).click();
  await expect(page.getByRole('dialog', { name: 'Chicken' })).toBeVisible();
  await shot(page, '04-action-sheet');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Used all/ })
    .click();
  await expect(page.getByText('Marked as used: Chicken')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(cookFirst).toHaveCount(2);
  await expect(page.getByRole('main')).not.toContainText('Chicken');

  // History records it.
  await openHistory(page);
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

  // Another partial use, then waste the rest.
  await page.getByRole('region', { name: 'Actions' }).getByRole('button', { name: 'Used some' }).click();
  await page.getByLabel(/How much did you use/).fill('0.25');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('0.5 l')).toBeVisible();

  await page.getByRole('region', { name: 'Actions' }).getByRole('button', { name: 'Wasted' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('Your fridge is empty. Add your first item.')).toBeVisible();

  await openHistory(page);
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
  await page
    .getByRole('link', { name: /Reminders/ })
    .first()
    .click();
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
  const foodUrl = await a
    .getByRole('link', { name: /Secret salmon/ })
    .first()
    .getAttribute('href');

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
  await openSettings(page);
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

test('phase 1: bulk add a shopping haul, undo a waste, and re-add a favourite with one tap', async ({ page }) => {
  await register(page, 'Kai Tanaka');

  // Bulk add: names from the reference list fill in unit and lifespan.
  await page.getByRole('link', { name: 'Add food', exact: true }).first().click();
  await page.getByRole('link', { name: /bulk add/ }).click();
  await page.getByLabel('Item 1 name').fill('Spinach');
  await expect(page.getByLabel('Item 1 lifespan in days')).toHaveValue('4');
  await page.getByLabel('Item 2 name').fill('Milk');
  await page.getByLabel('Item 3 name').fill('Peas');
  await page.getByLabel('Item 3 lifespan in days').fill('240');
  await page.getByLabel('Item 3 kept in').selectOption('FREEZER');
  await shot(page, '11-bulk-add');
  await page.getByRole('button', { name: 'Add 3 items' }).click();
  await expect(page.getByText('Added 3 items')).toBeVisible();
  const rows = allFood(page);
  await expect(rows).toHaveCount(3);

  // Wasted acts at once; Undo brings it back.
  await rows.filter({ hasText: 'Spinach' }).getByRole('button', { name: 'Wasted: Spinach' }).click();
  await expect(page.getByText('Marked as wasted: Spinach')).toBeVisible();
  await expect(rows).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Restored: Spinach')).toBeVisible();
  await expect(rows).toHaveCount(3);

  // Save Milk as a favourite, use it up, then re-add it with one tap.
  await rows.filter({ hasText: 'Milk' }).getByRole('link').first().click();
  await expect(page.getByText('Kept in')).toBeVisible();
  await page.getByRole('button', { name: /Save as favourite/ }).click();
  await expect(page.getByText('Saved Milk as a favourite')).toBeVisible();
  await page.getByRole('region', { name: 'Actions' }).getByRole('button', { name: 'Used all' }).click();
  await expect(page).toHaveURL('/');
  await expect(rows).toHaveCount(2);

  await page.getByRole('link', { name: 'Add food', exact: true }).first().click();
  await page.getByRole('button', { name: 'Add Milk again' }).click();
  await expect(page.getByText('Added Milk')).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }).click();
  await expect(rows).toHaveCount(3);
  await expectNoSafetyClaim(page);
});

test('phase 2: opening shortens the expected expiry, moving recalculates it, and your usual lifespan is suggested', async ({
  page,
}) => {
  await register(page, 'Noor Haddad');
  await addFood(page, 'Milk', '7', 'l');
  await addFood(page, 'Chicken', '2', 'g');
  const rows = allFood(page);

  // Opened: milk's 7-day lifespan drops to the typical 4 days once opened.
  await rows.filter({ hasText: 'Milk' }).getByRole('link').first().click();
  await expect(page.getByText('7 days', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Opened', exact: true }).click();
  const openDialog = page.getByRole('dialog', { name: 'Opened Milk' });
  await expect(openDialog.getByLabel('Days it lasts once opened')).toHaveValue('4');
  await shot(page, '12-opened');
  await openDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Marked Milk as opened/)).toBeVisible();
  await expect(page.getByText('4 days', { exact: true })).toBeVisible();
  await expect(page.getByText('Opened on')).toBeVisible();

  // Move: chicken goes into the freezer and gets the freezer lifespan from today.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }).click();
  await rows.filter({ hasText: 'Chicken' }).getByRole('link').first().click();
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  const moveDialog = page.getByRole('dialog', { name: 'Move Chicken' });
  await expect(moveDialog.getByLabel(/Days it lasts in the freezer/)).toHaveValue('270');
  await shot(page, '13-move');
  await moveDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Moved Chicken to the freezer/)).toBeVisible();
  await expect(page.getByText('270 days', { exact: true })).toBeVisible();

  // Learned: after two milks at 7 days, Add Food suggests 7 as your usual.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }).click();
  await addFood(page, 'Milk', '7', 'l');
  await page.getByRole('link', { name: 'Add food', exact: true }).first().click();
  await page.getByLabel('Food', { exact: true }).fill('Mil');
  await page
    .getByRole('group', { name: 'Suggestions' })
    .getByRole('button', { name: /your usual.*Milk/ })
    .click();
  await expect(page.getByLabel('Lifespan (days)')).toHaveValue('7');
  await expect(
    page.getByText('You usually set 7 days for this (from your last 2). Change it if you like.'),
  ).toBeVisible();
  await expectNoSafetyClaim(page);
  await expectNoHorizontalScroll(page);
  await expectLargeTapTargets(page);
});

test('phase 3: installable app; push reminders ask for permission only after "Turn on reminders"', async ({
  page,
  browser,
}) => {
  await register(page, 'Mira Holt');

  // Installable: a manifest with real icons, and the service worker is running.
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'Cook First', display: 'standalone', start_url: '/' });
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);
  const worker = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL ?? '');
  expect(worker).toContain('/sw.js?api=');

  await openSettings(page);
  const turnOn = page.getByRole('button', { name: 'Turn on reminders' });
  await expect(turnOn).toBeVisible();
  // Nothing has asked for permission yet.
  expect(await page.evaluate(() => Notification.permission)).toBe('default');

  // Daily summary or one per item, at a chosen hour; both are saved.
  await expect(page.getByRole('button', { name: /One daily summary/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /One per item/ }).click();
  await expect(page.getByRole('button', { name: /One per item/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Time').selectOption('18');
  await expect(page.getByText('Every reminder also appears under the bell')).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, '14-settings-full');
  await page.getByRole('region', { name: 'Push reminders' }).screenshot({
    path: `e2e/screenshots/${test.info().project.name}/14-push-settings.png`,
    style: '[aria-live="polite"], nav { visibility: hidden !important; }',
  });
  await page.reload();
  await expect(page.getByRole('button', { name: /One per item/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Time')).toHaveValue('18');

  // Tapping asks. The test browser doesn't grant it, and the page says what to do next.
  await page.getByRole('button', { name: 'Turn on reminders' }).click();
  await expect(page.getByText(/Reminders weren’t turned on|Notifications are blocked for this site/)).toBeVisible();
  await expectNoSafetyClaim(page);

  // On an iPhone in a browser tab, a hint explains the Home Screen step instead.
  const iphone = await browser.newContext({
    ...devices['iPhone 15'],
    defaultBrowserType: undefined,
    baseURL: test.info().project.use.baseURL,
  });
  const phone = await iphone.newPage();
  await register(phone, 'Ivo Park');
  await openSettings(phone);
  await expect(phone.getByText(/On iPhone, reminders need the app on your Home Screen first/)).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Turn on reminders' })).toHaveCount(0);
  await iphone.close();
});

test('phase 4: leftovers, a shopping list that warns about food at home, and a weekly meal plan', async ({ page }) => {
  await register(page, 'Sam Okafor');
  await addFood(page, 'Chicken', '2', 'g');

  // Leftovers get a short lifespan and a tag.
  await page.getByRole('link', { name: 'Add food', exact: true }).first().click();
  await page.getByLabel('Food', { exact: true }).fill('Leftover curry');
  await page.getByRole('checkbox', { name: /These are leftovers/ }).check();
  await expect(page.getByLabel('Lifespan (days)')).toHaveValue('3');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(allFood(page).filter({ hasText: 'Leftover curry' }).getByText('Leftovers')).toBeVisible();

  // AI is on in the tests (a local stand-in answers), so the AI buttons appear.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: /^Cook First/ })
    .click();
  await expect(page).toHaveURL('/cook-first');
  await expect(page.getByRole('heading', { name: 'Cook First', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Suggest recipes' })).toBeVisible();

  // Shopping list: a warning when it's already at home.
  await page.getByRole('link', { name: 'Shopping', exact: true }).first().click();
  await page.getByLabel('Item').fill('Chicken breasts');
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(page.getByText('Added Chicken breasts. You already have some at home.')).toBeVisible();
  await expect(page.getByRole('link', { name: /^Already at home: Chicken \(1 g\), expected expiry/ })).toBeVisible();
  await page.getByLabel('Item').fill('Flour');
  await page.getByRole('button', { name: 'Add to list' }).click();
  await page.getByRole('checkbox', { name: 'Bought Flour' }).check();
  await expect(page.getByRole('heading', { name: 'Bought' })).toBeVisible();
  await shot(page, '15-shopping');
  await page.getByRole('button', { name: 'Clear bought items' }).click();
  await expect(page.getByRole('checkbox', { name: 'Bought Flour' })).toHaveCount(0);

  // Meal plan: plan tomorrow's dinner with the chicken.
  await page
    .getByRole('link', { name: /^(Plan|Meal plan)$/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Suggest meals for empty days' })).toBeVisible();
  await page.getByRole('button', { name: 'Plan a meal' }).nth(1).click();
  await page.getByLabel('Meal').fill('Chicken curry');
  await page.getByRole('button', { name: 'Chicken', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Chicken curry')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Chicken curry')).toBeVisible();
  await shot(page, '16-plan');
  await expectNoSafetyClaim(page);
});

test('phase 5: a price on the item, then used and wasted figures and money on Insights', async ({ page }) => {
  await register(page, 'Priya Nair');

  // Nothing to show before anything is used or wasted.
  await openSettings(page);
  await page.getByRole('link', { name: 'Insights' }).first().click();
  await expect(page).toHaveURL('/insights');
  await expect(page.getByText('Nothing to show yet')).toBeVisible();

  // Milk with a price of 4.00 for 1 l.
  await page.getByRole('link', { name: 'Home', exact: true }).first().click();
  await page.getByRole('link', { name: 'Add food', exact: true }).first().click();
  await page.getByLabel('Food', { exact: true }).fill('Milk');
  await page.getByLabel('Unit').selectOption('l');
  await page.getByLabel('Lifespan (days)').fill('4');
  await page.getByLabel('Price (USD, optional)').fill('4');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL('/');

  // Use a quarter (worth 1.00), then waste the rest (worth 3.00).
  await page.getByRole('link', { name: /Milk/ }).first().click();
  await expect(page.getByText('$4.00')).toBeVisible();
  await page.getByRole('region', { name: 'Actions' }).getByRole('button', { name: 'Used some' }).click();
  await page.getByLabel(/How much did you use/).fill('0.25');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('0.75 l')).toBeVisible();
  await expect(page.getByText('$3.00')).toBeVisible();
  await page.getByRole('region', { name: 'Actions' }).getByRole('button', { name: 'Wasted' }).click();
  await expect(page).toHaveURL('/');

  await openSettings(page);
  await page.getByRole('link', { name: 'Insights' }).first().click();
  await expect(page).toHaveURL('/insights');
  const week = page.locator('section[aria-labelledby="this-week"]');
  await expect(week).toContainText('Used');
  await expect(week).toContainText('50% of the food you finished this week was wasted.');
  const money = page.locator('section[aria-labelledby="money"]');
  await expect(money.getByText('$1.00').first()).toBeVisible();
  await expect(money.getByText('$3.00').first()).toBeVisible();
  await expect(page.getByRole('img', { name: /used and wasted in each of the last 8 weeks/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Wasted most/ })).toBeVisible();
  await expectNoSafetyClaim(page);
  await shot(page, '17-insights');
});

test('phase 6: dark mode, downloading your data, and deleting the account', async ({ page }) => {
  const email = await register(page, 'Mira Das');
  await addFood(page, 'Milk', '4', 'l');
  await openSettings(page);

  // Dark mode: set on the page, remembered after a reload, and applied before the first paint.
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await background();
  await page.getByRole('group', { name: 'Appearance' }).getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await background()).not.toBe(light);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectNoSafetyClaim(page);
  await shot(page, '18-dark-settings');
  await page.getByRole('link', { name: 'Home', exact: true }).first().click();
  await expect(allFood(page)).toHaveCount(1);
  await shot(page, '19-dark-dashboard');
  await openSettings(page);
  await page.getByRole('group', { name: 'Appearance' }).getByRole('button', { name: 'System', exact: true }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);

  // Download my data: one JSON file with the food in it.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^cook-first-data-\d{4}-\d{2}-\d{2}\.json$/);
  const saved = JSON.parse(await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8'));
  expect(saved.account.email).toBe(email);
  expect(saved.foods.map((f: { name: string }) => f.name)).toEqual(['Milk']);
  expect(JSON.stringify(saved)).not.toMatch(/passwordHash/);

  // Delete: a wrong password is refused; the right one signs out and the account is gone.
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByLabel('Enter your password to confirm').fill('not my password');
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.getByText('Password is incorrect.')).toBeVisible();
  await page.getByLabel('Enter your password to confirm').fill(PASSWORD);
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /Log in|Sign in/ }).click();
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
});

test('phase 6: two people share a household, see each other’s food and activity, and one leaves', async ({
  browser,
}) => {
  const alicePage = await (await browser.newContext()).newPage();
  const bobPage = await (await browser.newContext()).newPage();
  const openHousehold = async (page: Page) => {
    await openSettings(page);
    await page.getByRole('link', { name: 'Household' }).first().click();
    await expect(page).toHaveURL('/household');
  };

  await register(alicePage, 'Alice Roy');
  await addFood(alicePage, 'Milk', '4', 'l');
  await register(bobPage, 'Bob Roy');
  await addFood(bobPage, 'Bread', '3', 'pack');

  // Alice makes an invite code; she is alone so far.
  await openHousehold(alicePage);
  await expect(alicePage.getByText(/It’s just you/)).toBeVisible();
  await alicePage.getByRole('button', { name: 'Make an invite code' }).click();
  const code = (await alicePage
    .getByRole('status')
    .getByText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    .textContent())!;

  // Bob joins with it (typed in lower case), and brings his bread.
  await openHousehold(bobPage);
  await bobPage.getByLabel('Invite code').fill(code.toLowerCase());
  await bobPage.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(bobPage.getByText('Alice Roy', { exact: true })).toBeVisible();
  await expect(bobPage.getByText('Bob Roy joined the household')).toBeVisible();
  await bobPage.getByRole('link', { name: 'Home', exact: true }).first().click();
  await expect(allFood(bobPage)).toHaveCount(2);
  await expect(allFood(bobPage).filter({ hasText: 'Milk' })).toHaveCount(1);

  // Alice sees Bob's bread, and uses it.
  await alicePage.goto('/');
  await expect(allFood(alicePage)).toHaveCount(2);
  await alicePage.getByRole('link', { name: /Bread/ }).first().click();
  await alicePage.getByRole('region', { name: 'Actions' }).getByRole('button', { name: 'Used all' }).click();
  await expect(alicePage).toHaveURL('/');
  await expect(allFood(alicePage)).toHaveCount(1);

  // The log says who did what, for both of them.
  for (const page of [alicePage, bobPage]) {
    await page.goto('/household');
    await expect(page.getByText('Alice Roy added Milk')).toBeVisible();
    await expect(page.getByText('Bob Roy added Bread')).toBeVisible();
    await expect(page.getByText('Alice Roy used Bread')).toBeVisible();
    await expect(page.getByText('Bob Roy joined the household')).toBeVisible();
    await expectNoSafetyClaim(page);
  }
  await shot(alicePage, '20-household');

  // Bob leaves: Alice keeps the milk, and each is on their own again.
  await bobPage.getByRole('button', { name: 'Leave household' }).click();
  await bobPage.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(bobPage.getByText(/It’s just you/)).toBeVisible();
  await bobPage.getByRole('link', { name: 'Home', exact: true }).first().click();
  await expect(bobPage.getByText('Your fridge is empty. Add your first item.')).toBeVisible();
  await alicePage.goto('/household');
  await expect(alicePage.getByText('Bob Roy left the household')).toBeVisible();
  await expect(alicePage.getByText(/It’s just you/)).toBeVisible();
  await alicePage.getByRole('link', { name: 'Home', exact: true }).first().click();
  await expect(allFood(alicePage).filter({ hasText: 'Milk' })).toHaveCount(1);
});

test('phase 6: scanning a barcode fills in the form, and a receipt photo becomes rows to check', async ({ page }) => {
  await register(page, 'Kiran Rao');
  await page.getByRole('link', { name: 'Add food', exact: true }).first().click();

  // The camera isn't used in tests: the number under the barcode is typed instead.
  await page.getByRole('button', { name: 'Scan a barcode' }).click();
  const panel = page.getByRole('region', { name: 'Scan a barcode' });
  await panel.getByLabel('Or type the number under the barcode').fill('4006381333932');
  await panel.getByRole('button', { name: 'Look up' }).click();
  await expect(panel.getByText('Enter the 8 to 14 digits printed under the barcode.')).toBeVisible();

  // A valid number that is not in the product list.
  await panel.getByLabel('Or type the number under the barcode').fill('96385074');
  await panel.getByRole('button', { name: 'Look up' }).click();
  await expect(panel.getByText('That barcode isn’t in the product list. Type the name instead.')).toBeVisible();
  await expect(page.getByLabel('Food', { exact: true })).toHaveValue('');
  await shot(page, '21-barcode');

  // A product it knows fills in the form (spaces and dashes are fine).
  await panel.getByLabel('Or type the number under the barcode').fill('4006 3813-33931');
  await panel.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByLabel('Food', { exact: true })).toHaveValue('Whole milk');
  await expect(page.getByLabel('Quantity')).toHaveValue('1000');
  await expect(page.getByLabel('Unit')).toHaveValue('ml');
  await expect(page.getByLabel(/Notes/)).toHaveValue('Acme Dairy');
  await expect(page.getByRole('region', { name: 'Scan a barcode' })).toHaveCount(0);

  // How long it lasts is still the person's choice.
  await page.getByLabel('Lifespan (days)').fill('5');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(allFood(page).filter({ hasText: 'Whole milk' })).toHaveCount(1);
  await expectNoSafetyClaim(page);

  // A receipt photo is read by the (stand-in) AI into rows to check; nothing is saved until Add.
  await page.goto('/add/bulk');
  await expect(page.getByLabel('Item 1 name')).toBeVisible();
  await page.getByLabel('Receipt photo').setInputFiles(PNG);
  await expect(page.getByLabel('Item 1 name')).toHaveValue('Milk');
  await expect(page.getByLabel('Item 1 quantity')).toHaveValue('2');
  await expect(page.getByLabel('Item 1 unit')).toHaveValue('l');
  await expect(page.getByLabel('Item 1 price')).toHaveValue('2.4');
  await expect(page.getByLabel('Item 1 lifespan in days')).toHaveValue('5');
  await expect(page.getByLabel('Item 2 name')).toHaveValue('Potatoes');
  await expect(page.getByLabel('Item 2 kept in')).toHaveValue('PANTRY');
  await expect(page.getByText(/Read from a photo, so check each line/)).toBeVisible();
  await shot(page, '22-receipt');
  await page.getByRole('button', { name: 'Add 2 items' }).click();
  await expect(page).toHaveURL('/');
  await expect(allFood(page).filter({ hasText: 'Potatoes' })).toHaveCount(1);
});

test('phase 7: Photo Check names food on Add Food, and warns on Food Details without changing anything by itself', async ({
  page,
}) => {
  await register(page, 'Tara Nair');
  await addFood(page, 'Bread', '5', 'pack');

  // Add Food: a confident photo pre-fills the name and the usual lifespan; the name stays editable.
  await nextPhoto('milk');
  await page.getByRole('link', { name: 'Add food', exact: true }).first().click();
  await page.getByLabel('Food photo').setInputFiles(PNG);
  await expect(page.getByLabel('Food', { exact: true })).toHaveValue('Milk');
  await expect(page.getByLabel('Lifespan (days)')).toHaveValue('5');
  await page.getByLabel('Food', { exact: true }).fill('Oat milk');
  await expect(page.getByLabel('Food', { exact: true })).toHaveValue('Oat milk');
  // No warning signs: nothing is said about condition.
  await expect(page.getByText(/Visible signs noticed/)).toHaveCount(0);

  // Not sure enough: it asks for the name instead of guessing.
  await nextPhoto('unsure');
  await page.reload();
  await page.getByLabel('Food photo').setInputFiles(PNG);
  await expect(page.getByText('I couldn’t tell what this is from the photo. Type the name instead.')).toBeVisible();
  await expect(page.getByLabel('Food', { exact: true })).toHaveValue('');

  // Add Food with a warning: shown, but only Dismiss (there is no item to waste yet).
  await nextPhoto('mouldy');
  await page.reload();
  await page.getByLabel('Food photo').setInputFiles(PNG);
  const addWarning = page.getByRole('group', { name: 'Visible signs noticed' });
  await expect(addWarning).toContainText(
    'Visible signs noticed: green patches on the crust; dark spots near the edge.',
  );
  await expect(addWarning.getByRole('button')).toHaveText(['Dismiss']);
  await expect(page.getByLabel('Food', { exact: true })).toHaveValue('Bread');

  // Food Details: no signs, so nothing about condition; just a neutral "Photo checked".
  await page.goto('/');
  await page.getByRole('link', { name: /Bread/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Bread' })).toBeVisible();
  await nextPhoto('milk');
  await page.getByLabel('Food photo').setInputFiles(PNG);
  await expect(page.getByText('Photo checked')).toBeVisible();
  await expect(page.getByText(/Visible signs noticed/)).toHaveCount(0);

  // With warning signs: the sentence and all three options (the item is not due yet).
  await nextPhoto('mouldy');
  await page.getByLabel('Food photo').setInputFiles(PNG);
  const warning = page.getByRole('group', { name: 'Visible signs noticed' });
  await expect(warning).toContainText(
    'Visible signs noticed: green patches on the crust; dark spots near the edge. A photo can’t show everything, so check the item yourself before using it.',
  );
  await expect(warning.getByRole('button')).toHaveText(['Mark as wasted', 'Use today', 'Dismiss']);
  await expectNoSafetyClaim(page);
  await expectNoHorizontalScroll(page);
  await expectLargeTapTargets(page);
  await page.getByRole('region', { name: 'Photo Check' }).screenshot({
    path: `e2e/screenshots/${test.info().project.name}/23-photo-check.png`,
  });

  // Nothing has changed yet, and "Use today" asks first.
  await expect(page.getByText('Not urgent')).toBeVisible();
  await warning.getByRole('button', { name: 'Use today' }).click();
  await expect(warning.getByText('Make Bread due today? Its expected expiry will change to today.')).toBeVisible();
  await warning.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Not urgent')).toBeVisible();
  await warning.getByRole('button', { name: 'Use today' }).click();
  await warning.getByRole('button', { name: 'Yes, use today' }).click();
  await expect(page.getByText('Bread is now due today')).toBeVisible();
  await expect(page.getByText('Not urgent')).toHaveCount(0);
  await expect(page.getByText('Expected expiry today').first()).toBeVisible();
  // It is due today, so a new warning offers only Mark as wasted and Dismiss.
  await page.getByLabel('Food photo').setInputFiles(PNG);
  await expect(page.getByRole('group', { name: 'Visible signs noticed' }).getByRole('button')).toHaveText([
    'Mark as wasted',
    'Dismiss',
  ]);

  // The checks are in the household's activity log.
  await page.goto('/household');
  await expect(page.getByText('Tara Nair checked Bread with a photo').first()).toBeVisible();
});
