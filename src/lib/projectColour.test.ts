import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { contrastRatio, themeTokens, type Rgb } from './contrast';
import { projectColourIndex, projectBlockClass, PROJECT_COLOURS } from './projectColour';

describe('assigning a project its colour', () => {
  it('is deterministic', () => {
    expect(projectColourIndex('abc1234')).toBe(projectColourIndex('abc1234'));
  });

  it('always lands inside the palette', () => {
    for (let i = 0; i < 500; i += 1) {
      const index = projectColourIndex(`goal-${i}`);
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(PROJECT_COLOURS);
    }
  });

  it('spreads ids across all six, not into one bucket', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i += 1) seen.add(projectColourIndex(`goal-${i}`));
    expect(seen.size).toBe(PROJECT_COLOURS);
  });

  it('returns literal class names Tailwind can scan', () => {
    const cls = projectBlockClass('abc1234');
    // A template literal would generate no CSS at all, so the classes must
    // appear verbatim in the source.
    expect(cls).toMatch(/\bbg-proj-[0-5]\/\d+\b/);
    expect(cls).toMatch(/\bborder-l-proj-[0-5]\b/);
  });

  it('gives a loose task the neutral treatment, not an invented identity', () => {
    const cls = projectBlockClass(null);
    expect(cls).toContain('border-l-line-2');
    expect(cls).not.toMatch(/proj-[0-5]/);
  });

  it('carries a dark-mode fill for every palette entry', () => {
    // A 12% tint over #0D0D0E is invisible; the dark variant is what keeps the
    // block distinguishable from the grid in the OLED theme.
    for (let i = 0; i < 500; i += 1) {
      expect(projectBlockClass(`goal-${i}`)).toMatch(/\bdark:bg-proj-[0-5]\/\d+\b/);
    }
  });
});

/*
 * The rail is a 3px non-text element, so WCAG 1.4.11 applies and each colour
 * must clear 3:1 against the panel it sits on — in BOTH themes. The tokens are
 * declared once (see index.css); this is what proves that single declaration
 * spans both panels.
 */
describe('palette contrast', () => {
  const CSS = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');
  const LIGHT_PANEL: Rgb = [255, 255, 255];
  const DARK_PANEL: Rgb = themeTokens(CSS, '.dark')['c-panel'];

  it('reads a dark panel from the stylesheet rather than a literal', () => {
    // If `--c-panel` is ever renamed, every assertion below would otherwise
    // compare against `undefined` and throw somewhere less obvious.
    expect(DARK_PANEL).toBeDefined();
  });

  for (let i = 0; i < PROJECT_COLOURS; i += 1) {
    it(`--c-proj-${i} clears 3:1 on both panels`, () => {
      const hue = themeTokens(CSS, ':root')[`c-proj-${i}`];
      expect(hue, `--c-proj-${i} missing from :root`).toBeDefined();
      expect(contrastRatio(hue, LIGHT_PANEL)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(hue, DARK_PANEL)).toBeGreaterThanOrEqual(3);
    });
  }
});
