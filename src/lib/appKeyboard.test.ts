import { describe, expect, it } from 'vitest';
import { resolveAppKeyCommand } from './appKeyboard';

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

  it('does not capture Alt combinations or repeated keydown events', () => {
    expect(resolveAppKeyCommand({
      key: 'n',
      metaKey: true,
      altKey: true,
      target: inputTarget,
    })).toBeNull();
    expect(resolveAppKeyCommand({
      key: 'n',
      ctrlKey: true,
      repeat: true,
      target: inputTarget,
    })).toBeNull();
  });

  it('preserves editable-target Escape and suppresses other view shortcuts', () => {
    expect(resolveAppKeyCommand({ key: 'Escape', target: inputTarget })).toBe('blur-target');
    expect(resolveAppKeyCommand({ key: '2', target: inputTarget })).toBeNull();
  });

  it('preserves the existing unmodified app shortcuts', () => {
    expect(resolveAppKeyCommand({ key: 'Escape' })).toBe('close-drawer');
    expect(resolveAppKeyCommand({ key: '1' })).toBe('view-today');
    expect(resolveAppKeyCommand({ key: '2' })).toBe('view-goals');
    expect(resolveAppKeyCommand({ key: '3' })).toBe('view-timeline');
    expect(resolveAppKeyCommand({ key: 't' })).toBe('go-today');
    expect(resolveAppKeyCommand({ key: 'T' })).toBeNull();
  });
});
