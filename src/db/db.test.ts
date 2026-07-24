import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db, persist, importStateFromFile, loadState } from './db';
import type { AppState, Goal } from './types';

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
