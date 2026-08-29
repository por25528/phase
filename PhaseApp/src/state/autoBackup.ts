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
  /**
   * Learn when the last snapshot was, so the interval survives a restart.
   *
   * A `schedule()` that arrives before this resolves is DEFERRED, never
   * dropped and never armed early — see the note on the race below.
   */
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
  /*
   * The two flags that close the start-up race.
   *
   * `start()` is ASYNC — it asks the disk when the last snapshot was — and the
   * first change of a session routinely lands while that read is in flight.
   * Arming then would measure `since` against a mark of `null`, i.e. Infinity,
   * collapse the wait to the quiet period, and write a second snapshot a
   * minute after the one already on disk. That is not a rare interleaving: it
   * is every launch that begins with an edit, and it would quietly defeat the
   * interval it looks like it is honouring.
   *
   * So an early schedule is DEFERRED rather than dropped — the edit is real
   * and still deserves its snapshot — and `start()` arms it once the mark is
   * known.
   */
  let ready = false;
  let armWhenReady = false;

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
      let fromDisk: number | null = null;
      try {
        fromDisk = await deps.lastBackupAt();
      } catch {
        // Unknown is not "just now": leaving the mark null makes the first
        // change due after the quiet period, which is the safe direction.
        fromDisk = null;
      }
      // Only adopt the disk's answer if nothing has been written since this
      // scheduler was built. A flush that landed during the read is NEWER than
      // anything the disk could have been describing, and taking the older
      // stamp would move the mark backwards — lowering the very floor the
      // write just raised.
      if (lastWriteAt === null) lastWriteAt = fromDisk;
      ready = true;
      if (armWhenReady) {
        armWhenReady = false;
        arm();
      }
    },

    schedule() {
      if (stopped) return;
      // Held, not armed: `arm()` cannot price the wait until the mark is known.
      if (!ready) {
        armWhenReady = true;
        return;
      }
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
      armWhenReady = false;
      cancel();
    },
  };
}

/** What a snapshot taken on demand did. Three answers, because there are three. */
export type BackupNowResult = 'saved' | 'failed' | 'not-owner';

export interface ManualBackupDeps {
  /** Whether this window holds the single-writer lock. */
  ownsLock(): boolean;
  /** The live scheduler, or null before the effect that builds it has run. */
  scheduler(): AutoBackup | null;
  buildText(): Promise<string>;
  write(text: string, reason: BackupReason): Promise<WrittenBackup | null>;
}

/**
 * A snapshot taken on demand — the Settings button, and the one before an
 * import.
 *
 * The LOCK GATE is the whole reason this is a function rather than two lines at
 * the call site. Phase assumes a single writer: a second window's in-memory
 * state is a stale view of the owner's database, which is why `persist` and
 * every settings write are gated on the lock. A backup is that same write
 * wearing a different name, and worse — it is the copy someone would later
 * restore FROM, so a stale one does not merely waste a file, it launders a
 * stale view into the thing you reach for when everything else has failed. It
 * refuses BEFORE building the text, because reading the store to write it is
 * already the wrong act.
 *
 * `not-owner` is deliberately not `failed`. It is not a disk problem and there
 * is nothing to fix; reporting it as one would send someone hunting free space
 * over another window being open.
 *
 * The write goes through the SCHEDULER whenever there is one, so a snapshot
 * taken by hand restarts the interval. Writing past it would leave the
 * automatic pass believing nothing had been saved, and land a duplicate a
 * minute later. The direct write is the fallback for the window before the
 * scheduler exists, and it spends the same builder, so the two paths cannot
 * produce different files.
 */
export async function writeBackupNow(
  reason: Extract<BackupReason, 'manual' | 'pre-import'>,
  deps: ManualBackupDeps,
): Promise<BackupNowResult> {
  if (!deps.ownsLock()) return 'not-owner';
  const scheduler = deps.scheduler();
  if (scheduler) return (await scheduler.flush(reason)) !== null ? 'saved' : 'failed';
  try {
    return (await deps.write(await deps.buildText(), reason)) !== null ? 'saved' : 'failed';
  } catch {
    // The database is what a backup reads. If it cannot be read there is
    // nothing to write, and the caller needs an answer rather than a rejection.
    return 'failed';
  }
}
