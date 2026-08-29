import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const nativeRequire = createRequire(import.meta.url);
const { createBackupStore, planRetention, BACKUP_REASONS, isBackupName } =
  nativeRequire('./backupStore.cjs') as typeof import('./backupStore.cjs');

let dir: string;
let clock: Date;

function open() {
  return createBackupStore({ dir, now: () => clock });
}

/** A local-time Date, which is what the stamp is written from. */
function at(y: number, m: number, d: number, h = 12, min = 0, s = 0): Date {
  return new Date(y, m - 1, d, h, min, s);
}

beforeEach(() => {
  dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'phase-backups-')), 'Backups');
  clock = at(2026, 8, 30, 14, 25, 30);
});

afterEach(() => {
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

describe('createBackupStore', () => {
  it('creates the directory lazily, on the first write and not before', () => {
    const store = open();
    expect(fs.existsSync(dir)).toBe(false);
    store.write('{"goals":[]}', 'auto');
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('names the file from the local stamp and the reason', () => {
    const written = open().write('{"goals":[]}', 'auto');
    expect(written.name).toBe('phase-backup-20260830-142530-auto.json');
    expect(written.stamp).toBe('20260830-142530');
    expect(written.reason).toBe('auto');
    expect(written.bytes).toBe(Buffer.byteLength('{"goals":[]}'));
  });

  it('writes atomically — no temp file survives beside the backup', () => {
    const store = open();
    const { name } = store.write('{"a":1}', 'manual');
    expect(fs.readFileSync(path.join(dir, name), 'utf8')).toBe('{"a":1}');
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('never overwrites a backup written in the same second', () => {
    const store = open();
    const first = store.write('{"a":1}', 'auto');
    const second = store.write('{"b":2}', 'auto');
    expect(second.name).not.toBe(first.name);
    // Both survive, and both hold what they were given.
    expect(fs.readFileSync(path.join(dir, first.name), 'utf8')).toBe('{"a":1}');
    expect(fs.readFileSync(path.join(dir, second.name), 'utf8')).toBe('{"b":2}');
  });

  it('lists newest first and ignores anything that is not a backup', () => {
    const store = open();
    clock = at(2026, 8, 28, 9, 0, 0);
    store.write('{"a":1}', 'auto');
    clock = at(2026, 8, 30, 9, 0, 0);
    store.write('{"b":2}', 'manual');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
    fs.writeFileSync(path.join(dir, 'phase-backup-nonsense.json'), '{}');

    const listed = store.list();
    expect(listed.map((e) => e.stamp)).toEqual(['20260830-090000', '20260828-090000']);
    expect(listed.map((e) => e.reason)).toEqual(['manual', 'auto']);
  });

  it('lists nothing rather than throwing when the folder does not exist', () => {
    expect(open().list()).toEqual([]);
  });

  it('reads a backup back by name', () => {
    const store = open();
    const { name } = store.write('{"a":1}', 'manual');
    expect(store.read(name)).toBe('{"a":1}');
  });

  it('refuses to read anything that is not a backup file name', () => {
    const store = open();
    store.write('{"a":1}', 'manual');
    fs.writeFileSync(path.join(path.dirname(dir), 'secret.json'), 'private');
    // Traversal, absolute paths, and plausible-looking neighbours are all refused
    // by the SAME rule: the name has to match the one pattern this store writes.
    expect(store.read('../secret.json')).toBeNull();
    expect(store.read('/etc/passwd')).toBeNull();
    expect(store.read('phase-backup-20260830-142530-auto.json.bak')).toBeNull();
    expect(store.read('notes.txt')).toBeNull();
  });

  it('reads null for a well-formed name that is not on disk', () => {
    expect(open().read('phase-backup-20260101-000000-auto.json')).toBeNull();
  });

  it('refuses an unknown reason rather than inventing a file name', () => {
    // @ts-expect-error — the point of the test is the runtime refusal.
    expect(() => open().write('{}', 'whatever')).toThrow();
  });

  it('prunes as it writes, and reports what each write dropped', () => {
    const store = open();
    const pruned: string[] = [];
    // Two a day for a month: far past every tier's per-bucket allowance.
    for (let day = 1; day <= 30; day += 1) {
      for (const hour of [9, 17]) {
        clock = at(2026, 6, day, hour, 0, 0);
        pruned.push(...store.write('{"a":1}', 'auto').pruned);
      }
    }
    expect(pruned.length).toBeGreaterThan(0);

    const remaining = store.list().map((e) => e.name);
    expect(remaining.length).toBeLessThan(60);
    // Nothing a write claimed to prune is still listed…
    for (const dropped of pruned) expect(remaining).not.toContain(dropped);
    // …and nothing it claimed to keep is missing from disk.
    for (const name of remaining) expect(fs.existsSync(path.join(dir, name))).toBe(true);
    // The most recent snapshot is never the one pruning takes.
    expect(remaining[0]).toBe('phase-backup-20260630-170000-auto.json');
  });
});

describe('BACKUP_REASONS', () => {
  it('is the closed vocabulary the file name is built from', () => {
    expect([...BACKUP_REASONS].sort()).toEqual(['auto', 'manual', 'pre-import']);
  });
});

describe('isBackupName', () => {
  it('accepts exactly the names the store writes', () => {
    expect(isBackupName('phase-backup-20260830-142530-auto.json')).toBe(true);
    expect(isBackupName('phase-backup-20260830-142530-pre-import.json')).toBe(true);
    expect(isBackupName('phase-backup-20260830-142530-manual.json')).toBe(true);
  });

  it('rejects everything else, including near-misses', () => {
    expect(isBackupName('phase-backup-20260830-142530-auto.json ')).toBe(false);
    expect(isBackupName('phase-backup-2026083-142530-auto.json')).toBe(false);
    expect(isBackupName('../phase-backup-20260830-142530-auto.json')).toBe(false);
    expect(isBackupName('phase-backup-20260830-142530-restore.json')).toBe(false);
    expect(isBackupName('')).toBe(false);
    // @ts-expect-error — a non-string must be refused, not coerced.
    expect(isBackupName(null)).toBe(false);
  });
});

/**
 * Retention is a KEEP list, not a delete list.
 *
 * Everything below states what survives; a file is dropped only because no
 * tier claimed it. That direction matters — a bug in a delete rule loses data,
 * a bug in a keep rule costs disk.
 */
describe('planRetention', () => {
  const now = at(2026, 8, 30, 23, 0, 0);

  function entry(stamp: string, reason = 'auto') {
    return { name: `phase-backup-${stamp}-${reason}.json`, stamp, reason };
  }

  /**
   * Five backups from today, which the recency tier keeps unconditionally.
   *
   * Every tier assertion below is padded with them so the newest-five FLOOR is
   * already satisfied by work that is being kept for another reason — without
   * it a three-entry fixture proves nothing, because the floor alone would
   * keep the whole thing.
   */
  const pad = [
    entry('20260830-090000'), entry('20260830-100000'), entry('20260830-110000'),
    entry('20260830-120000'), entry('20260830-130000'),
  ];
  const padNames = pad.map((e) => e.name);

  it('keeps everything from today and yesterday, however many there are', () => {
    const entries = [...pad, entry('20260829-080000'), entry('20260829-200000')];
    expect(planRetention(entries, now).drop).toEqual([]);
  });

  it('thins older days to the newest backup of each day', () => {
    const entries = [
      ...pad,
      entry('20260827-090000'), entry('20260827-180000'),
      entry('20260826-090000'), entry('20260826-180000'),
    ];
    const { keep, drop } = planRetention(entries, now);
    expect(keep).toContain('phase-backup-20260827-180000-auto.json');
    expect(keep).toContain('phase-backup-20260826-180000-auto.json');
    expect(drop).toEqual([
      'phase-backup-20260827-090000-auto.json',
      'phase-backup-20260826-090000-auto.json',
    ]);
  });

  it('still keeps one per week past the daily window', () => {
    // ~5 weeks back: too old for the daily tier, inside the weekly one.
    const entries = [...pad, entry('20260725-090000'), entry('20260725-180000')];
    const { keep, drop } = planRetention(entries, now);
    expect(keep).toContain('phase-backup-20260725-180000-auto.json');
    expect(drop).toEqual(['phase-backup-20260725-090000-auto.json']);
  });

  it('still keeps one per month past the weekly window', () => {
    const entries = [...pad, entry('20260210-090000'), entry('20260220-090000')];
    const { keep, drop } = planRetention(entries, now);
    expect(keep).toContain('phase-backup-20260220-090000-auto.json');
    expect(drop).toEqual(['phase-backup-20260210-090000-auto.json']);
  });

  it('drops what is older than the last monthly bucket', () => {
    const entries = [...pad, entry('20240101-090000')];
    expect(planRetention(entries, now).drop).toEqual(['phase-backup-20240101-090000-auto.json']);
  });

  it('never prunes a pre-import snapshot, however old', () => {
    const entries = [...pad, entry('20200101-090000', 'pre-import')];
    expect(planRetention(entries, now).drop).toEqual([]);
  });

  it('caps pre-import snapshots so they cannot grow without bound', () => {
    const olds = Array.from({ length: 25 }, (_, i) =>
      entry(`2020010${(i % 9) + 1}-0900${String(i).padStart(2, '0')}`, 'pre-import'));
    const { keep, drop } = planRetention(olds, now);
    expect(keep).toHaveLength(20);
    expect(drop).toHaveLength(5);
  });

  it('keeps the five newest whatever the tiers say', () => {
    // Five ancient backups, all outside every window: the floor still holds
    // them, because a store that pruned itself to nothing is not a backup.
    const entries = [
      entry('20200105-090000'), entry('20200104-090000'), entry('20200103-090000'),
      entry('20200102-090000'), entry('20200101-090000'),
    ];
    expect(planRetention(entries, now).drop).toEqual([]);
  });

  it('is order-independent — the input need not arrive sorted', () => {
    const unsorted = [
      entry('20260826-090000'), ...pad, entry('20260827-180000'), entry('20260826-180000'),
    ];
    const { keep, drop } = planRetention(unsorted, now);
    expect(keep).toContain('phase-backup-20260826-180000-auto.json');
    expect(drop).toEqual(['phase-backup-20260826-090000-auto.json']);
  });

  it('keeps and drops nothing it was not given', () => {
    const entries = [...pad, entry('20260827-090000'), entry('20260827-180000')];
    const { keep, drop } = planRetention(entries, now);
    expect([...keep, ...drop].sort()).toEqual(entries.map((e) => e.name).sort());
    expect(padNames.every((n) => keep.includes(n))).toBe(true);
  });
});
