import { describe, expect, it } from 'vitest';
import { contrastRatio, cssBlock, luminance, themeTokens } from './contrast';

describe('luminance', () => {
  it('puts black at 0 and white at 1', () => {
    expect(luminance([0, 0, 0])).toBeCloseTo(0, 5);
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 5);
  });

  it('linearises the channel rather than averaging it', () => {
    // Mid-grey is ~21.6% luminance, not 50%. An unlinearised sum returns .5
    // and would silently pass every ratio assertion that follows.
    expect(luminance([128, 128, 128])).toBeGreaterThan(0.2);
    expect(luminance([128, 128, 128])).toBeLessThan(0.23);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
  });

  it('does not care which argument is lighter', () => {
    const a: [number, number, number] = [26, 26, 24];
    const b: [number, number, number] = [255, 255, 255];
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it('is 1:1 for a colour against itself', () => {
    expect(contrastRatio([58, 74, 92], [58, 74, 92])).toBeCloseTo(1, 10);
  });
});

describe('cssBlock', () => {
  it('returns the body of the named rule', () => {
    expect(cssBlock('a { x: 1; } .b { y: 2; }', '.b').trim()).toBe('y: 2;');
  });

  it('matches braces rather than stopping at the first one', () => {
    const css = '.dark { --c-ink: 1 2 3; @media (x) { --c-bg: 4 5 6; } } .after { z: 9; }';
    const body = cssBlock(css, '.dark');
    expect(body).toContain('--c-bg: 4 5 6');
    expect(body).not.toContain('z: 9');
  });

  it('throws when the selector is absent', () => {
    expect(() => cssBlock('.a { x: 1; }', '.missing')).toThrow(/\.missing/);
  });
});

describe('themeTokens', () => {
  const css = `
    :root { --c-ink: 26 26 24; --c-bg: 247 247 245; --scrim: rgba(0,0,0,.3); }
    .dark { --c-ink: 235 231 222; }
  `;

  it('reads only the triples in the requested scope', () => {
    expect(themeTokens(css, ':root')['c-ink']).toEqual([26, 26, 24]);
    expect(themeTokens(css, '.dark')['c-ink']).toEqual([235, 231, 222]);
  });

  it('ignores declarations that are not channel triples', () => {
    expect(themeTokens(css, ':root')).not.toHaveProperty('scrim');
  });
});
