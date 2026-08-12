import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ASSISTANT_ACCELERATOR,
  acceleratorFromEvent,
  formatAccelerator,
  isValidAccelerator,
  parseStoredAccelerator,
} from './assistantAccelerator';

describe('the default', () => {
  it('is exactly Command+Space', () => {
    expect(DEFAULT_ASSISTANT_ACCELERATOR).toBe('Command+Space');
  });
});

describe('acceleratorFromEvent', () => {
  const event = (over: Partial<Parameters<typeof acceleratorFromEvent>[0]>) => ({
    key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over,
  });

  it('emits a valid Electron accelerator from a captured chord', () => {
    expect(acceleratorFromEvent(event({ key: ' ', metaKey: true }))).toBe('Command+Space');
    expect(acceleratorFromEvent(event({ key: 'k', metaKey: true, shiftKey: true }))).toBe('Command+Shift+K');
    expect(acceleratorFromEvent(event({ key: 'F6', ctrlKey: true }))).toBe('Control+F6');
    expect(acceleratorFromEvent(event({ key: 'ArrowUp', altKey: true }))).toBe('Alt+Up');
  });

  it('requires a real modifier', () => {
    expect(acceleratorFromEvent(event({ key: 'k' }))).toBeNull();
    // Shift alone is typing, not a chord.
    expect(acceleratorFromEvent(event({ key: 'k', shiftKey: true }))).toBeNull();
  });

  it('rejects a modifier press with no key', () => {
    expect(acceleratorFromEvent(event({ key: 'Meta', metaKey: true }))).toBeNull();
    expect(acceleratorFromEvent(event({ key: 'Shift', metaKey: true, shiftKey: true }))).toBeNull();
    expect(acceleratorFromEvent(event({ key: 'Control', ctrlKey: true }))).toBeNull();
  });

  it('rejects keys outside the closed vocabulary', () => {
    expect(acceleratorFromEvent(event({ key: 'Dead', metaKey: true }))).toBeNull();
  });
});

describe('isValidAccelerator', () => {
  it('accepts modifier plus key', () => {
    expect(isValidAccelerator('Command+Space')).toBe(true);
    expect(isValidAccelerator('Control+Alt+K')).toBe(true);
    expect(isValidAccelerator('Command+Shift+F2')).toBe(true);
  });

  it('rejects bare keys, modifier-only input, and malformed strings', () => {
    expect(isValidAccelerator('Space')).toBe(false);
    expect(isValidAccelerator('K')).toBe(false);
    expect(isValidAccelerator('Command+')).toBe(false);
    expect(isValidAccelerator('Command')).toBe(false);
    expect(isValidAccelerator('Shift+K')).toBe(false); // shift alone is typing
    expect(isValidAccelerator('')).toBe(false);
    expect(isValidAccelerator('Frobnicate+K')).toBe(false);
    expect(isValidAccelerator('Command+Space+K')).toBe(false);
    expect(isValidAccelerator('Command+Meta')).toBe(false);
  });
});

describe('parseStoredAccelerator', () => {
  it('returns a stored valid chord', () => {
    expect(parseStoredAccelerator('Control+Alt+K')).toBe('Control+Alt+K');
  });

  it('returns the default for absent or malformed settings', () => {
    expect(parseStoredAccelerator(undefined)).toBe(DEFAULT_ASSISTANT_ACCELERATOR);
    expect(parseStoredAccelerator(null)).toBe(DEFAULT_ASSISTANT_ACCELERATOR);
    expect(parseStoredAccelerator('')).toBe(DEFAULT_ASSISTANT_ACCELERATOR);
    expect(parseStoredAccelerator('Space')).toBe(DEFAULT_ASSISTANT_ACCELERATOR);
    expect(parseStoredAccelerator('{"weird":"json"}')).toBe(DEFAULT_ASSISTANT_ACCELERATOR);
  });
});

describe('formatAccelerator', () => {
  it('renders the chord as the keys a person presses', () => {
    expect(formatAccelerator('Command+Space')).toEqual(['⌘', 'Space']);
    expect(formatAccelerator('Control+Shift+K')).toEqual(['⌃', '⇧', 'K']);
    expect(formatAccelerator('Alt+Up')).toEqual(['⌥', '↑']);
  });
});
