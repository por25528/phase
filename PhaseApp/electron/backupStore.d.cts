// Imports nothing from src/ and nothing from `electron`: the process seam
// prevents sharing declarations across it, exactly as syncFiles.d.cts says.

export type BackupReason = 'auto' | 'manual' | 'pre-import';

export interface BackupEntry {
  /** `phase-backup-<YYYYMMDD>-<HHmmss>-<reason>.json`. The whole record. */
  name: string;
  /** `<YYYYMMDD>-<HHmmss>`, in the LOCAL time the snapshot was taken. */
  stamp: string;
  reason: BackupReason;
  /** Size on disk. 0 when the file vanished between readdir and stat. */
  bytes: number;
}

export interface WrittenBackup extends BackupEntry {
  /** Names dropped by the retention pass this write triggered. */
  pruned: string[];
}

export interface BackupStoreOptions {
  /** Where snapshots land. The caller owns the path; this module never guesses. */
  dir: string;
  /** Injected so a test can assert the stamp rather than tolerate it. */
  now?(): Date;
}

export interface BackupStore {
  readonly dir: string;
  /** Newest first. Empty — never a throw — for an absent or unreadable folder. */
  list(): BackupEntry[];
  /** Writes atomically, then prunes. Throws only if the snapshot itself failed. */
  write(text: string, reason: BackupReason): WrittenBackup;
  /** `null` for a refused name, an absent file, or an unreadable one. */
  read(name: string): string | null;
}

/** True only for names this module writes — the one gate on a caller's string. */
export declare function isBackupName(name: string): boolean;

export declare const BACKUP_REASONS: readonly BackupReason[];

/** Pure. Exported so the policy is asserted directly, not inferred from a folder. */
export declare function planRetention(
  entries: readonly { name: string; stamp: string; reason: string }[],
  now: Date,
): { keep: string[]; drop: string[] };

export declare function createBackupStore(opts: BackupStoreOptions): BackupStore;
