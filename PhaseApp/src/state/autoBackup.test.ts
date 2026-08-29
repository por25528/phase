import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createAutoBackup, AUTO_BACKUP_QUIET_MS, AUTO_BACKUP_MIN_INTERVAL_MS, type AutoBackupDeps,
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
    ...overrides,
  };
  return {
    deps,
    write: deps.write as ReturnType<typeof vi.fn>,
    buildText: deps.buildText as ReturnType<typeof vi.fn>,
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
