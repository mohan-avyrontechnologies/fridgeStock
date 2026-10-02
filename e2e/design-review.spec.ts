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
  test.setTimeout(240_000);
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
  }
  await context.close();
});
