// Deliberately imports nothing from src/ and nothing from `electron`: the
// process seam prevents sharing declarations across it (see shellIpc.d.cts),
// and every capability is injected.

import type { BackupStore } from './backupStore.cjs';

/** Loosely-typed window handle so this module never imports `electron`. */
export interface BackupWindow {
  isDestroyed(): boolean;
  webContents: { id: number };
}

export interface BackupIpcDeps {
  getMainWindow(): BackupWindow | null;
  store: BackupStore;
  logError(message: string, err: unknown): void;
}

export interface BackupIpc {
  register(ipcMain: {
    handle(channel: string, fn: (...args: any[]) => unknown): void;
  }): void;
  dispose(ipcMain: { removeHandler(channel: string): void }): void;
}

export declare const BACKUP_CHANNEL_PREFIX: string;
export declare const MAX_BACKUP_BYTES: number;
export declare function createBackupIpc(deps: BackupIpcDeps): BackupIpc;
