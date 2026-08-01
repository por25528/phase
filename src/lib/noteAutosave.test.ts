import { describe, expect, it } from 'vitest';
import { shouldFlushNoteSave } from './noteAutosave';

describe('shouldFlushNoteSave', () => {
  it('defers a debounced save while an undo is pending', () => {
    expect(shouldFlushNoteSave(true, 'debounce')).toBe(false);
  });

  it('saves on debounce when nothing is armed', () => {
    expect(shouldFlushNoteSave(false, 'debounce')).toBe(true);
  });

  it('always saves on unmount, even with an undo armed', () => {
    // Losing the user's typing is worse than losing an undo they may not use.
    expect(shouldFlushNoteSave(true, 'unmount')).toBe(true);
  });

  it('always saves on blur', () => {
    expect(shouldFlushNoteSave(true, 'blur')).toBe(true);
  });
});
