import { describe, it, expect, vi, afterEach } from 'vitest';
import { backupBridge, describeBackup, backupReasonLabel, stampToLocalMs } from './backupBridge';

function installPreload(preload: unknown) {
  (globalThis as unknown as Record<string, unknown>).window = { phaseBackups: preload };
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).window;
});

describe('backupBridge', () => {
  it('is unavailable and inert in the plain browser', async () => {
    delete (globalThis as unknown as Record<string, unknown>).window;
    const bridge = backupBridge();
    expect(bridge.available).toBe(false);
    // Every verb answers the shape a caller expects — never a throw, and never
    // a promise that pretends a snapshot landed.
    await expect(bridge.list()).resolves.toEqual([]);
    await expect(bridge.write('{}', 'auto')).resolves.toBeNull();
    await expect(bridge.read('phase-backup-20260830-142530-auto.json')).resolves.toBeNull();
  });

  it('is unavailable when the window exists but the preload does not', async () => {
    (globalThis as unknown as Record<string, unknown>).window = {};
    expect(backupBridge().available).toBe(false);
  });

  it('passes the three verbs through when the preload is there', async () => {
    const entry = {
      name: 'phase-backup-20260830-142530-auto.json',
      stamp: '20260830-142530', reason: 'auto' as const, bytes: 12,
    };
    const preload = {
      list: vi.fn(async () => [entry]),
      write: vi.fn(async () => ({ ...entry, pruned: [] })),
      read: vi.fn(async () => '{"goals":[]}'),
    };
    installPreload(preload);
    const bridge = backupBridge();
    expect(bridge.available).toBe(true);
    await expect(bridge.list()).resolves.toEqual([entry]);
    await expect(bridge.write('{"goals":[]}', 'manual')).resolves.toEqual({ ...entry, pruned: [] });
    await expect(bridge.read(entry.name)).resolves.toBe('{"goals":[]}');
    expect(preload.write).toHaveBeenCalledWith('{"goals":[]}', 'manual');
  });

  it('degrades a rejected call rather than letting it escape', async () => {
    installPreload({
      list: vi.fn(async () => { throw new Error('EACCES'); }),
      write: vi.fn(async () => { throw new Error('ENOSPC'); }),
      read: vi.fn(async () => { throw new Error('EIO'); }),
    });
    const bridge = backupBridge();
    // A backup folder that cannot be reached is a fact to report, not an
    // unhandled rejection in the middle of an ordinary edit.
    await expect(bridge.list()).resolves.toEqual([]);
    await expect(bridge.write('{}', 'auto')).resolves.toBeNull();
    await expect(bridge.read('phase-backup-20260830-142530-auto.json')).resolves.toBeNull();
  });

  it('drops a listed row that is not shaped like a backup entry', async () => {
    installPreload({
      list: vi.fn(async () => [
        { name: 'phase-backup-20260830-142530-auto.json', stamp: '20260830-142530', reason: 'auto', bytes: 12 },
        { name: 'nope' },
        null,
        'phase-backup-20260830-142530-auto.json',
      ]),
      write: vi.fn(),
      read: vi.fn(),
    });
    const listed = await backupBridge().list();
    expect(listed.map((e) => e.name)).toEqual(['phase-backup-20260830-142530-auto.json']);
  });
});

describe('describeBackup', () => {
  it('reads the stamp back as a date and a time', () => {
    expect(describeBackup('20260830-142530')).toBe('30 Aug 2026, 14:25');
  });

  it('states the stamp verbatim rather than guessing at a malformed one', () => {
    expect(describeBackup('nonsense')).toBe('nonsense');
    expect(describeBackup('')).toBe('');
  });
});

describe('stampToLocalMs', () => {
  it('round-trips a stamp through the local clock it was written from', () => {
    expect(stampToLocalMs('20260830-142530')).toBe(new Date(2026, 7, 30, 14, 25, 30).getTime());
  });

  it('answers null for a malformed stamp rather than a plausible instant', () => {
    // "Unknown" and "just now" lead to opposite decisions about whether a
    // snapshot is due, so this must never fall back to a Date.
    expect(stampToLocalMs('nonsense')).toBeNull();
    expect(stampToLocalMs('2026083-142530')).toBeNull();
    expect(stampToLocalMs('')).toBeNull();
  });
});

describe('backupReasonLabel', () => {
  it('names why each snapshot was taken', () => {
    expect(backupReasonLabel('auto')).toBe('Automatic');
    expect(backupReasonLabel('manual')).toBe('Manual');
    // The one that matters: this is the state the irreversible action replaced.
    expect(backupReasonLabel('pre-import')).toBe('Before import');
  });
});
