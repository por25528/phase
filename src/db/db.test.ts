import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  db, persist, importStateFromFile, loadState,
  loadAvailability, saveAvailability, loadAllDayBlocks, saveAllDayBlocks,
  isSlotMigrationDone, markSlotMigrationDone, saveSlotMigrationSnapshot,
  resetSlotMigration,
} from './db';
import type { AppState, Goal } from './types';
import { DEFAULT_AVAILABILITY } from '../lib/availability';

function goal(id: string): Goal {
  return { id, title: id, start: '2026-01-01', deadline: '2026-12-31', nodes: [], column: 0 };
}

const stateA: AppState = { goals: [goal('a'), goal('b')], habits: [], tasks: [], sessions: [] };
const stateB: AppState = { goals: [goal('c')], habits: [], tasks: [], sessions: [] };

beforeEach(async () => {
  await Promise.all([
    db.goals.clear(), db.habits.clear(), db.tasks.clear(), db.sessions.clear(), db.settings.clear(),
  ]);
});

describe('persist', () => {
  it('round-trips every table', async () => {
    await persist({ ...stateA, tasks: [{ id: 't1', title: 't', date: '2026-07-05', done: false, goalId: null }] });
    expect((await db.goals.toArray()).map((g) => g.id).sort()).toEqual(['a', 'b']);
    expect(await db.tasks.count()).toBe(1);
  });

  it('replaces stale rows — no leftovers from the previous save', async () => {
    await persist(stateA);
    await persist(stateB);
    expect((await db.goals.toArray()).map((g) => g.id)).toEqual(['c']);
  });
});

function fileOf(contents: string): File {
  return new File([contents], 'backup.json', { type: 'application/json' });
}

describe('importStateFromFile', () => {
  it('imports a valid backup, persists it, and returns the scale', async () => {
    const task = { id: 't1', title: 'Legacy task', date: '2026-07-05', done: false, goalId: null };
    const session = { id: 's1', goalId: 'g1', date: '2026-07-05', minutes: 30, note: 'Legacy log' };
    const backup = { goals: [goal('g1')], habits: [], tasks: [task], sessions: [session], pxPerDay: 40 };
    const result = await importStateFromFile(fileOf(JSON.stringify(backup)));
    expect(result.goals.map((g) => g.id)).toEqual(['g1']);
    expect(result.tasks).toEqual([task]);
    expect(result.sessions).toEqual([session]);
    expect(result.pxPerDay).toBe(40);
    expect(await loadState()).toEqual({
      goals: [goal('g1')], habits: [], tasks: [task], sessions: [session],
    });
  });

  it('preserves absent completion and date-confirmation fields in a legacy backup', async () => {
    const legacyGoal: Goal = {
      id: 'legacy-goal',
      title: 'Legacy goal',
      start: '2026-01-01',
      deadline: '2026-12-31',
      nodes: [{ id: 'legacy-leaf', title: 'Already done', done: true }],
      column: 0,
    };
    const legacyTask = {
      id: 'legacy-task',
      title: 'Already done',
      date: '2026-07-05',
      done: true,
      goalId: null,
    };

    const imported = await importStateFromFile(fileOf(JSON.stringify({
      goals: [legacyGoal],
      habits: [],
      tasks: [legacyTask],
      sessions: [],
    })));

    expect(imported.goals[0].datesConfirmed).toBeUndefined();
    expect(imported.goals[0].nodes[0].doneAt).toBeUndefined();
    expect(imported.tasks[0].doneAt).toBeUndefined();
    expect(imported.goals[0]).not.toHaveProperty('datesConfirmed');
    expect(imported.goals[0].nodes[0]).not.toHaveProperty('doneAt');
    expect(imported.tasks[0]).not.toHaveProperty('doneAt');

    const persisted = await loadState();
    expect(persisted.goals[0]).toEqual(legacyGoal);
    expect(persisted.tasks[0]).toEqual(legacyTask);
  });

  it('rejects non-JSON with a JSON-specific message', async () => {
    await expect(importStateFromFile(fileOf('not json {'))).rejects.toThrow(/valid JSON/);
  });

  it('rejects JSON that has none of the Phase tables', async () => {
    await expect(importStateFromFile(fileOf('{"foo": 1}'))).rejects.toThrow(/Phase backup/);
  });

  it('rejects a backup whose tables are malformed', async () => {
    await expect(importStateFromFile(fileOf('{"goals": "nope"}'))).rejects.toThrow(/Phase backup/);
  });

  it('round-trips availability and allDayBlocks through a backup', async () => {
    // Mirrors the JSON shape exportState() produces (exportState itself is
    // untestable here — it drives DOM download APIs not present under
    // environment: 'node' — so we build the same backup literal it would).
    const windows = [{ dow: 2, startMin: 600, endMin: 720 }];
    const backup = {
      goals: [goal('g1')], habits: [], tasks: [], sessions: [],
      pxPerDay: 40, availability: windows, allDayBlocks: false,
    };
    const imported = await importStateFromFile(fileOf(JSON.stringify(backup)));
    expect(imported.availability).toEqual(windows);
    expect(imported.allDayBlocks).toBe(false);
    expect(await loadAvailability()).toEqual(windows);
    expect(await loadAllDayBlocks()).toBe(false);
  });

  it('leaves existing availability/allDayBlocks alone for an old backup that predates them', async () => {
    // Seed non-default settings first, so we can tell "left the existing
    // settings alone" apart from "fell back to the default" — an absent key
    // in the backup means it says nothing about this device preference, not
    // that the user wants the default restored (a prior regression reset a
    // user's working hours to the default on every old-backup import).
    const seededAvailability = [{ dow: 5, startMin: 0, endMin: 60 }];
    await saveAvailability(seededAvailability);
    await saveAllDayBlocks(false);

    const oldBackup = { goals: [goal('g1')], habits: [], tasks: [], sessions: [], pxPerDay: 40 };
    const imported = await importStateFromFile(fileOf(JSON.stringify(oldBackup)));

    expect(imported.availability).toEqual(seededAvailability);
    expect(imported.allDayBlocks).toBe(false);
    expect(await loadAvailability()).toEqual(seededAvailability);
    expect(await loadAllDayBlocks()).toBe(false);
  });

  it('coerces the persisted string form "false" for allDayBlocks in a backup', async () => {
    const backup = {
      goals: [goal('g1')], habits: [], tasks: [], sessions: [],
      pxPerDay: 40, allDayBlocks: 'false',
    };
    const imported = await importStateFromFile(fileOf(JSON.stringify(backup)));
    expect(imported.allDayBlocks).toBe(false);
    expect(await loadAllDayBlocks()).toBe(false);
  });

  it('falls back to DEFAULT_AVAILABILITY for a malformed availability array in the backup', async () => {
    const backup = {
      goals: [goal('g1')], habits: [], tasks: [], sessions: [],
      pxPerDay: 40,
      availability: [{ dow: 9, startMin: -1, endMin: 5000 }], // out-of-range, malformed
      allDayBlocks: true,
    };
    const imported = await importStateFromFile(fileOf(JSON.stringify(backup)));
    expect(imported.availability).toEqual(DEFAULT_AVAILABILITY);
    expect(await loadAvailability()).toEqual(DEFAULT_AVAILABILITY);
  });

  // Finding I2: every backup predates the calendar-grid migration, but this
  // device's own done-flag is already true from its own first launch — so
  // without re-arming it here, migrateSlots would never run over the imported
  // (pre-migration-shape) data and pre-migration data would resurface.
  it('re-arms the slot migration so the imported data is migrated on next hydration', async () => {
    await markSlotMigrationDone();
    await saveSlotMigrationSnapshot([goal('this-devices-own-snapshot')], []);
    expect(await isSlotMigrationDone()).toBe(true);

    const backup = { goals: [goal('g1')], habits: [], tasks: [], sessions: [], pxPerDay: 40 };
    await importStateFromFile(fileOf(JSON.stringify(backup)));

    expect(await isSlotMigrationDone()).toBe(false);
    expect(await db.settings.get('preSlotMigrationSnapshot')).toBeUndefined();
  });
});

describe('loadState', () => {
  it('returns an empty state on a fresh database — no demo seed', async () => {
    const s = await loadState();
    expect(s).toEqual({ goals: [], habits: [], tasks: [], sessions: [] });
  });

  it('loads legacy optional fields on the existing Dexie schema version', async () => {
    const legacyGoal: Goal = {
      id: 'legacy-goal',
      title: 'Legacy goal',
      start: '2026-01-01',
      deadline: '2026-12-31',
      nodes: [{ id: 'legacy-leaf', title: 'Done before timestamps', done: true }],
      column: 0,
    };
    const legacyTask = {
      id: 'legacy-task',
      title: 'Done before timestamps',
      date: '2026-07-05',
      done: true,
      goalId: null,
    };

    expect(db.verno).toBe(4);
    await db.goals.put(legacyGoal);
    await db.tasks.put(legacyTask);

    const loaded = await loadState();
    expect(loaded.goals[0]).toEqual(legacyGoal);
    expect(loaded.tasks[0]).toEqual(legacyTask);
    expect(loaded.goals[0].datesConfirmed).toBeUndefined();
    expect(loaded.goals[0].nodes[0].doneAt).toBeUndefined();
    expect(loaded.tasks[0].doneAt).toBeUndefined();
  });
});

describe('availability', () => {
  it('returns the default availability when nothing is stored', async () => {
    await db.settings.clear();
    expect(await loadAvailability()).toEqual(DEFAULT_AVAILABILITY);
  });

  it('round-trips saved availability', async () => {
    const windows = [{ dow: 2, startMin: 600, endMin: 720 }];
    await saveAvailability(windows);
    expect(await loadAvailability()).toEqual(windows);
  });

  it('falls back to the default when the stored value is corrupt', async () => {
    await db.settings.put({ key: 'availability', value: '{not json' });
    expect(await loadAvailability()).toEqual(DEFAULT_AVAILABILITY);
  });

  it('defaults allDayBlocks to true and round-trips false', async () => {
    await db.settings.clear();
    expect(await loadAllDayBlocks()).toBe(true);
    await saveAllDayBlocks(false);
    expect(await loadAllDayBlocks()).toBe(false);
  });
});

describe('slot migration flag and snapshot', () => {
  it('isSlotMigrationDone is false initially and true after markSlotMigrationDone', async () => {
    expect(await isSlotMigrationDone()).toBe(false);
    await markSlotMigrationDone();
    expect(await isSlotMigrationDone()).toBe(true);
  });

  // Direct test of Finding 1: the snapshot is the sole record of pre-migration
  // state. A second call — e.g. a re-entry after a crash between persist and
  // markSlotMigrationDone, where the data is already migrated — must never
  // overwrite the first, original copy.
  it('a second saveSlotMigrationSnapshot call does not overwrite the first', async () => {
    const originalGoal = goal('original');
    const migratedGoal = goal('migrated-should-not-land');
    await saveSlotMigrationSnapshot([originalGoal], []);

    await saveSlotMigrationSnapshot([migratedGoal], []);

    const row = await db.settings.get('preSlotMigrationSnapshot');
    const stored = JSON.parse(row!.value);
    expect(stored.goals).toEqual([originalGoal]);
  });

  // Finding I2: an import must re-arm the migration, or the imported (always
  // pre-migration-shape) data is stranded behind a done-flag this device
  // already flipped true on its own first launch.
  describe('resetSlotMigration', () => {
    it('clears the done-flag', async () => {
      await markSlotMigrationDone();
      expect(await isSlotMigrationDone()).toBe(true);

      await resetSlotMigration();

      expect(await isSlotMigrationDone()).toBe(false);
    });

    it('clears the snapshot row too, so the next migration can write a fresh one', async () => {
      const oldSnapshotGoal = goal('pre-existing-device-snapshot');
      await saveSlotMigrationSnapshot([oldSnapshotGoal], []);
      await markSlotMigrationDone();

      await resetSlotMigration();

      // With the row cleared, saveSlotMigrationSnapshot's write-once guard must
      // not see a stale row and skip — the NEW pre-migration data (the import)
      // needs its own snapshot, not the old device's leftover one.
      const importedGoal = goal('freshly-imported');
      await saveSlotMigrationSnapshot([importedGoal], []);
      const row = await db.settings.get('preSlotMigrationSnapshot');
      const stored = JSON.parse(row!.value);
      expect(stored.goals).toEqual([importedGoal]);
    });
  });
});
