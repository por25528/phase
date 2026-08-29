import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAutoBackup, writeBackupNow, AUTO_BACKUP_QUIET_MS, AUTO_BACKUP_MIN_INTERVAL_MS,
  type AutoBackupDeps, type AutoBackup,
} from './autoBackup';
import type { WrittenBackup } from '../lib/backupBridge';

function entry(stamp: string): WrittenBackup {
  return { name: `phase-backup-${stamp}-auto.json`, stamp, reason: 'auto', bytes: 10, pruned: [] };
}

function harness(overrides: Partial<AutoBackupDeps> = {}) {
  let clock = 1_000_000;
  const write = vi.fn(async () => entry('20260830-142530'));
  const deps: AutoBackupDeps = {
    buildText: vi.fn(async () => '{"goals":[]}'),
    write,
    lastBackupAt: vi.fn(async () => null),
    now: () => clock,
    logError: vi.fn(),
    onOutcome: vi.fn(),
    ...overrides,
  };
  return {
    deps,
    write: deps.write as ReturnType<typeof vi.fn>,
    buildText: deps.buildText as ReturnType<typeof vi.fn>,
    onOutcome: deps.onOutcome as ReturnType<typeof vi.fn>,
    advance: (ms: number) => { clock += ms; },
    setClock: (ms: number) => { clock = ms; },
    at: () => clock,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Fake timers and an injected clock have to move TOGETHER: `advanceTimersByTime`
 * fires the callback, and `now()` is what the callback reads to decide whether
 * the interval has elapsed. Advancing one without the other tests a machine
 * that does not exist.
 */
async function tick(h: ReturnType<typeof harness>, ms: number) {
  h.advance(ms);
  await vi.advanceTimersByTimeAsync(ms);
}

describe('createAutoBackup', () => {
  it('writes nothing until something changes', async () => {
    const h = harness();
    const backup = createAutoBackup(h.deps);
    await backup.start();
    await tick(h, AUTO_BACKUP_MIN_INTERVAL_MS * 3);
    // A launch with no edit has nothing new to snapshot, and a folder full of
    // identical copies is a folder nobody can read.
    expect(h.write).not.toHaveBeenCalled();
  });

  it('writes once the quiet period passes after a change', async () => {
    const h = harness();
    const backup = createAutoBackup(h.deps);
    await backup.start();
    backup.schedule();
    await tick(h, AUTO_BACKUP_QUIET_MS - 1);
    expect(h.write).not.toHaveBeenCalled();
    await tick(h, 1);
    expect(h.write).toHaveBeenCalledWith('{"goals":[]}', 'auto');
  });

  it('coalesces a burst of changes into one snapshot', async () => {
    const h = harness();
    const backup = createAutoBackup(h.deps);
    await backup.start();
    for (let i = 0; i < 20; i += 1) {
      backup.schedule();
      await tick(h, 100);
    }
    await tick(h, AUTO_BACKUP_QUIET_MS);
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it('does not let a long session write a snapshot per minute', async () => {
    const h = harness();
    const backup = createAutoBackup(h.deps);
    await backup.start();
    backup.schedule();
    await tick(h, AUTO_BACKUP_QUIET_MS);
    expect(h.write).toHaveBeenCalledTimes(1);

    // Editing continuously for the next half hour: the second snapshot waits
    // for the interval, not for the quiet period.
    for (let elapsed = 0; elapsed < AUTO_BACKUP_MIN_INTERVAL_MS; elapsed += 60_000) {
      backup.schedule();
      await tick(h, 60_000);
    }
    expect(h.write).toHaveBeenCalledTimes(2);
  });

  it('starts the interval from the newest snapshot already on disk', async () => {
    const h = harness();
    const backup = createAutoBackup({
      ...h.deps,
      // Written five minutes ago, by the last time the app ran.
      lastBackupAt: async () => h.at() - 5 * 60_000,
    });
    await backup.start();
    backup.schedule();
    await tick(h, AUTO_BACKUP_QUIET_MS);
    // Still inside the interval that snapshot started, so nothing yet.
    expect(h.write).not.toHaveBeenCalled();
    await tick(h, AUTO_BACKUP_MIN_INTERVAL_MS - 5 * 60_000);
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it('treats an unreadable folder as "no snapshot yet" rather than a fresh one', async () => {
    const h = harness({ lastBackupAt: async () => null });
    const backup = createAutoBackup(h.deps);
    await backup.start();
    backup.schedule();
    await tick(h, AUTO_BACKUP_QUIET_MS);
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it('flushes on demand, whatever the interval says', async () => {
    const h = harness();
    const backup = createAutoBackup(h.deps);
    await backup.start();
    backup.schedule();
    await tick(h, AUTO_BACKUP_QUIET_MS);
    expect(h.write).toHaveBeenCalledTimes(1);

    const written = await backup.flush('manual');
    expect(h.write).toHaveBeenCalledTimes(2);
    expect(h.write).toHaveBeenLastCalledWith('{"goals":[]}', 'manual');
    expect(written?.stamp).toBe('20260830-142530');
  });

  it('a flush restarts the interval, so it cannot be doubled by a pending timer', async () => {
    const h = harness();
    const backup = createAutoBackup(h.deps);
    await backup.start();
    backup.schedule();
    await backup.flush('pre-import');
    expect(h.write).toHaveBeenCalledTimes(1);
    // The armed timer was cancelled by the flush, not left to fire behind it.
    await tick(h, AUTO_BACKUP_MIN_INTERVAL_MS);
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it('builds the text at WRITE time, never when the write was scheduled', async () => {
    const h = harness();
    const backup = createAutoBackup(h.deps);
    await backup.start();
    backup.schedule();
    expect(h.buildText).not.toHaveBeenCalled();
    await tick(h, AUTO_BACKUP_QUIET_MS);
    // The whole point of coalescing a burst is that the file states where the
    // burst ENDED — the same rule the sync exporter follows.
    expect(h.buildText).toHaveBeenCalledTimes(1);
  });

  it('reports a refused write and lets the next change try again', async () => {
    const write = vi.fn(async () => null);
    const logError = vi.fn();
    const h = harness({ write, logError });
    const backup = createAutoBackup(h.deps);
    await backup.start();
    backup.schedule();
    await tick(h, AUTO_BACKUP_QUIET_MS);
    expect(write).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalled();

    // A refusal must not bank an interval it never earned: the retry waits for
    // the quiet period, not for half an hour of a snapshot that does not exist.
    backup.schedule();
    await tick(h, AUTO_BACKUP_QUIET_MS);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('swallows a thrown build and stays armed', async () => {
    const buildText = vi.fn(async () => { throw new Error('IndexedDB gone'); });
    const logError = vi.fn();
    const h = harness({ buildText, logError });
    const backup = createAutoBackup(h.deps);
    await backup.start();
    backup.schedule();
    await tick(h, AUTO_BACKUP_QUIET_MS);
    expect(h.write).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalled();
    // And a flush over the same failure resolves null rather than rejecting.
    await expect(backup.flush('manual')).resolves.toBeNull();
  });

  /**
   * `start()` is ASYNC — it asks the disk when the last snapshot was — and a
   * change can land while that read is still in flight. Arming against a
   * not-yet-known mark makes `since` Infinity, which collapses the wait to the
   * quiet period and writes a second snapshot a minute after the one already
   * on disk, silently bypassing the interval on every launch that begins with
   * an edit. So a schedule that arrives early WAITS for the answer.
   */
  describe('a change during the disk read', () => {
    function deferredStart() {
      let release: (at: number | null) => void = () => {};
      const lastBackupAt = vi.fn(() => new Promise<number | null>((r) => { release = r; }));
      return { lastBackupAt, release: (at: number | null) => release(at) };
    }

    it('cannot bypass the interval floor by racing the read', async () => {
      const gate = deferredStart();
      const h = harness({ lastBackupAt: gate.lastBackupAt });
      const backup = createAutoBackup(h.deps);
      const started = backup.start();

      // An edit lands before the disk has answered.
      backup.schedule();
      await tick(h, AUTO_BACKUP_QUIET_MS * 2);
      expect(h.write).not.toHaveBeenCalled();

      // The disk says: five minutes ago.
      gate.release(h.at() - 5 * 60_000);
      await started;

      // The wait now runs from that mark, not from a blank one.
      await tick(h, AUTO_BACKUP_QUIET_MS);
      expect(h.write).not.toHaveBeenCalled();
      await tick(h, AUTO_BACKUP_MIN_INTERVAL_MS - 5 * 60_000);
      expect(h.write).toHaveBeenCalledTimes(1);
    });

    it('still honours the change once the read comes back empty', async () => {
      const gate = deferredStart();
      const h = harness({ lastBackupAt: gate.lastBackupAt });
      const backup = createAutoBackup(h.deps);
      const started = backup.start();

      backup.schedule();
      gate.release(null);
      await started;
      // Deferred, never dropped: the edit that arrived early still gets its
      // snapshot, one quiet period after the answer.
      await tick(h, AUTO_BACKUP_QUIET_MS);
      expect(h.write).toHaveBeenCalledTimes(1);
    });

    it('does not lower the floor a flush already raised', async () => {
      const gate = deferredStart();
      const h = harness({ lastBackupAt: gate.lastBackupAt });
      const backup = createAutoBackup(h.deps);
      const started = backup.start();

      // A manual snapshot lands while the disk read is still out.
      await backup.flush('manual');
      expect(h.write).toHaveBeenCalledTimes(1);

      // The disk then reports an OLDER stamp. Adopting it would move the mark
      // backwards and let the next change write half an hour early.
      gate.release(h.at() - AUTO_BACKUP_MIN_INTERVAL_MS);
      await started;

      backup.schedule();
      await tick(h, AUTO_BACKUP_QUIET_MS);
      expect(h.write).toHaveBeenCalledTimes(1);
      await tick(h, AUTO_BACKUP_MIN_INTERVAL_MS);
      expect(h.write).toHaveBeenCalledTimes(2);
    });

    /**
     * `flush()` cancels a pending TIMER so a manual snapshot is not chased by
     * an automatic one writing the same state — but before `start()` resolves
     * a held request is not a timer, it is `armWhenReady`, and cancelling one
     * representation while leaving the other means the edit gets snapshotted
     * twice: once by the flush that already captured it, and again when
     * `start()` lands and arms the request nobody withdrew.
     */
    it('a flush clears a deferred arm too, not just a pending timer', async () => {
      const gate = deferredStart();
      const h = harness({ lastBackupAt: gate.lastBackupAt });
      const backup = createAutoBackup(h.deps);
      const started = backup.start();

      // An edit lands while the disk read is still out, then a manual snapshot
      // captures the very state that edit produced.
      backup.schedule();
      await backup.flush('manual');
      expect(h.write).toHaveBeenCalledTimes(1);

      gate.release(h.at() - 5 * 60_000);
      await started;

      // The held request is already satisfied. Anything further would be a
      // duplicate of state nobody edited — the same waste `cancel()` exists to
      // prevent in the non-racing case.
      await tick(h, AUTO_BACKUP_MIN_INTERVAL_MS * 2);
      expect(h.write).toHaveBeenCalledTimes(1);
    });

    it('still serves an edit that arrives after the flush', async () => {
      const gate = deferredStart();
      const h = harness({ lastBackupAt: gate.lastBackupAt });
      const backup = createAutoBackup(h.deps);
      const started = backup.start();

      backup.schedule();
      await backup.flush('manual');
      gate.release(null);
      await started;

      // Clearing the held request must not deafen the scheduler: a REAL edit
      // after the flush is new work, and it still gets its snapshot once the
      // interval the flush started has run out.
      backup.schedule();
      await tick(h, AUTO_BACKUP_MIN_INTERVAL_MS);
      expect(h.write).toHaveBeenCalledTimes(2);
    });

    it('drops a deferred arm when the scheduler stopped before the read landed', async () => {
      const gate = deferredStart();
      const h = harness({ lastBackupAt: gate.lastBackupAt });
      const backup = createAutoBackup(h.deps);
      const started = backup.start();

      backup.schedule();
      backup.stop();
      gate.release(null);
      await started;
      await tick(h, AUTO_BACKUP_MIN_INTERVAL_MS * 2);
      expect(h.write).not.toHaveBeenCalled();
    });

    it('treats a rejected read as unknown and still serves the early change', async () => {
      const h = harness({ lastBackupAt: vi.fn(async () => { throw new Error('EACCES'); }) });
      const backup = createAutoBackup(h.deps);
      const started = backup.start();
      backup.schedule();
      await started;
      await tick(h, AUTO_BACKUP_QUIET_MS);
      expect(h.write).toHaveBeenCalledTimes(1);
    });
  });

  it('stops cleanly — a pending snapshot never fires after teardown', async () => {
    const h = harness();
    const backup = createAutoBackup(h.deps);
    await backup.start();
    backup.schedule();
    backup.stop();
    await tick(h, AUTO_BACKUP_MIN_INTERVAL_MS * 2);
    expect(h.write).not.toHaveBeenCalled();
  });

  it('ignores a schedule that arrives after stop', async () => {
    const h = harness();
    const backup = createAutoBackup(h.deps);
    await backup.start();
    backup.stop();
    backup.schedule();
    await tick(h, AUTO_BACKUP_MIN_INTERVAL_MS * 2);
    expect(h.write).not.toHaveBeenCalled();
  });
});

/**
 * Who is allowed to write a snapshot, and through what.
 *
 * Phase assumes a SINGLE WRITER: a second window's in-memory state is a stale
 * view of the owner's database, and `persist` is gated on the lock for exactly
 * that reason. A backup is the same write wearing a different name — worse,
 * really, because it is the copy someone would later restore FROM. A second
 * window pressing "Back up now" would have written that stale view to disk and
 * called it a rescue.
 *
 * The three answers are distinct on purpose. `not-owner` is not a failure to
 * fix, it is a different window's turn, and a surface that reported it as
 * "couldn't save to this Mac" would send someone hunting a disk problem that
 * does not exist.
 */
describe('writeBackupNow', () => {
  function deps(overrides: Partial<Parameters<typeof writeBackupNow>[1]> = {}) {
    return {
      ownsLock: () => true,
      scheduler: () => null as AutoBackup | null,
      buildText: vi.fn(async () => '{"goals":[]}'),
      write: vi.fn(async () => entry('20260830-142530')),
      ...overrides,
    };
  }

  it('refuses outright in a window that does not own the data', async () => {
    const d = deps({ ownsLock: () => false });
    await expect(writeBackupNow('manual', d)).resolves.toBe('not-owner');
    // Nothing was read and nothing was written — a stale snapshot is worse
    // than no snapshot, because it is the one someone would restore from.
    expect(d.buildText).not.toHaveBeenCalled();
    expect(d.write).not.toHaveBeenCalled();
  });

  it('refuses a pre-import snapshot from a non-owner too', async () => {
    const d = deps({ ownsLock: () => false });
    await expect(writeBackupNow('pre-import', d)).resolves.toBe('not-owner');
    expect(d.write).not.toHaveBeenCalled();
  });

  it('goes through the scheduler when there is one, so the interval restarts', async () => {
    const flush = vi.fn(async () => entry('20260830-142530'));
    const scheduler = { flush } as unknown as AutoBackup;
    const d = deps({ scheduler: () => scheduler });
    await expect(writeBackupNow('manual', d)).resolves.toBe('saved');
    expect(flush).toHaveBeenCalledWith('manual');
    // Writing past the scheduler would leave the automatic pass believing
    // nothing had been saved, and land a duplicate a minute later.
    expect(d.write).not.toHaveBeenCalled();
  });

  it('falls back to a direct write before the scheduler exists', async () => {
    const d = deps();
    await expect(writeBackupNow('manual', d)).resolves.toBe('saved');
    expect(d.write).toHaveBeenCalledWith('{"goals":[]}', 'manual');
  });

  it('reports a refused write as failed, not as a missing turn', async () => {
    const d = deps({ write: vi.fn(async () => null) });
    await expect(writeBackupNow('manual', d)).resolves.toBe('failed');
  });

  it('reports a scheduler refusal as failed', async () => {
    const scheduler = { flush: vi.fn(async () => null) } as unknown as AutoBackup;
    await expect(writeBackupNow('manual', deps({ scheduler: () => scheduler }))).resolves.toBe('failed');
  });

  it('reports an unreadable database as failed rather than throwing at the caller', async () => {
    const d = deps({ buildText: vi.fn(async () => { throw new Error('IndexedDB gone'); }) });
    await expect(writeBackupNow('manual', d)).resolves.toBe('failed');
  });
});

/**
 * A scheduler that fails writes forever used to say so on `console.warn` and
 * nowhere else. Backups Settings went on describing versioned copies being
 * kept, and the one moment the promise mattered — a database that would not
 * open — is the moment it turned out none had been taken for a month.
 *
 * `onOutcome` is what makes the failure REPORTABLE. It is a bare boolean and
 * not a message: the words belong to the surface that renders them, and the
 * scheduler's job is to say whether the last attempt landed.
 */
describe('reporting whether the scheduler is actually working', () => {
  it('reports a landed automatic snapshot', async () => {
    const h = harness();
    const b = createAutoBackup(h.deps);
    await b.start();
    b.schedule();
    h.advance(AUTO_BACKUP_QUIET_MS);
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_QUIET_MS);
    expect(h.onOutcome).toHaveBeenLastCalledWith(true);
  });

  it('reports a refused write, which nothing else would surface', async () => {
    const h = harness({ write: vi.fn(async () => null) });
    const b = createAutoBackup(h.deps);
    await b.start();
    b.schedule();
    h.advance(AUTO_BACKUP_QUIET_MS);
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_QUIET_MS);
    expect(h.onOutcome).toHaveBeenLastCalledWith(false);
  });

  it('reports a snapshot it could not even build', async () => {
    const h = harness({ buildText: vi.fn(async () => { throw new Error('IndexedDB gone'); }) });
    const b = createAutoBackup(h.deps);
    await b.start();
    b.schedule();
    h.advance(AUTO_BACKUP_QUIET_MS);
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_QUIET_MS);
    expect(h.onOutcome).toHaveBeenLastCalledWith(false);
  });

  it('reports recovery, so a fixed disk clears the warning', async () => {
    let ok = false;
    const h = harness({ write: vi.fn(async () => (ok ? entry('20260830-142530') : null)) });
    const b = createAutoBackup(h.deps);
    await b.start();

    b.schedule();
    h.advance(AUTO_BACKUP_QUIET_MS);
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_QUIET_MS);
    expect(h.onOutcome).toHaveBeenLastCalledWith(false);

    ok = true;
    await b.flush('manual');
    expect(h.onOutcome).toHaveBeenLastCalledWith(true);
  });

  it('reports a manual flush too — a working folder is a working folder', async () => {
    const h = harness({ write: vi.fn(async () => null) });
    const b = createAutoBackup(h.deps);
    await b.start();
    await b.flush('manual');
    expect(h.onOutcome).toHaveBeenLastCalledWith(false);
  });

  it('still logs, because the console is where a developer looks', async () => {
    const logError = vi.fn();
    const h = harness({ write: vi.fn(async () => null), logError });
    const b = createAutoBackup(h.deps);
    await b.start();
    await b.flush('manual');
    expect(logError).toHaveBeenCalled();
  });
});
