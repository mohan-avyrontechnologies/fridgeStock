import { expect, test, type Page } from '@playwright/test';
import { seed, SCREENS, settle, signUp } from './seed';

/**
 * Text size: people set a larger text size on their phone and expect everything to follow it. Setting the page's
 * root font size to 200 % is how a browser applies that, so every screen is opened that way and checked:
 * nothing scrolls sideways, nothing is cut off, and the tab bar still fits on the screen.
 */

const LARGE = '200%';

async function noOverflow(page: Page, label: string) {
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    const sideways = document.documentElement.scrollWidth - window.innerWidth;
    if (sideways > 0) found.push(`the page scrolls sideways by ${sideways}px`);
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || el.closest('.sr-only')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const clips = style.overflowX === 'hidden' || style.overflowX === 'clip';
      const ellipsis = style.textOverflow === 'ellipsis';
      // Text that is cut off: a clipping box whose content is wider than it.
      if ((clips || ellipsis) && el.scrollWidth > el.clientWidth + 1) {
        found.push(`<${el.tagName.toLowerCase()}> "${(el.textContent ?? '').trim().slice(0, 30)}" is cut off`);
      }
      // Something wider than the screen that isn't in a row made to scroll.
      if (
        rect.right > window.innerWidth + 1 &&
        !el.closest('[class*="overflow-x-auto"]') &&
        !el.closest('[role="dialog"]')
      ) {
        found.push(
          `<${el.tagName.toLowerCase()}> "${(el.textContent ?? '').trim().slice(0, 30)}" runs off the screen (right edge ${Math.round(rect.right)}, class: ${String(el.className).slice(0, 80)}, parent width ${Math.round(el.parentElement?.getBoundingClientRect().width ?? 0)})`,
        );
      }
    }
    return found.slice(0, 5);
  });
  expect(problems, label).toEqual([]);
}

test('at 200% text size nothing scrolls sideways or is cut off, on every main screen', async ({ page }) => {
  test.setTimeout(240_000);
  const token = await signUp(page);
  const { foodId } = await seed(page, token);
  await page.addStyleTag({ content: `html { font-size: ${LARGE} !important; }` });

  for (const screen of SCREENS(foodId)) {
    await page.goto(screen.path);
    await page.addStyleTag({ content: `html { font-size: ${LARGE} !important; }` });
    await settle(page);
    await noOverflow(page, screen.name);
  }
});

test('at 200% text size the tab bar still fits and every tab can be reached', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile', 'the tab bar is for phones');
  await signUp(page);
  await page.addStyleTag({ content: `html { font-size: ${LARGE} !important; }` });
  const bar = page.getByRole('navigation', { name: 'Main' }).last();
  for (const tab of ['Home', 'Cook First', 'Add food', 'Shopping', 'More']) {
    const item = bar.getByText(tab, { exact: false }).first();
    const box = (await item.boundingBox())!;
    expect(box.x, tab).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, tab).toBeLessThanOrEqual(375 + 1);
  }
});

test('at 200% text size the first-run guide and its buttons still fit', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Name').fill('Large Text');
  await page.getByLabel('Email').fill(`large-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.addStyleTag({ content: `html { font-size: ${LARGE} !important; }` });
  for (const step of [1, 2, 3]) {
    await expect(page.getByText(`Step ${step} of 3`)).toBeVisible();
    await noOverflow(page, `guide step ${step}`);
    if (step < 3) await page.getByRole('button', { name: /Next/ }).click();
  }
});
