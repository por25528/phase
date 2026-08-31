import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { createShellIpc, SHELL_CHANNEL_PREFIX, FOCUS_STATUS_CHANNEL, FOCUS_REQUEST_CHANNEL } =
  nativeRequire('./shellIpc.cjs') as typeof import('./shellIpc.cjs');

type Listener = (event: { sender: { id: number } }, payload?: unknown) => unknown;

/** A fake ipcMain that records handle registrations and lets tests invoke them. */
function fakeIpcMain() {
  const handles = new Map<string, Listener>();
  const listeners = new Map<string, Listener>();
  return {
    on: vi.fn((channel: string, listener: Listener) => listeners.set(channel, listener)),
    handle: vi.fn((channel: string, listener: Listener) => handles.set(channel, listener)),
    removeAllListeners: vi.fn((channel: string) => listeners.delete(channel)),
    removeHandler: vi.fn((channel: string) => handles.delete(channel)),
    invoke: (channel: string, senderId: number, payload?: unknown) =>
      handles.get(channel)?.({ sender: { id: senderId } }, payload),
    send: (channel: string, senderId: number, payload?: unknown) =>
      listeners.get(channel)?.({ sender: { id: senderId } }, payload),
    channels: () => [...handles.keys()],
    listenerChannels: () => [...listeners.keys()],
  };
}

function fakeWindow(id: number, { loading = false } = {}) {
  const send = vi.fn();
  return {
    isDestroyed: () => false,
    webContents: {
      id,
      send,
      isLoadingMainFrame: () => loading,
      once: vi.fn(),
    },
  };
}

const MAIN_ID = 1;
const STRANGER_ID = 9;

function shell() {
  const main = fakeWindow(MAIN_ID);
  const openAssistant = vi.fn();
  const showMainWindow = vi.fn();
  const getLaunchAtLogin = vi.fn();
  const setLaunchAtLogin = vi.fn();
  const onFocusStatus = vi.fn();
  const onOverlayEnabled = vi.fn();
  const ipcMain = fakeIpcMain();
  const ipc = createShellIpc({
    getMainWindow: () => main,
    openAssistant,
    showMainWindow,
    getLaunchAtLogin,
    setLaunchAtLogin,
    onFocusStatus,
    onOverlayEnabled,
  });
  ipc.register(ipcMain);
  return {
    main, openAssistant, showMainWindow, getLaunchAtLogin, setLaunchAtLogin,
    onFocusStatus, onOverlayEnabled, ipcMain, ipc,
  };
}

describe('channel surface', () => {
  it('exposes the fixed phase-shell prefix', () => {
    expect(SHELL_CHANNEL_PREFIX).toBe('phase-shell');
  });

  it('names the two focus channels under the same fixed prefix', () => {
    expect(FOCUS_STATUS_CHANNEL).toBe('phase-shell:focus-status');
    expect(FOCUS_REQUEST_CHANNEL).toBe('phase-shell:focus-request');
  });

  it('register installs exactly the three invoke handlers and the two listeners', () => {
    const { ipcMain } = shell();
    expect(ipcMain.handle).toHaveBeenCalledTimes(3);
    expect(ipcMain.channels()).toEqual([
      'phase-shell:open-assistant',
      'phase-shell:get-launch-at-login',
      'phase-shell:set-launch-at-login',
    ]);
    // Both are sends and not invokes: nothing answers either, and neither a
    // transition nor a preference must wait on a tray or a pill.
    expect(ipcMain.on).toHaveBeenCalledTimes(2);
    expect(ipcMain.listenerChannels()).toEqual([
      'phase-shell:focus-status',
      'phase-shell:overlay-enabled',
    ]);
  });

  it('dispose removes all three handlers and both listeners', () => {
    const { ipcMain, ipc } = shell();
    ipc.dispose(ipcMain);
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(3);
    expect(ipcMain.removeAllListeners).toHaveBeenCalledWith('phase-shell:focus-status');
    expect(ipcMain.channels()).toEqual([]);
    expect(ipcMain.listenerChannels()).toEqual([]);
  });
});

describe('focus-status', () => {
  const snapshot = {
    phase: 'active' as const, activeSinceMs: 1_700_000_000_000, accumulatedMs: 0, title: 'PS4',
  };

  it('hands a well-formed snapshot from the main window straight through', () => {
    const { ipcMain, onFocusStatus } = shell();
    ipcMain.send('phase-shell:focus-status', MAIN_ID, snapshot);
    expect(onFocusStatus).toHaveBeenCalledWith(snapshot);
  });

  it('passes null through — "no session" is a real answer', () => {
    const { ipcMain, onFocusStatus } = shell();
    ipcMain.send('phase-shell:focus-status', MAIN_ID, null);
    expect(onFocusStatus).toHaveBeenCalledWith(null);
  });

  it('ignores any other sender', () => {
    const { ipcMain, onFocusStatus } = shell();
    ipcMain.send('phase-shell:focus-status', STRANGER_ID, snapshot);
    expect(onFocusStatus).not.toHaveBeenCalled();
  });

  /**
   * A malformed payload is DROPPED rather than read as "no session": nobody in
   * this repo sends one, so the only way to see one is a renderer that has gone
   * wrong, and clearing a running timer on that basis would hide the session
   * rather than report the fault.
   */
  it('drops a malformed payload instead of clearing the session', () => {
    const { ipcMain, onFocusStatus } = shell();
    for (const bad of [
      'active',
      42,
      {},
      { ...snapshot, phase: 'paused' },
      { ...snapshot, accumulatedMs: -1 },
      { ...snapshot, accumulatedMs: Number.NaN },
      { ...snapshot, activeSinceMs: 'now' },
      { ...snapshot, title: 7 },
    ]) {
      ipcMain.send('phase-shell:focus-status', MAIN_ID, bad);
    }
    expect(onFocusStatus).not.toHaveBeenCalled();
  });

  it('keeps only the four declared fields, whatever else a renderer sends', () => {
    const { ipcMain, onFocusStatus } = shell();
    ipcMain.send('phase-shell:focus-status', MAIN_ID, { ...snapshot, ref: { id: 'n1' }, expected: {} });
    expect(onFocusStatus).toHaveBeenCalledWith(snapshot);
  });

  it('accepts a break, whose active stretch is null', () => {
    const { ipcMain, onFocusStatus } = shell();
    const paused = { ...snapshot, phase: 'break' as const, activeSinceMs: null };
    ipcMain.send('phase-shell:focus-status', MAIN_ID, paused);
    expect(onFocusStatus).toHaveBeenCalledWith(paused);
  });
});

describe('sendFocusRequest', () => {
  it('sends on the one fixed channel and reports that it landed', () => {
    const { main, ipc } = shell();
    expect(ipc.sendFocusRequest({ type: 'take-break' })).toBe(true);
    expect(main.webContents.send)
      .toHaveBeenCalledWith('phase-shell:focus-request', { type: 'take-break' });
  });

  /**
   * Deliberately not `openSettings`' wait for `did-finish-load`. Every request
   * is about a session running right now, and replaying a menu click a page
   * load later would pause a session the user has since resumed.
   */
  it('never waits for a load, and answers false when the window is gone', () => {
    const { main, ipc } = shell();
    ipc.sendFocusRequest({ type: 'resume' });
    expect(main.webContents.once).not.toHaveBeenCalled();

    const gone = createShellIpc({
      getMainWindow: () => null,
      openAssistant: vi.fn(),
      showMainWindow: vi.fn(),
      getLaunchAtLogin: vi.fn(),
      setLaunchAtLogin: vi.fn(),
      onFocusStatus: vi.fn(),
      onOverlayEnabled: vi.fn(),
    });
    expect(gone.sendFocusRequest({ type: 'finish' })).toBe(false);
  });
});

describe('open-assistant', () => {
  it('calls the dependency exactly once and resolves true for the main window', () => {
    const { ipcMain, openAssistant } = shell();
    expect(ipcMain.invoke('phase-shell:open-assistant', MAIN_ID)).toBe(true);
    expect(openAssistant).toHaveBeenCalledTimes(1);
  });

  it('returns false for any other sender and never calls the dependency', () => {
    const { ipcMain, openAssistant } = shell();
    expect(ipcMain.invoke('phase-shell:open-assistant', STRANGER_ID)).toBe(false);
    expect(ipcMain.invoke('phase-shell:open-assistant', 0)).toBe(false);
    expect(openAssistant).not.toHaveBeenCalled();
  });
});

describe('get-launch-at-login', () => {
  it('returns the dependency result for the main window', () => {
    const { ipcMain, getLaunchAtLogin } = shell();
    getLaunchAtLogin.mockReturnValue(true);
    expect(ipcMain.invoke('phase-shell:get-launch-at-login', MAIN_ID)).toBe(true);
    getLaunchAtLogin.mockReturnValue(null);
    expect(ipcMain.invoke('phase-shell:get-launch-at-login', MAIN_ID)).toBeNull();
    expect(getLaunchAtLogin).toHaveBeenCalledTimes(2);
  });

  it('returns null for any other sender without touching the dependency', () => {
    const { ipcMain, getLaunchAtLogin } = shell();
    getLaunchAtLogin.mockReturnValue(true);
    expect(ipcMain.invoke('phase-shell:get-launch-at-login', STRANGER_ID)).toBeNull();
    expect(getLaunchAtLogin).not.toHaveBeenCalled();
  });
});

describe('set-launch-at-login', () => {
  it('forwards a boolean from the main window to the dependency', () => {
    const { ipcMain, setLaunchAtLogin } = shell();
    setLaunchAtLogin.mockReturnValue(true);
    expect(ipcMain.invoke('phase-shell:set-launch-at-login', MAIN_ID, true)).toBe(true);
    expect(setLaunchAtLogin).toHaveBeenCalledWith(true);
    setLaunchAtLogin.mockReturnValue(false);
    expect(ipcMain.invoke('phase-shell:set-launch-at-login', MAIN_ID, false)).toBe(false);
    expect(setLaunchAtLogin).toHaveBeenCalledWith(false);
  });

  it('returns null for a non-main sender or a non-boolean payload', () => {
    const { ipcMain, setLaunchAtLogin } = shell();
    for (const bad of [null, 'yes', 1, undefined, {}, []]) {
      expect(ipcMain.invoke('phase-shell:set-launch-at-login', MAIN_ID, bad)).toBeNull();
    }
    expect(ipcMain.invoke('phase-shell:set-launch-at-login', STRANGER_ID, true)).toBeNull();
    expect(setLaunchAtLogin).not.toHaveBeenCalled();
  });
});

describe('live main window', () => {
  it('treats a destroyed main window as absent on every verb', () => {
    const main = fakeWindow(MAIN_ID);
    main.isDestroyed = () => true;
    const openAssistant = vi.fn();
    const getLaunchAtLogin = vi.fn(() => true);
    const ipcMain = fakeIpcMain();
    const ipc = createShellIpc({
      getMainWindow: () => main,
      openAssistant,
      showMainWindow: vi.fn(),
      getLaunchAtLogin,
      setLaunchAtLogin: vi.fn(() => true),
      onFocusStatus: vi.fn(),
      onOverlayEnabled: vi.fn(),
    });
    ipc.register(ipcMain);
    expect(ipcMain.invoke('phase-shell:open-assistant', MAIN_ID)).toBe(false);
    expect(ipcMain.invoke('phase-shell:get-launch-at-login', MAIN_ID)).toBeNull();
    expect(ipcMain.invoke('phase-shell:set-launch-at-login', MAIN_ID, true)).toBeNull();
    expect(openAssistant).not.toHaveBeenCalled();
    expect(getLaunchAtLogin).not.toHaveBeenCalled();
  });
});

describe('openSettings', () => {
  it('raises the main window first, then sends immediately when the frame is loaded', () => {
    const { main, showMainWindow, ipc } = shell();
    ipc.openSettings();
    expect(showMainWindow).toHaveBeenCalledTimes(1);
    expect(main.webContents.send).toHaveBeenCalledWith('phase-shell:open-settings');
    expect(main.webContents.once).not.toHaveBeenCalled();
    expect(showMainWindow.mock.invocationCallOrder[0])
      .toBeLessThan(main.webContents.send.mock.invocationCallOrder[0]);
  });

  it('sends once after did-finish-load when the main frame is still loading', () => {
    const main = fakeWindow(MAIN_ID, { loading: true });
    const ipcMain = fakeIpcMain();
    const ipc = createShellIpc({
      getMainWindow: () => main,
      openAssistant: vi.fn(),
      showMainWindow: vi.fn(),
      getLaunchAtLogin: vi.fn(),
      setLaunchAtLogin: vi.fn(),
      onFocusStatus: vi.fn(),
      onOverlayEnabled: vi.fn(),
    });
    ipc.register(ipcMain);
    ipc.openSettings();
    expect(main.webContents.send).not.toHaveBeenCalled();
    expect(main.webContents.once).toHaveBeenCalledWith('did-finish-load', expect.any(Function));
    const finishLoad = main.webContents.once.mock.calls[0][1];
    finishLoad();
    expect(main.webContents.send).toHaveBeenCalledWith('phase-shell:open-settings');
    expect(main.webContents.send).toHaveBeenCalledTimes(1);
  });

  it('still raises the window when no live main exists', () => {
    const showMainWindow = vi.fn();
    const ipc = createShellIpc({
      getMainWindow: () => null,
      openAssistant: vi.fn(),
      showMainWindow,
      getLaunchAtLogin: vi.fn(),
      setLaunchAtLogin: vi.fn(),
      onFocusStatus: vi.fn(),
      onOverlayEnabled: vi.fn(),
    });
    ipc.register(fakeIpcMain());
    ipc.openSettings();
    expect(showMainWindow).toHaveBeenCalledTimes(1);
  });
});

/**
 * A sandboxed preload cannot `require` this module for the prefix, so
 * preload.cjs writes the channel names out by hand — and drift would be a
 * silent "function is not a function" in the renderer rather than a build
 * error. agentIpc.test.ts guards the agent door the same way.
 */
describe('overlay-enabled', () => {
  it('forwards a boolean from the main window to onOverlayEnabled', () => {
    const { ipcMain, onOverlayEnabled } = shell();
    ipcMain.send('phase-shell:overlay-enabled', MAIN_ID, false);
    expect(onOverlayEnabled).toHaveBeenCalledTimes(1);
    expect(onOverlayEnabled).toHaveBeenCalledWith(false);
  });

  it('refuses a non-boolean and a foreign sender', () => {
    const { ipcMain, onOverlayEnabled } = shell();
    ipcMain.send('phase-shell:overlay-enabled', MAIN_ID, 'yes');
    expect(onOverlayEnabled).not.toHaveBeenCalled();
    ipcMain.send('phase-shell:overlay-enabled', STRANGER_ID, true);
    expect(onOverlayEnabled).not.toHaveBeenCalled();
  });

  it('registers and disposes the channel symmetrically', () => {
    const { ipcMain, ipc } = shell();
    expect(ipcMain.on).toHaveBeenCalledWith('phase-shell:overlay-enabled', expect.any(Function));
    expect(ipcMain.listenerChannels()).toContain('phase-shell:overlay-enabled');
    ipc.dispose(ipcMain);
    expect(ipcMain.removeAllListeners).toHaveBeenCalledWith('phase-shell:overlay-enabled');
    expect(ipcMain.listenerChannels()).toEqual([]);
  });
});

describe('preload drift', () => {
  const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');

  it('exposes exactly the shell channels this module installs', () => {
    for (const channel of [
      `${SHELL_CHANNEL_PREFIX}:open-assistant`,
      `${SHELL_CHANNEL_PREFIX}:open-settings`,
      `${SHELL_CHANNEL_PREFIX}:get-launch-at-login`,
      `${SHELL_CHANNEL_PREFIX}:set-launch-at-login`,
      FOCUS_STATUS_CHANNEL,
      FOCUS_REQUEST_CHANNEL,
    ]) {
      expect(preload).toContain(channel);
    }
  });

  it('publishes the status with send, never invoke — nothing answers it', () => {
    expect(preload).toContain(`ipcRenderer.send('${FOCUS_STATUS_CHANNEL}'`);
    expect(preload).not.toContain(`ipcRenderer.invoke('${FOCUS_STATUS_CHANNEL}'`);
  });

  it('never hands the renderer a channel-name parameter', () => {
    expect(preload).not.toMatch(/phaseShell[\s\S]*?ipcRenderer\.(invoke|send|on)\(\s*channel/);
  });
});
