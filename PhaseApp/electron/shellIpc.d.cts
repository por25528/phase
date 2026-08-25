// Deliberately imports nothing from src/ and nothing from `electron`: the
// process seam prevents sharing declarations across it (see busyBlocks.d.cts),
// and every capability is injected, so the static face here is the minimal
// truth the main process hands in.

/** Loosely-typed window handle so this module never imports `electron`. */
export interface ShellWindow {
  isDestroyed(): boolean;
  webContents: {
    id: number;
    send(channel: string, payload?: unknown): void;
    isLoadingMainFrame(): boolean;
    once(event: 'did-finish-load', fn: () => void): void;
  };
}

export interface ShellIpcDeps {
  getMainWindow(): ShellWindow | null;
  openAssistant(): void;
  showMainWindow(): void;
  /** Resolves the OS login-item state, or null when it cannot be read. */
  getLaunchAtLogin(): boolean | null;
  /** Applies and returns the OS login-item state, or null when it cannot. */
  setLaunchAtLogin(enabled: boolean): boolean | null;
}

export interface ShellIpc {
  register(ipcMain: {
    handle(channel: string, fn: (...args: any[]) => unknown): void;
  }): void;
  dispose(ipcMain: {
    removeHandler(channel: string): void;
  }): void;
  /** Raise the app and ask the main renderer to open settings once it can. */
  openSettings(): void;
}

export declare const SHELL_CHANNEL_PREFIX: string;
export declare function createShellIpc(deps: ShellIpcDeps): ShellIpc;
