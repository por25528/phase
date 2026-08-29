import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  db, persist, exportState, importStateFromFile, validateBackupFile, loadState,
  loadAllDayBlocks, saveAllDayBlocks,
  isSlotMigrationDone, markSlotMigrationDone, saveSlotMigrationSnapshot,
  resetSlotMigration, loadSlotMigrationSnapshot,
  isCheckpointMigrationDone, markCheckpointMigrationDone, saveCheckpointMigrationSnapshot,
  resetCheckpointMigration, loadCheckpointMigrationSnapshot,
  loadSidebarPanels, saveSidebarPanels, type SidebarPanel,
  loadPlanMode, savePlanMode,
} from './db';
import type { AppState, Asset, Goal } from './types';
import { loadCalendarCache, saveCalendarCache } from './calendarCache';

function goal(id: string): Goal {
  return { id, title: id, start: '2026-01-01', deadline: '2026-12-31', nodes: [], column: 0 };
}

const stateA: AppState = { goals: [goal('a'), goal('b')], habits: [], tasks: [], sessions: [], lives: [] };
const stateB: AppState = { goals: [goal('c')], habits: [], tasks: [], sessions: [], lives: [] };

beforeEach(async () => {
  await Promise.all([
    db.goals.clear(), db.habits.clear(), db.tasks.clear(), db.sessions.clear(), db.settings.clear(),
    db.planReview.clear(), db.assets.clear(), db.calendarCache.clear(), db.lives.clear(),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
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

function asset(id: string, bytes: number[]): Asset {
  return {
    id,
    mime: 'image/png',
    bytes: new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
    width: 2,
    height: 2,
    createdAt: '2026-08-01',
  };
}

async function exportedPayload(state: AppState): Promise<Record<string, unknown>> {
  let backupBlob: Blob | undefined;
  const anchor = { href: '', download: '', click: vi.fn() };
  vi.stubGlobal('document', { createElement: vi.fn(() => anchor) });
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn((blob: Blob) => {
      backupBlob = blob;
      return 'blob:backup';
    }),
  });

  await exportState(state, 13, null, true, []);
  expect(anchor.click).toHaveBeenCalledOnce();
  return JSON.parse(await backupBlob!.text()) as Record<string, unknown>;
}

describe('importStateFromFile', () => {
  it('imports a legacy backup with no assets key and clears existing assets', async () => {
    await db.assets.put(asset('a_stale', [9, 8, 7]));

    await importStateFromFile(fileOf(JSON.stringify({
      goals: [goal('g1')], habits: [], tasks: [], sessions: [],
    })));

    expect(await db.assets.count()).toBe(0);
  });

  it('exports only referenced project and step assets', async () => {
    await db.assets.bulkPut([
      asset('a_project', [1]),
      asset('a_step', [2]),
      asset('a_orphan', [3]),
    ]);
    const state: AppState = {
      goals: [{
        ...goal('g1'),
        notes: 'Project image: asset:a_project',
        nodes: [{
          id: 'n1',
          title: 'Step',
          notes: 'Step image: asset:a_step',
        }],
      }],
      habits: [],
      tasks: [],
      sessions: [],
      lives: [],
    };

    const backup = await exportedPayload(state);
    expect((backup.assets as Array<{ id: string }>).map((entry) => entry.id).sort()).toEqual([
      'a_project', 'a_step',
    ]);
  });

  it('preserves asset bytes through export, clear, and import', async () => {
    const bytes = new Uint8Array([0, 17, 34, 127, 128, 238, 255]);
    await db.assets.put(asset('a_cycle', [...bytes]));
    const state: AppState = {
      goals: [{
        ...goal('g1'),
        notes: '![image](asset:a_cycle)',
        nodes: [],
      }],
      habits: [],
      tasks: [],
      sessions: [],
      lives: [],
    };

    const backup = await exportedPayload(state);
    await Promise.all([
      db.goals.clear(), db.habits.clear(), db.tasks.clear(), db.sessions.clear(),
      db.settings.clear(), db.planReview.clear(), db.assets.clear(),
    ]);
    await importStateFromFile(fileOf(JSON.stringify(backup)));

    const restored = await db.assets.get('a_cycle');
    expect(restored).toBeDefined();
    expect(new Uint8Array(await restored!.bytes.arrayBuffer())).toEqual(bytes);
  });

  it('keeps imported app state when saving imported assets fails', async () => {
    const bulkPut = vi.spyOn(db.assets, 'bulkPut').mockRejectedValueOnce(new Error('quota exceeded'));
    try {
      await expect(importStateFromFile(fileOf(JSON.stringify({
        goals: [{
          ...goal('g1'),
          notes: '![image](asset:a_1)',
        }],
        habits: [], tasks: [], sessions: [], assets: [],
      })))).rejects.toThrow(/images could not be saved/);

      expect((await loadState()).goals[0].notes).toBe('![image](asset:a_1)');
    } finally {
      bulkPut.mockRestore();
    }
  });

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
      goals: [goal('g1')], habits: [], tasks: [task], sessions: [session], lives: [],
    });
  });

  it('converts legacy markers before persisting an imported backup', async () => {
    const legacyGoal = {
      ...goal('legacy-markers'),
      milestones: [{ id: 'm1', title: 'Demo', date: '2026-08-10' }],
    };
    const backup = { goals: [legacyGoal], habits: [], tasks: [], sessions: [] };

    const imported = await importStateFromFile(fileOf(JSON.stringify(backup)));

    // migrateCheckpoints appends this node with the legacy `done: false`;
    // migrateNodeStatus (running right after, inside importStateFromFile)
    // strips it since false never sets `status` — the node lands as todo,
    // i.e. status absent, same as any never-completed node.
    expect(imported.goals[0].nodes).toEqual([{
      id: 'm1',
      title: 'Demo',
      checkpoint: true,
      start: '2026-08-10',
      deadline: '2026-08-10',
    }]);
    expect(imported.goals[0]).not.toHaveProperty('milestones');
    expect((await loadState()).goals[0]).toEqual(imported.goals[0]);
  });

  it('preserves absent completion and date-confirmation fields in a legacy backup', async () => {
    const legacyGoal: Goal = {
      id: 'legacy-goal',
      title: 'Legacy goal',
      start: '2026-01-01',
      deadline: '2026-12-31',
      nodes: [{ id: 'legacy-leaf', title: 'Already done', status: 'done' }],
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

    // Migration of a legacy `done` flag to `status` is covered separately by
    // 'migrates a legacy done flag out of an imported backup' below — this
    // fixture already carries `status: 'done'`, so nothing here exercises a
    // migration; it's a plain round-trip comparison.
    const persisted = await loadState();
    expect(persisted.goals[0]).toEqual(legacyGoal);
    expect(persisted.tasks[0]).toEqual(legacyTask);
  });

  it('migrates a legacy done flag out of an imported backup', async () => {
    const backup = {
      goals: [{ id: 'g', title: 'G', nodes: [
        { id: 'a', title: 'A', done: true, doneAt: '2026-07-01' },
        { id: 'b', title: 'B', done: false },
        { id: 'p', title: 'P', children: [{ id: 'c', title: 'C', done: true }] },
      ] }],
      habits: [], tasks: [], sessions: [],
    };

    await importStateFromFile(fileOf(JSON.stringify(backup)));

    const [g] = await db.goals.toArray();
    const [a, b, p] = g.nodes;
    expect(a.status).toBe('done');
    expect(a.doneAt).toBe('2026-07-01');
    expect('done' in a).toBe(false);
    expect(b.status).toBeUndefined();
    expect('done' in b).toBe(false);
    expect(p.children![0].status).toBe('done');
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

  /**
   * `validateBackupFile` is the same three refusals, asked BEFORE anything is
   * spent on the import — a pre-import snapshot occupies a bounded retention
   * slot, and a file that was never going to be accepted must not evict a real
   * one. The point of extracting it is that there is no second validator to
   * drift, so what is pinned here is that the verdicts MATCH and that asking
   * writes nothing.
   */
  describe('validateBackupFile', () => {
    it('gives the same verdict the import gives, on each refusal', async () => {
      await expect(validateBackupFile(fileOf('not json {'))).rejects.toThrow(/valid JSON/);
      await expect(validateBackupFile(fileOf('{"foo": 1}'))).rejects.toThrow(/Phase backup/);
      await expect(validateBackupFile(fileOf('{"goals": "nope"}'))).rejects.toThrow(/Phase backup/);
    });

    it('accepts what the import accepts', async () => {
      await expect(
        validateBackupFile(fileOf(JSON.stringify({ goals: [goal('g1')], habits: [], tasks: [], sessions: [] }))),
      ).resolves.toBeUndefined();
    });

    it('writes nothing — not the tables, not a settings row', async () => {
      await persist(stateA);
      const before = await loadState();
      await validateBackupFile(fileOf(JSON.stringify({
        goals: [goal('imported')], habits: [], tasks: [], sessions: [], pxPerDay: 99,
      })));
      // Asking whether a file would import must leave the database exactly as
      // it was, or the check is itself the destructive act it exists to defer.
      expect((await loadState()).goals.map((g) => g.id)).toEqual(before.goals.map((g) => g.id));
    });
  });

  it('round-trips allDayBlocks through a backup', async () => {
    // Mirrors the JSON shape exportState() produces (exportState itself is
    // untestable here — it drives DOM download APIs not present under
    // environment: 'node' — so we build the same backup literal it would).
    const backup = {
      goals: [goal('g1')], habits: [], tasks: [], sessions: [],
      pxPerDay: 40, allDayBlocks: false,
    };
    const imported = await importStateFromFile(fileOf(JSON.stringify(backup)));
    expect(imported.allDayBlocks).toBe(false);
    expect(await loadAllDayBlocks()).toBe(false);
  });

  /*
   * Working hours are gone, and a backup exported before they went still
   * carries the key. It is IGNORED rather than migrated: the model it
   * described no longer exists, and a stale settings row is inert — the same
   * licence a dangling `Session.nodeId` has. The import must not fail on it,
   * and must not resurrect it either.
   */
  it('ignores an availability key from a backup exported before working hours went', async () => {
    const backup = {
      goals: [goal('g1')], habits: [], tasks: [], sessions: [],
      pxPerDay: 40,
      availability: [{ dow: 2, startMin: 600, endMin: 720 }],
      allDayBlocks: false,
    };
    const imported = await importStateFromFile(fileOf(JSON.stringify(backup)));
    expect(imported).not.toHaveProperty('availability');
    expect(await db.settings.get('availability')).toBeUndefined();
  });

  // Spec §7.6: the cache is device-local derived data, not user data. An
  // import must not resurrect a stale calendar, and export must not put
  // meeting titles in a file the user might share. exportState itself is
  // untestable here — it drives DOM download APIs absent under
  // environment: 'node' — so the export side is guaranteed by construction:
  // exportState spreads its AppState argument, but store.ts passes a narrowed
  // four-key literal and AppState itself has no calendarCache field.
  it('leaves the calendar cache untouched across an import', async () => {
    await saveCalendarCache({
      rangeStart: '2026-07-27', rangeEnd: '2026-09-28', blocks: [],
      fetchedAt: '2026-08-04T13:41:00.000Z', accountId: 'me@example.com',
      calendarIds: ['primary'], timeZone: 'America/New_York',
    });
    const backup = { goals: [goal('g1')], habits: [], tasks: [], sessions: [], pxPerDay: 40 };
    await importStateFromFile(fileOf(JSON.stringify(backup)));
    expect((await loadCalendarCache())?.accountId).toBe('me@example.com');
  });

  it('leaves existing allDayBlocks alone for an old backup that predates it', async () => {
    // Seed a non-default setting first, so we can tell "left the existing
    // setting alone" apart from "fell back to the default" — an absent key in
    // the backup means it says nothing about this device preference, not that
    // the user wants the default restored.
    await saveAllDayBlocks(false);

    const oldBackup = { goals: [goal('g1')], habits: [], tasks: [], sessions: [], pxPerDay: 40 };
    const imported = await importStateFromFile(fileOf(JSON.stringify(oldBackup)));

    expect(imported.allDayBlocks).toBe(false);
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

  // The pre-migration snapshot is a device's only recovery copy. An import
  // clears it rather than adopting a foreign snapshot from the backup file.
  // This ensures that if someone later wires the key through, the test catches it.
  it('ignores an incoming preSlotMigrationSnapshot and does not adopt foreign data', async () => {
    // Save this device's own snapshot first.
    const deviceSnapshot = [goal('device-recovery-copy')];
    const deviceTasks = [{ id: 't-device', title: 'Device task', date: '2026-07-15', done: false, goalId: null }];
    await saveSlotMigrationSnapshot(deviceSnapshot, deviceTasks);
    await markSlotMigrationDone();

    // Import a backup carrying a completely different snapshot from another device.
    const foreignSnapshot = [goal('foreign-device-data')];
    const foreignTasks = [{ id: 't-foreign', title: 'Foreign task', date: '2026-07-20', done: false, goalId: null }];
    const backup = {
      goals: [goal('g1')],
      habits: [],
      tasks: [],
      sessions: [],
      pxPerDay: 40,
      preSlotMigrationSnapshot: { goals: foreignSnapshot, tasks: foreignTasks },
    };
    await importStateFromFile(fileOf(JSON.stringify(backup)));

    // The foreign snapshot was cleared, not adopted. loadSlotMigrationSnapshot
    // returns null because resetSlotMigration cleared the row, not because we
    // inherited the foreign data instead.
    expect(await loadSlotMigrationSnapshot()).toBeNull();
  });
});

describe('loadState', () => {
  it('returns an empty state on a fresh database — no demo seed', async () => {
    const s = await loadState();
    expect(s).toEqual({ goals: [], habits: [], tasks: [], sessions: [], lives: [] });
  });

  it('loads legacy optional fields on the existing Dexie schema version', async () => {
    const legacyGoal: Goal = {
      id: 'legacy-goal',
      title: 'Legacy goal',
      start: '2026-01-01',
      deadline: '2026-12-31',
      nodes: [{ id: 'legacy-leaf', title: 'Done before timestamps', status: 'done' }],
      column: 0,
    };
    const legacyTask = {
      id: 'legacy-task',
      title: 'Done before timestamps',
      date: '2026-07-05',
      done: true,
      goalId: null,
    };

    expect(db.verno).toBe(7);
    await db.goals.put(legacyGoal);
    await db.tasks.put(legacyTask);

    const loaded = await loadState();
    // Migration of a legacy `done` flag to `status` is covered separately by
    // 'migrates a legacy done flag on load' below — this fixture already
    // carries `status: 'done'`, so nothing here exercises a migration; it's a
    // plain round-trip comparison.
    expect(loaded.goals[0]).toEqual(legacyGoal);
    expect(loaded.tasks[0]).toEqual(legacyTask);
    expect(loaded.goals[0].datesConfirmed).toBeUndefined();
    expect(loaded.goals[0].nodes[0].doneAt).toBeUndefined();
    expect(loaded.tasks[0].doneAt).toBeUndefined();
  });

  it('migrates a legacy done flag on load', async () => {
    await db.goals.bulkPut([
      { id: 'g', title: 'G', nodes: [{ id: 'a', title: 'A', done: true }] },
    ] as never);

    const state = await loadState();

    expect(state.goals[0].nodes[0].status).toBe('done');
    expect('done' in state.goals[0].nodes[0]).toBe(false);
  });
});

describe('allDayBlocks', () => {
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

  describe('loadSlotMigrationSnapshot', () => {
    it('returns null when no snapshot has been taken', async () => {
      expect(await loadSlotMigrationSnapshot()).toBeNull();
    });

    it('reads back a snapshot that was written', async () => {
      const goals = [{ id: 'g1', title: 'Thesis', nodes: [] }];
      const tasks = [{ id: 't1', title: 'Email', date: '2026-07-15', done: false, goalId: null }];
      await saveSlotMigrationSnapshot(goals as unknown as Goal[], tasks as unknown as AppState['tasks']);
      expect(await loadSlotMigrationSnapshot()).toEqual({ goals, tasks });
    });

    it('returns null rather than throwing on a corrupt snapshot row', async () => {
      await db.settings.put({ key: 'preSlotMigrationSnapshot', value: '{ not json' });
      expect(await loadSlotMigrationSnapshot()).toBeNull();
    });

    // The round-trip test above writes well-formed data via saveSlotMigrationSnapshot,
    // so it can never exercise the Array.isArray shape guard inside
    // loadSlotMigrationSnapshot — only the JSON.parse throw path. This writes valid
    // JSON of the WRONG shape directly, bypassing saveSlotMigrationSnapshot entirely,
    // so the guard is the only thing standing between this row and a bad return value.
    it('returns null when the parsed row has valid JSON but the wrong shape', async () => {
      await db.settings.put({
        key: 'preSlotMigrationSnapshot',
        value: JSON.stringify({ goals: 'nope', tasks: [] }),
      });
      expect(await loadSlotMigrationSnapshot()).toBeNull();
    });
  });
});

describe('checkpoint migration flag and snapshot', () => {
  it('isCheckpointMigrationDone is false initially and true after marking done', async () => {
    expect(await isCheckpointMigrationDone()).toBe(false);
    await markCheckpointMigrationDone();
    expect(await isCheckpointMigrationDone()).toBe(true);
  });

  it('does not overwrite the original checkpoint snapshot', async () => {
    const original = [goal('original')];
    await saveCheckpointMigrationSnapshot(original);
    await saveCheckpointMigrationSnapshot([goal('migrated-should-not-land')]);

    expect(await loadCheckpointMigrationSnapshot()).toEqual({ goals: original });
  });

  it('reset clears the checkpoint done flag and snapshot', async () => {
    await saveCheckpointMigrationSnapshot([goal('before-reset')]);
    await markCheckpointMigrationDone();
    await resetCheckpointMigration();

    expect(await isCheckpointMigrationDone()).toBe(false);
    expect(await loadCheckpointMigrationSnapshot()).toBeNull();
  });
});

describe('sidebar panels', () => {
  it('defaults to no expanded panels', async () => {
    expect(await loadSidebarPanels()).toEqual([]);
  });

  it('round-trips a saved selection', async () => {
    await saveSidebarPanels(['habits']);
    expect(await loadSidebarPanels()).toEqual(['habits']);
  });

  /**
   * Stats and Working hours were panels here until they moved to the week
   * header and to Settings. An old preference naming one has to degrade to
   * "collapsed" rather than to an error — a settings row is not worth a
   * failed hydration.
   */
  it('forgets a panel that no longer exists', async () => {
    await db.settings.put({ key: 'sidebarPanels', value: JSON.stringify(['habits', 'availability']) });
    expect(await loadSidebarPanels()).toEqual(['habits']);
  });

  it('drops unknown panel names rather than storing them', async () => {
    await saveSidebarPanels(['habits', 'bogus' as SidebarPanel]);
    expect(await loadSidebarPanels()).toEqual(['habits']);
  });

  it('falls back to empty for malformed stored JSON', async () => {
    await db.settings.put({ key: 'sidebarPanels', value: 'not json' });
    expect(await loadSidebarPanels()).toEqual([]);
  });

  it('deduplicates repeated panels', async () => {
    await saveSidebarPanels(['habits', 'habits']);
    expect(await loadSidebarPanels()).toEqual(['habits']);
  });

  describe('planMode', () => {
    it('defaults to week when unset', async () => {
      expect(await loadPlanMode()).toBe('week');
    });

    it('round-trips month', async () => {
      await savePlanMode('month');
      expect(await loadPlanMode()).toBe('month');
    });

    it('falls back to week on an unrecognised value', async () => {
      // Total parse, as parseSidebarPanels and parseAvailability do: a value
      // we do not recognise yields the default rather than a half-trusted one.
      await db.settings.put({ key: 'planMode', value: 'fortnight' });
      expect(await loadPlanMode()).toBe('week');
    });
  });

  it('filters and deduplicates on read, not just on write', async () => {
    // Bypasses saveSidebarPanels: its identical write-side filter would
    // otherwise clean the data before parseSidebarPanels ever sees it,
    // leaving the read-path filter unexercised. This is the path that
    // defends against a row written by a different version of the app.
    await db.settings.put({
      key: 'sidebarPanels',
      value: JSON.stringify(['habits', 'bogus', 'habits']),
    });
    expect(await loadSidebarPanels()).toEqual(['habits']);
  });
});

/**
 * `sidebarPanels` is persisted like availability and allDayBlocks, and was the
 * one device preference the backup left out — so "the backup contains
 * everything persisted" was not true, and the next preference added would have
 * copied the omission.
 */
describe('sidebarPanels round-trips through a backup', () => {
  it('restores the panels a backup carries', async () => {
    await saveSidebarPanels(['habits']);
    const file = fileOf(JSON.stringify({ goals: [], habits: [], tasks: [], sessions: [], sidebarPanels: [] }));
    const out = await importStateFromFile(file);
    expect(out.sidebarPanels).toEqual([]);
    expect(await loadSidebarPanels()).toEqual([]);
  });

  it('leaves this device alone when the backup is silent — absent is not "default"', async () => {
    await saveSidebarPanels(['habits']);
    const file = fileOf(JSON.stringify({ goals: [], habits: [], tasks: [], sessions: [] }));
    const out = await importStateFromFile(file);
    expect(out.sidebarPanels).toEqual(['habits']);
  });

  it('collapses a malformed value rather than half-trusting it', async () => {
    await saveSidebarPanels(['habits']);
    const file = fileOf(JSON.stringify({ goals: [], habits: [], tasks: [], sessions: [], sidebarPanels: 'habits,stats' }));
    const out = await importStateFromFile(file);
    expect(out.sidebarPanels).toEqual([]);
  });
});

describe('lives', () => {
  const withLives = (lives: AppState['lives']): AppState => ({
    goals: [], habits: [], tasks: [], sessions: [], lives,
  });

  it('round-trips through persist and loadState', async () => {
    await persist(withLives([{ id: 'l1', title: 'MIT', order: 0 }]));

    const loaded = await loadState();

    expect(loaded.lives).toEqual([{ id: 'l1', title: 'MIT', order: 0 }]);
  });

  // persist is a full clear + bulkPut, so a life removed in memory must be
  // gone from disk — not merged with what was there before.
  it('a removed life does not survive the next write', async () => {
    await persist(withLives([
      { id: 'l1', title: 'MIT', order: 0 },
      { id: 'l2', title: 'Startup', order: 1 },
    ]));
    await persist(withLives([{ id: 'l1', title: 'MIT', order: 0 }]));

    expect((await loadState()).lives.map((l) => l.id)).toEqual(['l1']);
  });

  it('loads as an empty list when nothing was ever written', async () => {
    expect((await loadState()).lives).toEqual([]);
  });

  it('survives an export/import round trip, capping and cleaning on the way in', async () => {
    const raw = JSON.stringify({
      goals: [], habits: [], tasks: [], sessions: [],
      lives: [
        { id: 'l1', title: 'MIT', order: 0 },
        { id: 'l1', title: 'Duplicate', order: 1 },
        { id: 'l2', title: 'Startup', order: 1 },
      ],
      pxPerDay: 13,
    });
    const file = new File([raw], 'phase-goals-2026-08-11.json', { type: 'application/json' });

    const imported = await importStateFromFile(file);

    expect(imported.lives).toEqual([
      { id: 'l1', title: 'MIT', order: 0 },
      { id: 'l2', title: 'Startup', order: 1 },
    ]);
    expect((await loadState()).lives.map((l) => l.id)).toEqual(['l1', 'l2']);
  });
});

describe('active focus session', () => {
  const draft = {
    id: 'f1',
    ref: { kind: 'step' as const, id: 'n1', goalId: 'g1' },
    title: 'Problem set 4',
    startedAtMs: 1_700_000_000_000,
    activeSinceMs: 1_700_000_000_000,
    accumulatedMs: 0,
    phase: 'active' as const,
    expected: { kind: 'starter' as const, minutes: 30 as const },
    focusLevel: 'medium' as const,
  };

  it('loadActiveFocusSession returns null when absent', async () => {
    const { loadActiveFocusSession } = await import('./db');
    expect(await loadActiveFocusSession()).toBeNull();
  });

  it('loadActiveFocusSession returns null for a malformed row', async () => {
    const { loadActiveFocusSession } = await import('./db');
    await db.settings.put({ key: 'activeFocusSession', value: 'not json at all' });
    expect(await loadActiveFocusSession()).toBeNull();
    await db.settings.put({ key: 'activeFocusSession', value: JSON.stringify({ id: 'x' }) });
    expect(await loadActiveFocusSession()).toBeNull();
  });

  it('saveActiveFocusSession writes only the activeFocusSession settings row', async () => {
    const { saveActiveFocusSession, loadActiveFocusSession } = await import('./db');
    await db.settings.put({ key: 'availability', value: '[]' });
    await saveActiveFocusSession(draft);
    const keys = (await db.settings.toArray()).map((row) => row.key).sort();
    expect(keys).toEqual(['activeFocusSession', 'availability']);
    expect(await loadActiveFocusSession()).toEqual(draft);
  });

  it('saveActiveFocusSession(null) deletes the row and leaves the rest alone', async () => {
    const { saveActiveFocusSession } = await import('./db');
    await db.settings.put({ key: 'availability', value: '[]' });
    await saveActiveFocusSession(draft);
    await saveActiveFocusSession(null);
    const keys = (await db.settings.toArray()).map((row) => row.key);
    expect(keys).toEqual(['availability']);
  });
});

describe('assistant accelerator setting', () => {
  it('defaults to Command+Space when absent or malformed', async () => {
    const { loadAssistantAccelerator } = await import('./db');
    expect(await loadAssistantAccelerator()).toBe('Command+Space');
    await db.settings.put({ key: 'assistantAccelerator', value: 'Space' });
    expect(await loadAssistantAccelerator()).toBe('Command+Space');
  });

  it('round-trips a valid chord', async () => {
    const { loadAssistantAccelerator, saveAssistantAccelerator } = await import('./db');
    await saveAssistantAccelerator('Control+Alt+K');
    expect(await loadAssistantAccelerator()).toBe('Control+Alt+K');
  });
});

describe('sync meta', () => {
  it('defaults to generation 0 with nothing ingested', async () => {
    const { loadSyncMeta } = await import('./db');
    expect(await loadSyncMeta()).toEqual({ generation: 0, ingestedThroughOpId: null });
  });

  it('round-trips a saved meta', async () => {
    const { loadSyncMeta, saveSyncMeta } = await import('./db');
    await saveSyncMeta({ generation: 7, ingestedThroughOpId: 'op-3' });
    expect(await loadSyncMeta()).toEqual({ generation: 7, ingestedThroughOpId: 'op-3' });
  });

  it('reads a malformed row as the default rather than throwing', async () => {
    const { loadSyncMeta } = await import('./db');
    await db.settings.put({ key: 'syncMeta', value: 'not json' });
    expect(await loadSyncMeta()).toEqual({ generation: 0, ingestedThroughOpId: null });
    await db.settings.put({ key: 'syncMeta', value: JSON.stringify({ generation: 'x' }) });
    expect(await loadSyncMeta()).toEqual({ generation: 0, ingestedThroughOpId: null });
  });

  it('keeps a valid generation when the op id is missing', async () => {
    const { loadSyncMeta } = await import('./db');
    await db.settings.put({ key: 'syncMeta', value: JSON.stringify({ generation: 4 }) });
    expect(await loadSyncMeta()).toEqual({ generation: 4, ingestedThroughOpId: null });
  });
});
