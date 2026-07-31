import { describe, expect, it } from 'vitest';
import {
  resolveAppKeyCommand,
  shouldConsumePaletteShortcut,
  shouldConsumeTaskCaptureShortcut,
} from './appKeyboard';

const inputTarget = { tagName: 'INPUT', isContentEditable: false };

describe('resolveAppKeyCommand', () => {
  it('prioritizes Cmd/Ctrl+N task capture even when an input is focused', () => {
    expect(resolveAppKeyCommand({
      key: 'n',
      metaKey: true,
      target: inputTarget,
    })).toBe('capture-task');
    expect(resolveAppKeyCommand({
      key: 'N',
      ctrlKey: true,
      target: inputTarget,
    })).toBe('capture-task');
  });

  it('consumes exact repeated capture chords without issuing another command', () => {
    const repeat = {
      key: 'n',
      ctrlKey: true,
      repeat: true,
      target: inputTarget,
    };

    expect(shouldConsumeTaskCaptureShortcut(repeat)).toBe(true);
    expect(resolveAppKeyCommand(repeat)).toBeNull();
  });

  it('does not intercept Alt or Shift variants', () => {
    const alt = {
      key: 'n',
      metaKey: true,
      altKey: true,
      target: inputTarget,
    };
    const shift = {
      key: 'n',
      ctrlKey: true,
      shiftKey: true,
      target: inputTarget,
    };

    expect(shouldConsumeTaskCaptureShortcut(alt)).toBe(false);
    expect(resolveAppKeyCommand({
      ...alt,
    })).toBeNull();
    expect(shouldConsumeTaskCaptureShortcut(shift)).toBe(false);
    expect(resolveAppKeyCommand(shift)).toBeNull();
  });

  it('preserves editable-target Escape and suppresses other view shortcuts', () => {
    expect(resolveAppKeyCommand({ key: 'Escape', target: inputTarget })).toBe('blur-target');
    expect(resolveAppKeyCommand({ key: '2', target: inputTarget })).toBeNull();
  });

  it('preserves the existing unmodified app shortcuts', () => {
    expect(resolveAppKeyCommand({ key: 'Escape' })).toBe('close-drawer');
    // `t` is the Plan view's own key (jump the week back to today), handled on
    // its capture-phase listener. There is deliberately no app-level binding:
    // the old one only called `goToToday`, and nothing reads the `selDate` it
    // sets — it appeared to work because Plan remounts on the current week.
    expect(resolveAppKeyCommand({ key: 't' })).toBeNull();
    expect(resolveAppKeyCommand({ key: 'T' })).toBeNull();
  });

  it('maps 1-3 to the three views in nav order, but not while typing', () => {
    expect(resolveAppKeyCommand({ key: '1' })).toBe('view-plan');
    expect(resolveAppKeyCommand({ key: '2' })).toBe('view-goals');
    expect(resolveAppKeyCommand({ key: '3' })).toBe('view-timeline');
    expect(resolveAppKeyCommand({ key: '1', target: inputTarget })).toBeNull();
    expect(resolveAppKeyCommand({ key: '3', target: inputTarget })).toBeNull();
  });

  it('leaves 4 and 5 unmapped now that Today and the modal planner are gone', () => {
    expect(resolveAppKeyCommand({ key: '4' })).toBeNull();
    expect(resolveAppKeyCommand({ key: '5' })).toBeNull();
  });

  it('toggles the shortcut cheat sheet on ? (Shift+/), but not while typing', () => {
    expect(resolveAppKeyCommand({ key: '?', shiftKey: true })).toBe('toggle-shortcuts');
    expect(resolveAppKeyCommand({ key: '?', shiftKey: true, target: inputTarget })).toBeNull();
  });

  describe('⌘K palette', () => {
    it('opens from anywhere, including while a field is focused', () => {
      expect(resolveAppKeyCommand({ key: 'k', metaKey: true })).toBe('open-palette');
      expect(resolveAppKeyCommand({ key: 'K', ctrlKey: true, target: inputTarget }))
        .toBe('open-palette');
    });

    it('reports the chord so the caller can preventDefault Ctrl+K', () => {
      expect(shouldConsumePaletteShortcut({ key: 'k', metaKey: true })).toBe(true);
      expect(shouldConsumePaletteShortcut({ key: 'k' })).toBe(false);
    });

    it('ignores Alt and Shift variants, and bare k', () => {
      expect(resolveAppKeyCommand({ key: 'k', metaKey: true, altKey: true })).toBeNull();
      expect(resolveAppKeyCommand({ key: 'k', metaKey: true, shiftKey: true })).toBeNull();
      expect(resolveAppKeyCommand({ key: 'k' })).toBeNull();
    });
  });

  describe('⌘Z undo', () => {
    it('undoes the last action', () => {
      expect(resolveAppKeyCommand({ key: 'z', metaKey: true })).toBe('undo');
      expect(resolveAppKeyCommand({ key: 'Z', ctrlKey: true })).toBe('undo');
    });

    // A half-typed rename needs character-level undo far more than it needs the
    // store's undo, so the field keeps the chord.
    it('leaves text undo alone inside a field', () => {
      expect(resolveAppKeyCommand({ key: 'z', metaKey: true, target: inputTarget })).toBeNull();
    });

    it('does not bind redo', () => {
      expect(resolveAppKeyCommand({ key: 'z', metaKey: true, shiftKey: true })).toBeNull();
    });
  });
});
