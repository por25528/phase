import type { BackupReason, WrittenBackup } from '../lib/backupBridge';

/**
 * When Phase takes a snapshot of itself, and how often it is allowed to.
 *
 * The database is the live record and a backup is the second copy, so the
 * scheduling question is not "how fresh" but "how many files is a person
 * willing to look at". Two rules answer it, and they pull in opposite
 * directions on purpose:
 *
 *   - a QUIET PERIOD, so a burst of edits becomes one snapshot rather than
 *     forty. This is the sync exporter's debounce, stretched from seconds to a
 *     minute because nothing is waiting to read the file.
 *   - a MINIMUM INTERVAL, so a session spent editing for three hours writes
 *     six snapshots and not one hundred and eighty.
 *
 * A change arms the timer; further changes DO NOT reset it. That is the
 * difference from a plain debounce, and it is the whole point: a debounce
 * writes nothing at all while someone is working, which is exactly when the
 * work is worth keeping.
 *
 * There is deliberately no snapshot at launch. A launch that changes nothing
 * has nothing new to record, and a folder of identical copies is a folder
 * nobody can read — the launch's only job is to learn when the LAST snapshot
 * was, so the interval carries across restarts.
 *
 * Nothing here decides what a backup contains: `buildText` is
 * `buildBackupText` in db.ts, the same one derivation the Export menu item and
 * the fatal error screen spend.
 */

export interface AutoBackupDeps {
  /** The backup document, read at WRITE time — never captured when scheduled. */
  buildText(): Promise<string>;
  /** Null when the shell refused or the disk did. Never throws. */
  write(text: string, reason: BackupReason): Promise<WrittenBackup | null>;
  /** When the newest snapshot on disk was taken, or null when there is none. */
  lastBackupAt(): Promise<number | null>;
  now(): number;
  logError(message: string, err?: unknown): void;
}

export interface AutoBackup {
  /** Learn when the last snapshot was, so the interval survives a restart. */
  start(): Promise<void>;
  /** A change landed. Arms the next snapshot; does not reset a pending one. */
  schedule(): void;
  /** Snapshot now, whatever the interval says. Resolves null when it failed. */
  flush(reason: BackupReason): Promise<WrittenBackup | null>;
  stop(): void;
}

/** A burst of edits becomes one snapshot. */
export const AUTO_BACKUP_QUIET_MS = 60_000;
/** …and a long session cannot write more often than this. */
export const AUTO_BACKUP_MIN_INTERVAL_MS = 30 * 60_000;

export function createAutoBackup(deps: AutoBackupDeps): AutoBackup {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastWriteAt: number | null = null;
  let stopped = false;

  const cancel = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  async function write(reason: BackupReason): Promise<WrittenBackup | null> {
    let text: string;
    try {
      text = await deps.buildText();
    } catch (err) {
      // The database is the thing a backup reads. If it cannot be read there is
      // nothing to write, and the next change tries again — banking an interval
      // here would silence the retry for half an hour.
      deps.logError('[backup] could not build a snapshot', err);
      return null;
    }
    const written = await deps.write(text, reason);
    if (!written) {
      deps.logError('[backup] the snapshot was refused');
      return null;
    }
    // Only a snapshot that LANDED starts the interval — the same rule the sync
    // exporter follows for its generation number.
    lastWriteAt = deps.now();
    return written;
  }

  function arm() {
    if (stopped || timer !== null) return;
    const since = lastWriteAt === null ? Infinity : deps.now() - lastWriteAt;
    const wait = Math.max(AUTO_BACKUP_QUIET_MS, AUTO_BACKUP_MIN_INTERVAL_MS - since);
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      void write('auto');
    }, wait);
  }

  return {
    async start() {
      try {
        lastWriteAt = await deps.lastBackupAt();
      } catch {
        // Unknown is not "just now": leaving the mark null makes the first
        // change due after the quiet period, which is the safe direction.
        lastWriteAt = null;
      }
    },

    schedule() {
      arm();
    },

    async flush(reason) {
      if (stopped) return null;
      // Cancel first: a pending automatic snapshot behind a manual one would
      // write the same state twice for no reason.
      cancel();
      return write(reason);
    },

    stop() {
      stopped = true;
      cancel();
    },
  };
}
