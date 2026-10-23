import { devices, test, type BrowserContextOptions, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { seed, SCREENS, settle, signUp } from './seed';

/**
 * Mobile UI audit: every main screen on phone and tablet profiles, in light and dark, portrait and landscape, and
 * at 200 % text size. It records problems instead of failing, and saves screenshots plus a report to
 * e2e/mobile-audit/. Not part of the normal run: `MOBILE_AUDIT=1 npx playwright test --project=audit` (or the
 * "Mobile UI audit" workflow on GitHub). The profiles run in Chromium, keeping each device's size, pixel density, touch and user agent.
 */

const OUT = 'e2e/mobile-audit';

// It takes several minutes per device, so it runs only when asked for.
test.skip(!process.env.MOBILE_AUDIT, 'set MOBILE_AUDIT=1 to run the mobile audit');

const profile = (name: string): BrowserContextOptions => {
  const { defaultBrowserType: _engine, ...rest } = devices[name]!;
  return rest;
};
const android = (width: number, height: number): BrowserContextOptions => ({
  viewport: { width, height },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: devices['Pixel 7']!.userAgent,
});

const DEVICES = [
  { key: 'pixel-7', portrait: profile('Pixel 7'), landscape: profile('Pixel 7 landscape'), notch: false },
  { key: 'iphone-15', portrait: profile('iPhone 15'), landscape: profile('iPhone 15 landscape'), notch: true },
  { key: 'android-360x640', portrait: android(360, 640), landscape: android(640, 360), notch: false },
  {
    key: 'iphone-se',
    portrait: profile('iPhone SE (3rd gen)'),
    landscape: profile('iPhone SE (3rd gen) landscape'),
    notch: false,
  },
  { key: 'tablet', portrait: profile('Galaxy Tab S4'), landscape: profile('Galaxy Tab S4 landscape'), notch: false },
];

const VARIANTS = [
  { key: 'light-portrait', scheme: 'light', landscape: false, large: false },
  { key: 'dark-portrait', scheme: 'dark', landscape: false, large: false },
  { key: 'light-landscape', scheme: 'light', landscape: true, large: false },
  { key: 'dark-landscape', scheme: 'dark', landscape: true, large: false },
  { key: 'text200-portrait', scheme: 'light', landscape: false, large: true },
] as const;

type Finding = { kind: string; detail: string };

/** Everything checked on one screen. Runs in the page. */
function inspect({ landscape, notch }: { landscape: boolean; notch: boolean }): Finding[] {
  const out: Finding[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const sideways = document.documentElement.scrollWidth - vw;
  if (sideways > 0) out.push({ kind: 'sideways-scroll', detail: `the page is ${sideways}px wider than the screen` });
  const name = (el: Element) =>
    `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`;
  const shown = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('.sr-only');
  };
  // With a dialog open, only what's in it can be tapped.
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  const targets = (dialog ?? document).querySelectorAll<HTMLElement>(
    'a[href], button, input:not([type=hidden]), select, textarea, [role="button"], [role="switch"], [role="tab"]',
  );
  for (const el of targets) {
    if (!shown(el)) continue;
    const input = el as HTMLInputElement;
    // A checkbox or radio is tapped through its label.
    const box = (
      input.type === 'checkbox' || input.type === 'radio' ? (el.closest('label') ?? el) : el
    ).getBoundingClientRect();
    if (box.height < 47.5) out.push({ kind: 'tap-height', detail: `${name(el)} is ${Math.round(box.height)}px tall` });
    if (box.width < 47.5) out.push({ kind: 'tap-width', detail: `${name(el)} is ${Math.round(box.width)}px wide` });
    if (
      el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), select, textarea')
    ) {
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) out.push({ kind: 'input-font', detail: `${name(el)} uses ${size}px text` });
    }
  }
  if (dialog) {
    const r = dialog.getBoundingClientRect();
    if (r.top < -1 || r.bottom > vh + 1) {
      out.push({
        kind: 'sheet-fit',
        detail: `the dialog spans ${Math.round(r.top)}-${Math.round(r.bottom)}px of ${vh}px`,
      });
    }
    const scrolls = ['auto', 'scroll'].includes(getComputedStyle(dialog).overflowY);
    if (dialog.scrollHeight > dialog.clientHeight + 1 && !scrolls) {
      out.push({ kind: 'sheet-scroll', detail: 'the dialog is taller than its box but does not scroll' });
    }
    out.push({ kind: 'note', detail: `dialog bottom padding ${getComputedStyle(dialog).paddingBottom}` });
  }
  const nav = [...document.querySelectorAll<HTMLElement>('nav')].find(
    (n) => getComputedStyle(n).position === 'fixed' && shown(n),
  );
  if (nav) {
    out.push({ kind: 'note', detail: `tab bar padding-bottom ${getComputedStyle(nav).paddingBottom}` });
    if (notch && parseFloat(getComputedStyle(nav).paddingBottom) < 20) {
      out.push({ kind: 'safe-area', detail: 'the tab bar has no room for the home indicator' });
    }
  }
  if (notch && landscape) {
    for (const [what, root] of [
      ['tab bar', nav],
      ['header', document.querySelector('header')],
      ['content', document.querySelector('main')],
    ] as const) {
      if (!root) continue;
      const items = [...root.querySelectorAll<HTMLElement>('a, button, h1, h2, h3, p, input, select')].filter(shown);
      if (!items.length) continue;
      const left = Math.min(...items.map((i) => i.getBoundingClientRect().left));
      const right = Math.max(...items.map((i) => i.getBoundingClientRect().right));
      if (left < 44 || right > vw - 44) {
        out.push({
          kind: 'safe-area',
          detail: `${what} runs from ${Math.round(left)} to ${Math.round(right)}px of ${vw}px, under the notch`,
        });
      }
    }
  }
  return out;
}

/** A notched iPhone's safe areas, through Chrome DevTools (when this Chromium supports it). */
async function emulateNotch(page: Page, landscape: boolean): Promise<boolean> {
  try {
    const cdp = await page.context().newCDPSession(page);
    const insets = landscape ? { top: 0, bottom: 21, left: 59, right: 59 } : { top: 59, bottom: 34, left: 0, right: 0 };
    await cdp.send('Emulation.setSafeAreaInsetsOverride' as 'Emulation.setDeviceMetricsOverride', { insets } as never);
    return true;
  } catch {
    return false;
  }
}

for (const device of DEVICES) {
  test(`mobile audit: ${device.key}`, async ({ browser }) => {
    test.setTimeout(30 * 60_000);
    const findings: (Finding & { variant: string; screen: string })[] = [];
    let notchEmulated = false;

    // One account with realistic food, shared by every variant.
    const setup = await browser.newContext(device.portrait);
    const first = await setup.newPage();
    const token = await signUp(first);
    const { foodId } = await seed(first, token);
    const auth = await first.evaluate(() => localStorage.getItem('cook-first-auth'));
    await setup.close();

    for (const v of VARIANTS) {
      const options = v.landscape ? device.landscape : device.portrait;
      const dir = `${OUT}/${device.key}/${v.key}`;
      mkdirSync(dir, { recursive: true });
      const context = await browser.newContext({
        ...options,
        deviceScaleFactor: Math.min(options.deviceScaleFactor ?? 1, 2),
        colorScheme: v.scheme,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      if (device.notch) notchEmulated = (await emulateNotch(page, v.landscape)) || notchEmulated;
      const open = async (path: string) => {
        await page.goto(path);
        if (v.large) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        await settle(page);
      };
      const record = async (screen: string) => {
        for (const f of await page.evaluate(inspect, { landscape: v.landscape, notch: device.notch })) {
          findings.push({ ...f, variant: v.key, screen });
        }
        await page.screenshot({
          path: `${dir}/${screen}.png`,
          fullPage: true,
          style: '[data-toast] { visibility: hidden !important; }',
        });
      };

      for (const screen of ['login', 'register']) {
        await open(`/${screen}`);
        await record(`00-${screen}`);
      }
      await page.evaluate((a) => localStorage.setItem('cook-first-auth', a!), auth);
      for (const [i, s] of SCREENS(foodId).entries()) {
        await open(s.path);
        await record(`${String(i + 1).padStart(2, '0')}-${s.name}`);
      }
      // A bottom sheet over the home screen.
      await open('/');
      await page
        .getByRole('button', { name: /^Mark as used: / })
        .first()
        .click();
      await page.waitForTimeout(400);
      await record('20-used-sheet');
      await context.close();
    }
    writeFileSync(
      `${OUT}/${device.key}.json`,
      JSON.stringify({ device: device.key, notchEmulated, findings }, null, 1),
    );
  });
}
