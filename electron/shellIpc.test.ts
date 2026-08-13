import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { createShellIpc, SHELL_CHANNEL_PREFIX } =
  nativeRequire('./shellIpc.cjs') as typeof import('./shellIpc.cjs');

type Listener = (event: { sender: { id: number } }, payload?: unknown) => unknown;

/** A fake ipcMain that records handle registrations and lets tests invoke them. */
function fakeIpcMain() {
  const handles = new Map<string, Listener>();
  return {
    on: vi.fn(),
    handle: vi.fn((channel: string, listener: Listener) => handles.set(channel, listener)),
    removeAllListeners: vi.fn(),
    removeHandler: vi.fn((channel: string) => handles.delete(channel)),
    invoke: (channel: string, senderId: number, payload?: unknown) =>
      handles.get(channel)?.({ sender: { id: senderId } }, payload),
    channels: () => [...handles.keys()],
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
  const ipcMain = fakeIpcMain();
  const ipc = createShellIpc({
    getMainWindow: () => main,
    openAssistant,
    showMainWindow,
    getLaunchAtLogin,
    setLaunchAtLogin,
  });
  ipc.register(ipcMain);
  return { main, openAssistant, showMainWindow, getLaunchAtLogin, setLaunchAtLogin, ipcMain, ipc };
}

describe('channel surface', () => {
  it('exposes the fixed phase-shell prefix', () => {
    expect(SHELL_CHANNEL_PREFIX).toBe('phase-shell');
  });

  it('register installs exactly the three fixed invoke handlers and no listeners', () => {
    const { ipcMain } = shell();
    expect(ipcMain.handle).toHaveBeenCalledTimes(3);
    expect(ipcMain.on).not.toHaveBeenCalled();
    expect(ipcMain.channels()).toEqual([
      'phase-shell:open-assistant',
      'phase-shell:get-launch-at-login',
      'phase-shell:set-launch-at-login',
    ]);
  });

  it('dispose removes all three handlers', () => {
    const { ipcMain, ipc } = shell();
    ipc.dispose(ipcMain);
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(3);
    expect(ipcMain.channels()).toEqual([]);
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
    });
    ipc.register(fakeIpcMain());
    ipc.openSettings();
    expect(showMainWindow).toHaveBeenCalledTimes(1);
  });
});
