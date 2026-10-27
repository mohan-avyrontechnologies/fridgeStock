import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { seed, SCREENS, settle, signUp } from './seed';

/**
 * Accessibility checks with axe (WCAG 2.0 and 2.1, levels A and AA) on every main screen, in light and in dark
 * mode, at phone and desktop size: colour contrast, names and roles, labels, headings and landmarks.
 */

test('axe finds no accessibility violations on any main screen, in light or dark mode', async ({ page }) => {
  test.setTimeout(240_000);
  const token = await signUp(page);
  const { foodId } = await seed(page, token);
  const found: string[] = [];

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const screen of [{ name: 'home', path: '/' }, ...SCREENS(foodId).filter((s) => s.name !== 'home')]) {
      await page.goto(screen.path);
      await settle(page);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      for (const violation of result.violations) {
        found.push(
          `${scheme} ${screen.name}: ${violation.id} (${violation.impact}) ${violation.nodes
            .slice(0, 3)
            .map((node) => node.target.join(' '))
            .join(' | ')}`,
        );
      }
    }
  }
  expect(found).toEqual([]);
});

test('axe finds no violations on the sign-in and sign-up screens, in light or dark mode', async ({ page }) => {
  const found: string[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    for (const path of ['/login', '/register']) {
      await page.goto(path);
      await settle(page);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      for (const violation of result.violations)
        found.push(`${scheme} ${path}: ${violation.id} ${violation.nodes[0]?.target.join(' ')}`);
    }
  }
  expect(found).toEqual([]);
});

test('axe finds no violations on the three steps of the first-run guide, in light or dark mode', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Name').fill('Guide Tester');
  await page.getByLabel('Email').fill(`guide-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome to FridgeStock' })).toBeVisible();

  const found: string[] = [];
  const check = async (scheme: string, step: number) => {
    await settle(page);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    for (const violation of result.violations) {
      found.push(`${scheme} step ${step}: ${violation.id} ${violation.nodes[0]?.target.join(' ')}`);
    }
  };
  // Light: forwards through the steps. Dark: back again.
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await check('light', 1);
  await page.getByRole('button', { name: /Next/ }).click();
  await check('light', 2);
  await page.getByRole('button', { name: /Next/ }).click();
  await check('light', 3);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await check('dark', 3);
  await page.getByRole('button', { name: /Back/ }).click();
  await check('dark', 2);
  await page.getByRole('button', { name: /Back/ }).click();
  await check('dark', 1);
  expect(found).toEqual([]);
});

test('axe finds no violations with a dialog open: More, Add food and Mark as used, in light and dark mode', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const token = await signUp(page);
  await seed(page, token);
  const found: string[] = [];
  const scan = async (label: string) => {
    await page.waitForTimeout(350);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    for (const violation of result.violations) {
      found.push(`${label}: ${violation.id} ${violation.nodes[0]?.target.join(' ')}`);
    }
  };

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });

    await page.goto('/add');
    await settle(page);
    await expect(page.getByRole('dialog', { name: 'Add food' })).toBeVisible();
    await scan(`${scheme} Add food`);

    await page.goto('/');
    await settle(page);
    await page
      .getByRole('button', { name: /^Mark as used: / })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await scan(`${scheme} Mark as used`);
    await page.keyboard.press('Escape');

    const more = page.getByRole('button', { name: 'More' });
    if (await more.isVisible()) {
      await more.click();
      await expect(page.getByRole('dialog', { name: 'More' })).toBeVisible();
      await scan(`${scheme} More`);
      await page.keyboard.press('Escape');
    }
  }
  expect(found).toEqual([]);
});
