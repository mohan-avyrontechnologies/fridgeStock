import { test } from '@playwright/test';
import { seed, SCREENS, settle, signUp } from './seed';

/**
 * Design review screenshots: every main screen at 375 px wide, in light and in dark mode, saved to
 * docs/design-review/stage-<N>/<light|dark>/. Not part of the normal test run: run it with
 *   npm run design:shots -- <stage number>
 */

const STAGE = process.env.DESIGN_STAGE ?? '0';
const OUT = `docs/design-review/stage-${STAGE}`;

test('design review: every main screen, light and dark', async ({ browser }) => {
  test.setTimeout(420_000);
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    // Signed-out screens first.
    for (const name of ['login', 'register']) {
      await page.goto(`/${name}`);
      await settle(page);
      await page.screenshot({ path: `${OUT}/${scheme}/00-${name}.png`, fullPage: true });
    }
  }

  // The first-run guide, step by step, with a throwaway account.
  await page.goto('/register');
  await page.getByLabel('Name').fill('Guide Tester');
  await page.getByLabel('Email').fill(`guide-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByText('Step 1 of 3').waitFor();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const step of [1, 2, 3]) {
      while (!(await page.getByText(`Step ${step} of 3`).isVisible())) {
        await page.getByRole('button', { name: /Next/ }).click();
      }
      await settle(page);
      await page.screenshot({ path: `${OUT}/${scheme}/00-welcome-step-${step}.png`, fullPage: true });
    }
    await page.getByRole('button', { name: /Back/ }).click();
    await page.getByRole('button', { name: /Back/ }).click();
  }
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('heading', { name: 'Hi, Guide Tester' }).waitFor();
  await page.evaluate(() => localStorage.clear());
  await page.goto('/login');
  const token = await signUp(page);
  const { foodId } = await seed(page, token);
  const screens = SCREENS(foodId);

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const [i, screen] of screens.entries()) {
      await page.goto(screen.path);
      await settle(page);
      await page.screenshot({
        path: `${OUT}/${scheme}/${String(i + 1).padStart(2, '0')}-${screen.name}.png`,
        fullPage: true,
        style: '[aria-live="polite"] { visibility: hidden !important; }',
      });
    }
    // The "Used" sheet, over the home screen.
    await page.goto('/');
    await settle(page);
    await page
      .getByRole('button', { name: /^Used: / })
      .first()
      .click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${scheme}/${String(screens.length + 1).padStart(2, '0')}-used-sheet.png` });
    await page.keyboard.press('Escape');
    // Half-way through a swipe to the right (used), then to the left (wasted): the actions underneath.
    const heading = page.getByRole('heading', { level: 3, name: 'Chicken breast' }).last();
    const box = (await heading.boundingBox())!;
    for (const [name, dx] of [
      ['swipe-used', 80],
      ['swipe-wasted', -80],
    ] as const) {
      await page.mouse.move(box.x + 40, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(box.x + 40 + dx / 2, box.y + 10, { steps: 3 });
      await page.mouse.move(box.x + 40 + dx, box.y + 10, { steps: 3 });
      await page.screenshot({
        path: `${OUT}/${scheme}/${String(screens.length + 2).padStart(2, '0')}-${name}.png`,
        clip: { x: 0, y: Math.max(0, box.y - 70), width: 375, height: 260 },
      });
      await page.mouse.up();
    }
  }
  await context.close();
});
