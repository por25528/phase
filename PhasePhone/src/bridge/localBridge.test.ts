import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalBridge, seedState, JOURNAL_KEY, STATE_KEY } from './localBridge';

beforeEach(() => {
  localStorage.clear();
});

describe('the state file', () => {
  it('reads null before the Mac has ever exported', async () => {
    await expect(createLocalBridge().readStateFile()).resolves.toBeNull();
  });

  it('reads back what seedState put there', async () => {
    seedState('{"hello":1}');
    await expect(createLocalBridge().readStateFile()).resolves.toBe('{"hello":1}');
  });
});

describe('the journal', () => {
  it('is empty, not absent, before anything is appended', async () => {
    await expect(createLocalBridge().readJournal()).resolves.toBe('');
  });

  it('accumulates one newline-terminated line per append', async () => {
    const bridge = createLocalBridge();
    await bridge.appendOp('{"id":"a"}');
    await bridge.appendOp('{"id":"b"}');
    await expect(bridge.readJournal()).resolves.toBe('{"id":"a"}\n{"id":"b"}\n');
  });

  it('rewrite replaces everything before it', async () => {
    const bridge = createLocalBridge();
    await bridge.appendOp('{"id":"a"}');
    await bridge.rewriteJournal('{"id":"c"}\n');
    await expect(bridge.readJournal()).resolves.toBe('{"id":"c"}\n');
  });

  it('appends onto a rewrite that did not end in a newline', async () => {
    const bridge = createLocalBridge();
    await bridge.rewriteJournal('{"id":"c"}');
    await bridge.appendOp('{"id":"d"}');
    await expect(bridge.readJournal()).resolves.toBe('{"id":"c"}\n{"id":"d"}\n');
  });
});

describe('onChange', () => {
  it('fires on a storage event for either file and stops after unsubscribe', () => {
    const bridge = createLocalBridge();
    const cb = vi.fn();
    const off = bridge.onChange(cb);

    window.dispatchEvent(new StorageEvent('storage', { key: STATE_KEY }));
    window.dispatchEvent(new StorageEvent('storage', { key: JOURNAL_KEY }));
    expect(cb).toHaveBeenCalledTimes(2);

    off();
    window.dispatchEvent(new StorageEvent('storage', { key: STATE_KEY }));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('ignores a key that is not ours', () => {
    const cb = vi.fn();
    createLocalBridge().onChange(cb);
    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }));
    expect(cb).not.toHaveBeenCalled();
  });
});
