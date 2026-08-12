// Deliberately imports nothing from src/: the process seam prevents sharing
// declarations across it (see busyBlocks.d.cts). The snapshot is validated
// structurally at runtime, so its static face here is the minimal truth.
export interface AssistantSnapshotLike {
  status: 'loading' | 'ready';
}

/** Loosely-typed window handle so this module never imports `electron`. */
export interface RelayWindow {
  isDestroyed(): boolean;
  webContents: { id: number; send(channel: string, payload?: unknown): void };
}

import type { ShortcutStatus } from './assistantShortcut.d.cts';

export interface AssistantIpcDeps {
  getMainWindow(): RelayWindow | null;
  getAssistantWindow(): RelayWindow | null;
  hideAssistant(): void;
  /** Absent when no global shortcut exists (tests, non-desktop builds). */
  setShortcut?(accelerator: string): ShortcutStatus;
}

export interface AssistantIpc {
  register(ipcMain: {
    on(channel: string, fn: (...args: any[]) => unknown): void;
    handle(channel: string, fn: (...args: any[]) => unknown): void;
  }): void;
  dispose(ipcMain: {
    removeAllListeners(channel: string): void;
    removeHandler(channel: string): void;
  }): void;
  requestSnapshot(): void;
  latest(): AssistantSnapshotLike | null;
}

export declare const ASSISTANT_CHANNEL_PREFIX: string;
export declare function createAssistantIpc(deps: AssistantIpcDeps): AssistantIpc;
