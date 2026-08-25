// Imports nothing from src/ and nothing from `electron`: the process seam
// prevents sharing declarations across it, exactly as agentIpc.d.cts says.

export interface SyncFilesOptions {
  /** Overrides `PHASE_SYNC_DIR` and the plain-iCloud default. Tests pass one. */
  dir?: string;
  /** How often the journal is stat'ed. Default 5000ms. */
  pollMs?: number;
}

export interface SyncFiles {
  /** Where sync is pointed, resolved once at construction. */
  readonly dir: string;
  /**
   * Creates the container directory, reads an existing journal once, then
   * polls for changes. The callback receives the WHOLE journal text — the
   * ingester decides which lines are new, from its own high-water mark.
   */
  start(onJournalChange: (text: string) => void): void;
  /** `null` when the journal is absent or unreadable. Never throws. */
  readJournal(): string | null;
  /** Atomic: writes a sibling temp file and renames it over `state.json`. */
  writeState(text: string): void;
  stop(): void;
}

export declare const STATE_FILE: string;
export declare const JOURNAL_FILE: string;
export declare function createSyncFiles(opts?: SyncFilesOptions): SyncFiles;
