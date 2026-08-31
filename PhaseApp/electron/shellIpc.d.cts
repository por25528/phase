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

/**
 * What the renderer says about the running session, once this module has
 * validated it. Structurally the `FocusStatusSnapshot` declared in
 * `src/lib/focusStatus.ts` — mirrored rather than imported, because the
 * process seam prevents sharing declarations across it (see busyBlocks.d.cts).
 */
export interface FocusStatus {
  phase: 'active' | 'break' | 'confirming';
  activeSinceMs: number | null;
  accumulatedMs: number;
  title: string;
}

export interface ShellIpcDeps {
  getMainWindow(): ShellWindow | null;
  openAssistant(): void;
  showMainWindow(): void;
  /** Resolves the OS login-item state, or null when it cannot be read. */
  getLaunchAtLogin(): boolean | null;
  /** Applies and returns the OS login-item state, or null when it cannot. */
  setLaunchAtLogin(enabled: boolean): boolean | null;
  /** A validated snapshot, or null for "no session". Never a malformed one. */
  onFocusStatus(status: FocusStatus | null): void;
  /** The Settings toggle for the floating pill, forwarded to the overlay window. */
  onOverlayEnabled(enabled: boolean): void;
}

export interface ShellIpc {
  register(ipcMain: {
    handle(channel: string, fn: (...args: any[]) => unknown): void;
    on(channel: string, fn: (...args: any[]) => unknown): void;
  }): void;
  dispose(ipcMain: {
    removeHandler(channel: string): void;
    removeAllListeners(channel: string): void;
  }): void;
  /** Raise the app and ask the main renderer to open settings once it can. */
  openSettings(): void;
  /** Ask the main renderer to act on the running session. False when it is gone. */
  sendFocusRequest(request: unknown): boolean;
}

export declare const SHELL_CHANNEL_PREFIX: string;
export declare const FOCUS_STATUS_CHANNEL: string;
export declare const FOCUS_REQUEST_CHANNEL: string;
export declare const OVERLAY_ENABLED_CHANNEL: string;
export declare function createShellIpc(deps: ShellIpcDeps): ShellIpc;
