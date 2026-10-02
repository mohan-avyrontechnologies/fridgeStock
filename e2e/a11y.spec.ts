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
