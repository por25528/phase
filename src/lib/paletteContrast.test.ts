import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, themeTokens, type Rgb } from './contrast';

/**
 * Every ratio in the palette was a COMMENT until this file existed.
 *
 * Comments do not fail builds. `--c-line-2` was once used as the unchecked
 * checkbox border at 1.38:1 — the app's primary action, invisible, with a
 * perfectly reasonable-looking token name in the class list. The numbers in
 * index.css are now claims this test either upholds or breaks.
 */
const CSS = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');

// Annotated rather than `as const`: `describe.each` types a readonly tuple of
// object literals poorly, and the widened form is all this needs.
const THEMES: { name: string; selector: string }[] = [
  { name: 'light', selector: ':root' },
  { name: 'dark', selector: '.dark' },
];

describe.each(THEMES)('$name palette', ({ selector }) => {
  const token = (name: string): Rgb => {
    const value = themeTokens(CSS, selector)[name];
    if (!value) throw new Error(`--${name} missing from ${selector}`);
    return value;
  };

  const against = (fg: string, bg: string) => contrastRatio(token(fg), token(bg));

  // Secondary copy carries most of the app's information, so it is TEXT and
  // takes the AA text floor on both surfaces it appears on.
  it('puts `muted` above 4.5:1 on the panel and the page', () => {
    expect(against('c-muted', 'c-panel')).toBeGreaterThanOrEqual(4.5);
    expect(against('c-muted', 'c-bg')).toBeGreaterThanOrEqual(4.5);
  });

  // `faint` is decorative marks, placeholders and disabled states — the 3:1
  // non-text floor, never the 4.5:1 one. Anything a user must READ is `muted`.
  it('puts `faint` above the 3:1 non-text floor', () => {
    expect(against('c-faint', 'c-panel')).toBeGreaterThanOrEqual(3);
    expect(against('c-faint', 'c-bg')).toBeGreaterThanOrEqual(3);
  });

  // WCAG 1.4.11. This is the unchecked checkbox — the app's primary action.
  it('keeps the checkbox border visible', () => {
    expect(against('c-check', 'c-panel')).toBeGreaterThanOrEqual(3);
    expect(against('c-check', 'c-bg')).toBeGreaterThanOrEqual(3);
  });

  it('puts `accent` above 4.5:1 on both surfaces', () => {
    expect(against('c-accent', 'c-panel')).toBeGreaterThanOrEqual(4.5);
    expect(against('c-accent', 'c-bg')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps `accent-contrast` legible on `accent`', () => {
    expect(against('c-accent-contrast', 'c-accent')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps `warn` legible on its tint and on the panel', () => {
    expect(against('c-warn', 'c-warn-tint')).toBeGreaterThanOrEqual(4.5);
    expect(against('c-warn', 'c-panel')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps `chip-ink` legible on `chip`', () => {
    expect(against('c-chip-ink', 'c-chip')).toBeGreaterThanOrEqual(4.5);
  });

  // `ink` is the reading colour. AAA, not AA.
  it('puts `ink` above 7:1 on the panel', () => {
    expect(against('c-ink', 'c-panel')).toBeGreaterThanOrEqual(7);
  });
});
