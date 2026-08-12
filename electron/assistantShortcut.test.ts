import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { createAssistantShortcut } =
  nativeRequire('./assistantShortcut.cjs') as typeof import('./assistantShortcut.cjs');

function harness(over: { registerOk?: (accelerator: string) => boolean } = {}) {
  const registered: string[] = [];
  const unregistered: string[] = [];
  const onOpen = vi.fn();
  const registerOk = over.registerOk ?? (() => true);
  const shortcut = createAssistantShortcut({
    register: vi.fn((accelerator: string) => {
      if (!registerOk(accelerator)) return false;
      registered.push(accelerator);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => {
      unregistered.push(accelerator);
    }),
    onOpen,
  });
  return { shortcut, registered, unregistered, onOpen };
}

describe('createAssistantShortcut', () => {
  it('registers a valid chord and reports it active', () => {
    const { shortcut } = harness();
    expect(shortcut.setAccelerator('Command+Space')).toEqual({
      requested: 'Command+Space', active: 'Command+Space', registered: true, conflict: false,
    });
  });

  it('reports a conflict without throwing when registration returns false', () => {
    const { shortcut } = harness({ registerOk: () => false });
    expect(shortcut.setAccelerator('Command+Space')).toEqual({
      requested: 'Command+Space', active: null, registered: false, conflict: true,
    });
  });

  it('registers the new chord before unregistering the old one', () => {
    const events: string[] = [];
    const shortcut = createAssistantShortcut({
      register: (accelerator: string) => { events.push(`register:${accelerator}`); return true; },
      unregister: (accelerator: string) => { events.push(`unregister:${accelerator}`); },
      onOpen: () => {},
    });
    shortcut.setAccelerator('Command+Space');
    shortcut.setAccelerator('Control+Alt+K');
    expect(events).toEqual([
      'register:Command+Space',
      'register:Control+Alt+K',
      'unregister:Command+Space',
    ]);
  });

  it('keeps the previous chord explicitly active when the new one conflicts', () => {
    const { shortcut, unregistered } = harness({ registerOk: (a) => a === 'Command+Space' });
    shortcut.setAccelerator('Command+Space');
    expect(shortcut.setAccelerator('Control+Alt+K')).toEqual({
      requested: 'Control+Alt+K', active: 'Command+Space', registered: false, conflict: true,
    });
    expect(unregistered).toEqual([]);
  });

  it('re-requesting the active chord is a quiet success, not a re-registration', () => {
    const { shortcut, registered } = harness();
    shortcut.setAccelerator('Command+Space');
    expect(shortcut.setAccelerator('Command+Space')).toMatchObject({ registered: true, conflict: false });
    expect(registered).toEqual(['Command+Space']);
  });

  it('rejects malformed input without touching the OS registry', () => {
    const { shortcut, registered } = harness();
    for (const bad of [null, 42, '', 'x'.repeat(200), 'Space', 'Command+']) {
      expect(shortcut.setAccelerator(bad as never)).toMatchObject({ registered: false, conflict: false });
    }
    expect(registered).toEqual([]);
  });

  it('dispose unregisters the active accelerator', () => {
    const { shortcut, unregistered } = harness();
    shortcut.setAccelerator('Command+Space');
    shortcut.dispose();
    expect(unregistered).toEqual(['Command+Space']);
    // A second dispose has nothing left to do.
    shortcut.dispose();
    expect(unregistered).toEqual(['Command+Space']);
  });

  it('wires the open handler into registration', () => {
    const opened = vi.fn();
    let handler: (() => void) | null = null;
    const shortcut = createAssistantShortcut({
      register: (_accelerator: string, fn: () => void) => { handler = fn; return true; },
      unregister: () => {},
      onOpen: opened,
    });
    shortcut.setAccelerator('Command+Space');
    handler!();
    expect(opened).toHaveBeenCalledTimes(1);
  });
});
