import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The design tokens in src/index.css: the colours asked for in the design brief, and WCAG AA contrast for every
 * pair the interface uses, in light and in dark mode. (A real browser also checks the screens themselves, with
 * axe, in the end-to-end tests.)
 */

const css = readFileSync(path.resolve('src/index.css'), 'utf8');

/** The `--color-*` values declared in one block of the stylesheet. */
function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]),
  );
}

const light = tokens(css.slice(css.indexOf('@theme {'), css.indexOf('}', css.indexOf('@theme {'))));
const dark = tokens(
  css.slice(css.indexOf(":root[data-theme='dark'] {"), css.indexOf('}', css.indexOf(":root[data-theme='dark'] {"))),
);
const darkByDevice = tokens(
  css.slice(
    css.indexOf(":root:not([data-theme='light']) {"),
    css.indexOf('}', css.indexOf(":root:not([data-theme='light']) {")),
  ),
);

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
const linear = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) =>
  0.2126 * linear(channel(hex, 0)) + 0.7152 * linear(channel(hex, 1)) + 0.0722 * linear(channel(hex, 2));
function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

const URGENCIES = ['ok', 'soon', 'today', 'past'] as const;
const THEMES = { light, dark } as const;

describe('the colours asked for', () => {
  it('light: background, cards, text, muted text and primary buttons', () => {
    expect(light).toMatchObject({
      paper: '#f6f8f5',
      card: '#ffffff',
      ink: '#17332a',
      muted: '#5b6f66',
      brand: '#1e5f74',
    });
  });

  it('light urgency colours: not urgent, use soon, expected expiry today, past expected expiry', () => {
    expect(light).toMatchObject({
      'ok-bar': '#2f7d4f',
      'soon-bar': '#b7791f',
      'today-bar': '#d4570e',
      'past-bar': '#a1253b',
    });
  });

  it('dark: background, cards and text, with lightened urgency colours', () => {
    expect(dark).toMatchObject({ paper: '#0f1c1a', card: '#182826', ink: '#e8f0ec' });
    for (const key of URGENCIES) {
      expect(luminance(dark[`${key}-bar`]!), key).toBeGreaterThan(luminance(light[`${key}-bar`]!));
    }
  });

  it('the dark theme is the same whether it is chosen in Settings or follows the device', () => {
    expect(darkByDevice).toEqual(dark);
  });

  it('defines every token in both themes', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });
});

for (const [name, t] of Object.entries(THEMES)) {
  describe(`${name} theme: WCAG AA contrast`, () => {
    const surfaces = { paper: t.paper!, card: t.card! };

    it('text and muted text are readable on the page and on cards (4.5:1)', () => {
      for (const [surface, bg] of Object.entries(surfaces)) {
        expect(contrast(t.ink!, bg), `ink on ${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.muted!, bg), `muted on ${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.brand!, bg), `links on ${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.danger!, bg), `danger on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('primary buttons and the white-on-colour badges are readable (4.5:1)', () => {
      expect(contrast(t['on-brand']!, t.brand!), 'button').toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['on-brand']!, t['brand-hover']!), 'button hover').toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.brand!, t['brand-soft']!), 'link on its hover tint').toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['on-brand']!, t['past-bar']!), 'count badge').toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.paper!, t.ink!), 'toast').toBeGreaterThanOrEqual(4.5);
    });

    it('every urgency badge has dark text of its own hue on a light tint (4.5:1, aiming for 7:1)', () => {
      for (const key of URGENCIES) {
        const ratio = contrast(t[`${key}-ink`]!, t[key]!);
        expect(ratio, `${key} badge`).toBeGreaterThanOrEqual(7);
      }
      expect(contrast(t['calm-ink']!, t.calm!), 'closed items').toBeGreaterThanOrEqual(4.5);
    });

    it('urgency bars and icons stand out from the page and from cards (3:1)', () => {
      for (const key of URGENCIES) {
        for (const [surface, bg] of Object.entries(surfaces)) {
          expect(contrast(t[`${key}-bar`]!, bg), `${key} on ${surface}`).toBeGreaterThanOrEqual(3);
        }
      }
    });

    it('badge text also reads on the card the badge sits on, tinted or not', () => {
      for (const key of URGENCIES) expect(contrast(t[`${key}-ink`]!, t.card!), key).toBeGreaterThanOrEqual(4.5);
    });

    it('the outline of a field or switch can be seen (3:1)', () => {
      for (const [surface, bg] of Object.entries(surfaces)) {
        expect(contrast(t.field!, bg), `field on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    });
  });
}

describe('the other design tokens', () => {
  it('cards have 16 px corners, buttons 12 px', () => {
    expect(css).toMatch(/--radius-card:\s*1rem;/);
    expect(css).toMatch(/--radius-button:\s*0\.75rem;/);
  });

  it('headings and food names use Bricolage Grotesque, body text Figtree, each with system fallbacks', () => {
    expect(css).toMatch(/--font-display:\s*'Bricolage Grotesque'.*system-ui/);
    expect(css).toMatch(/--font-sans:\s*'Figtree'.*system-ui/);
  });

  it('the fonts are bundled with @fontsource (so they work offline in the apps): 600 and 700, and 400 to 600', () => {
    const main = readFileSync(path.resolve('src/main.tsx'), 'utf8');
    for (const weight of [600, 700]) expect(main).toContain(`@fontsource/bricolage-grotesque/latin-${weight}.css`);
    for (const weight of [400, 500, 600]) expect(main).toContain(`@fontsource/figtree/latin-${weight}.css`);
    expect(main).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(readFileSync(path.resolve('index.html'), 'utf8')).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });
});
