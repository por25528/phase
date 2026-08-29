import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { createBackupIpc, BACKUP_CHANNEL_PREFIX } =
  nativeRequire('./backupIpc.cjs') as typeof import('./backupIpc.cjs');

type Listener = (event: { sender: { id: number } }, payload?: unknown) => unknown;

/** A fake ipcMain that records handle registrations and lets tests invoke them. */
function fakeIpcMain() {
  const handles = new Map<string, Listener>();
  return {
    on: vi.fn(),
    handle: vi.fn((channel: string, listener: Listener) => handles.set(channel, listener)),
    removeHandler: vi.fn((channel: string) => handles.delete(channel)),
    invoke: (channel: string, senderId: number, payload?: unknown) =>
      handles.get(channel)?.({ sender: { id: senderId } }, payload),
    channels: () => [...handles.keys()],
  };
}

function fakeWindow(id: number) {
  return { isDestroyed: () => false, webContents: { id } };
}

const MAIN_ID = 1;
const STRANGER_ID = 9;

const WRITTEN: import('./backupStore.cjs').WrittenBackup = {
  name: 'phase-backup-20260830-142530-auto.json',
  stamp: '20260830-142530',
  reason: 'auto',
  bytes: 12,
  pruned: [],
};

function harness({ main = fakeWindow(MAIN_ID) as ReturnType<typeof fakeWindow> | null } = {}) {
  const store = {
    dir: '/tmp/backups',
    list: vi.fn(() => [WRITTEN]),
    write: vi.fn(() => WRITTEN),
    read: vi.fn(() => '{"goals":[]}'),
  };
  const logError = vi.fn();
  const ipcMain = fakeIpcMain();
  const ipc = createBackupIpc({ getMainWindow: () => main, store, logError });
  ipc.register(ipcMain);
  return { store, ipcMain, ipc, logError };
}

describe('channel surface', () => {
  it('exposes the fixed phase-backups prefix', () => {
    expect(BACKUP_CHANNEL_PREFIX).toBe('phase-backups');
  });

  it('register installs exactly the three fixed invoke handlers and no listeners', () => {
    const { ipcMain } = harness();
    expect(ipcMain.handle).toHaveBeenCalledTimes(3);
    expect(ipcMain.on).not.toHaveBeenCalled();
    expect(ipcMain.channels()).toEqual([
      'phase-backups:list',
      'phase-backups:write',
      'phase-backups:read',
    ]);
  });

  it('dispose removes exactly those three and nothing else', () => {
    const { ipcMain, ipc } = harness();
    ipc.dispose(ipcMain);
    expect(ipcMain.channels()).toEqual([]);
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(3);
  });
});

/**
 * Sender validation, which is the whole reason this module exists rather than
 * three `ipcMain.handle` calls in main.cjs. Every verb here touches the user's
 * data folder; only the live main window may drive it.
 */
describe('sender validation', () => {
  it('refuses a list from anything but the main renderer', () => {
    const { ipcMain, store } = harness();
    expect(ipcMain.invoke('phase-backups:list', STRANGER_ID)).toEqual([]);
    expect(store.list).not.toHaveBeenCalled();
  });

  it('refuses a write from anything but the main renderer', () => {
    const { ipcMain, store } = harness();
    expect(ipcMain.invoke('phase-backups:write', STRANGER_ID, { text: '{}', reason: 'auto' })).toBeNull();
    expect(store.write).not.toHaveBeenCalled();
  });

  it('refuses a read from anything but the main renderer', () => {
    const { ipcMain, store } = harness();
    expect(ipcMain.invoke('phase-backups:read', STRANGER_ID, 'phase-backup-20260830-142530-auto.json'))
      .toBeNull();
    expect(store.read).not.toHaveBeenCalled();
  });

  it('refuses everything once the main window is gone', () => {
    const { ipcMain, store } = harness({ main: null });
    expect(ipcMain.invoke('phase-backups:list', MAIN_ID)).toEqual([]);
    expect(ipcMain.invoke('phase-backups:write', MAIN_ID, { text: '{}', reason: 'auto' })).toBeNull();
    expect(store.write).not.toHaveBeenCalled();
  });
});

/**
 * Argument validation. The renderer is the only sender, but it is also the
 * side an attacker reaches first, so the payload is checked here — the door,
 * not the room behind it.
 */
describe('argument validation', () => {
  it('writes a snapshot the main renderer asked for', () => {
    const { ipcMain, store } = harness();
    expect(ipcMain.invoke('phase-backups:write', MAIN_ID, { text: '{"goals":[]}', reason: 'manual' }))
      .toEqual(WRITTEN);
    expect(store.write).toHaveBeenCalledWith('{"goals":[]}', 'manual');
  });

  it('refuses a reason outside the closed vocabulary', () => {
    const { ipcMain, store } = harness();
    expect(ipcMain.invoke('phase-backups:write', MAIN_ID, { text: '{}', reason: 'restore' })).toBeNull();
    expect(store.write).not.toHaveBeenCalled();
  });

  it('refuses a payload that is not an object with a string body', () => {
    const { ipcMain, store } = harness();
    expect(ipcMain.invoke('phase-backups:write', MAIN_ID, undefined)).toBeNull();
    expect(ipcMain.invoke('phase-backups:write', MAIN_ID, '{}')).toBeNull();
    expect(ipcMain.invoke('phase-backups:write', MAIN_ID, { text: 42, reason: 'auto' })).toBeNull();
    expect(ipcMain.invoke('phase-backups:write', MAIN_ID, { reason: 'auto' })).toBeNull();
    expect(store.write).not.toHaveBeenCalled();
  });

  it('refuses a write larger than the cap rather than filling the disk', () => {
    const { ipcMain, store } = harness();
    const huge = 'x'.repeat(64 * 1024 * 1024 + 1);
    expect(ipcMain.invoke('phase-backups:write', MAIN_ID, { text: huge, reason: 'auto' })).toBeNull();
    expect(store.write).not.toHaveBeenCalled();
  });

  it('reads a snapshot the main renderer named', () => {
    const { ipcMain, store } = harness();
    expect(ipcMain.invoke('phase-backups:read', MAIN_ID, 'phase-backup-20260830-142530-auto.json'))
      .toBe('{"goals":[]}');
    expect(store.read).toHaveBeenCalledWith('phase-backup-20260830-142530-auto.json');
  });

  it('refuses a read whose name is not a backup name', () => {
    const { ipcMain, store } = harness();
    // The store refuses these too. Refusing here as well is deliberate: the
    // traversal guard is not something a swapped-in store should be able to
    // remove by accident.
    expect(ipcMain.invoke('phase-backups:read', MAIN_ID, '../../secrets.json')).toBeNull();
    expect(ipcMain.invoke('phase-backups:read', MAIN_ID, 42)).toBeNull();
    expect(ipcMain.invoke('phase-backups:read', MAIN_ID, undefined)).toBeNull();
    expect(store.read).not.toHaveBeenCalled();
  });
});

/**
 * A backup folder that cannot be reached must not take the app with it — the
 * same rule every bridge in main.cjs already follows.
 */
describe('disk failure', () => {
  it('answers null and logs when the store throws on write', () => {
    const { ipcMain, store, logError } = harness();
    store.write.mockImplementation(() => { throw new Error('ENOSPC'); });
    expect(ipcMain.invoke('phase-backups:write', MAIN_ID, { text: '{}', reason: 'auto' })).toBeNull();
    expect(logError).toHaveBeenCalled();
  });

  it('answers an empty list when the store throws on list', () => {
    const { ipcMain, store } = harness();
    store.list.mockImplementation(() => { throw new Error('EACCES'); });
    expect(ipcMain.invoke('phase-backups:list', MAIN_ID)).toEqual([]);
  });

  it('answers null when the store throws on read', () => {
    const { ipcMain, store } = harness();
    store.read.mockImplementation(() => { throw new Error('EIO'); });
    expect(ipcMain.invoke('phase-backups:read', MAIN_ID, 'phase-backup-20260830-142530-auto.json'))
      .toBeNull();
  });
});

// The preload cannot require this module (sandboxed), so the channel names are
// written out by hand there. This pin stops the two from drifting — same
// pattern as calendarIpc.test.ts and updateCheck.test.ts.
describe('preload contract', () => {
  const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');

  it('preload.cjs invokes exactly the channels main registers', () => {
    expect(preload).toContain("ipcRenderer.invoke('phase-backups:list')");
    expect(preload).toContain("ipcRenderer.invoke('phase-backups:write'");
    expect(preload).toContain("ipcRenderer.invoke('phase-backups:read'");
  });

  it('exposes no channel-taking escape hatch on the backups door', () => {
    const surface = /exposeInMainWorld\('phaseBackups',([\s\S]*?)\n\}\);/.exec(preload)?.[1] ?? '';
    expect(surface).not.toBe('');
    // Every ipcRenderer call inside the door names a literal channel.
    for (const call of surface.matchAll(/ipcRenderer\.\w+\(([^,)]*)/g)) {
      expect(call[1].trim()).toMatch(/^'phase-backups:[\w-]+'$/);
    }
  });
});
