import { describe, it, expect } from 'vitest';
import { resolveTheme, type Theme } from './theme';

describe('resolveTheme', () => {
  // Forced themes ignore the system preference entirely.
  it('light pref → light, regardless of system', () => {
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('dark pref → dark, regardless of system', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
  });

  // System follows the OS preference.
  it('system pref follows systemPrefersDark', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  // Full truth table (3 prefs × 2 system states) — the unit-tested core.
  it('covers the whole 3×2 truth table', () => {
    const table: Array<[Theme, boolean, 'light' | 'dark']> = [
      ['system', false, 'light'],
      ['system', true, 'dark'],
      ['light', false, 'light'],
      ['light', true, 'light'],
      ['dark', false, 'dark'],
      ['dark', true, 'dark'],
    ];
    for (const [pref, sysDark, expected] of table) {
      expect(resolveTheme(pref, sysDark)).toBe(expected);
    }
  });
});
