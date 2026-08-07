import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
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

  function channels(name: string): [number, number, number] {
    const match = new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`).exec(CSS);
    if (!match) throw new Error(`--${name} not found in index.css`);
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  }

  function luminance([r, g, b]: [number, number, number]): number {
    const lin = [r, g, b].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }

  function ratio(a: number, b: number): number {
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return (hi + 0.05) / (lo + 0.05);
  }

  const LIGHT_PANEL = luminance([255, 255, 255]);
  const DARK_PANEL = luminance([13, 13, 14]);

  for (let i = 0; i < PROJECT_COLOURS; i += 1) {
    it(`--c-proj-${i} clears 3:1 on both panels`, () => {
      const l = luminance(channels(`c-proj-${i}`));
      expect(ratio(l, LIGHT_PANEL)).toBeGreaterThanOrEqual(3);
      expect(ratio(l, DARK_PANEL)).toBeGreaterThanOrEqual(3);
    });
  }
});
