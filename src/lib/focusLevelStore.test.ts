import { describe, it, expect } from 'vitest';
import { DEFAULT_FOCUS_LEVEL, focusLevelFor, isFocusLevel } from './focusLens';

describe('the dial the store holds', () => {
  it('starts at the default when nothing is stored', () => {
    expect(focusLevelFor(null, '2026-08-15')).toBe(DEFAULT_FOCUS_LEVEL);
  });

  it('refuses a value that is not a level', () => {
    expect(isFocusLevel('deep')).toBe(false);
  });
});
