import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { goalPct } from '../lib/pct';
import type { Goal } from '../db/types';

vi.mock('../db/db', () => ({
  loadState: vi.fn(async () => ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadScale: vi.fn(async () => 13),
  saveScale: vi.fn(async () => {}),
  persist: vi.fn(async () => {}),
  exportState: vi.fn(),
  importStateFromFile: vi.fn(),
}));

async function freshStore() {
  vi.resetModules();
  return await import('./store');
}

describe('store actions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('addGoal → addRootNode → toggleLeaf round-trip', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('Ship it', '2026-12-31');
    const gid = getState().goals[0].id;
    actions.addRootNode(gid, 'Step 1');
    const nid = getState().goals[0].nodes[0].id;
    expect(getState().goals[0].nodes[0].done).toBe(false);
    actions.toggleLeaf(nid);
    expect(getState().goals[0].nodes[0].done).toBe(true);
  });

  it('new goals default to column 0 and sort ahead of higher columns', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('A', '2026-12-31');
    actions.addGoal('B', '2026-12-31');
    const [a, b] = getState().goals;
    // both column 0, insertion order preserved
    expect(a.column).toBe(0);
    expect(b.column).toBe(0);
    // push B to column 2 via the board, then add C — C (col 0) must sort before B
    actions.setGoalBoard([[a.id], [], [b.id], []]);
    actions.addGoal('C', '2026-12-31');
    const order = getState().goals.map((g) => g.title);
    const cols = getState().goals.map((g) => g.column);
    expect(order).toEqual(['A', 'C', 'B']); // column-major: col0 (A, C) then col2 (B)
    expect(cols).toEqual([0, 0, 2]);
  });

  it('setGoalBoard rebuilds goals in column-major order and stamps columns', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('one', '2026-12-31');
    actions.addGoal('two', '2026-12-31');
    actions.addGoal('three', '2026-12-31');
    const [g1, g2, g3] = getState().goals.map((g) => g.id);
    // three across columns: g3 highest (col0), g1 col1 top, g2 col1 below
    actions.setGoalBoard([[g3], [g1, g2], [], []]);
    const goals = getState().goals;
    expect(goals.map((g) => g.id)).toEqual([g3, g1, g2]);
    expect(goals.map((g) => g.column)).toEqual([0, 1, 1]);
  });

  it('setGoalBoard never drops a goal missing from the layout', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('keep', '2026-12-31');
    actions.addGoal('orphan', '2026-12-31');
    const [keep, orphan] = getState().goals.map((g) => g.id);
    actions.setGoalBoard([[keep], [], [], []]); // orphan omitted
    const ids = getState().goals.map((g) => g.id);
    expect(ids).toContain(keep);
    expect(ids).toContain(orphan);
    expect(ids).toHaveLength(2);
  });

  it('addChild converts a leaf into a container (done removed, parent expanded)', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G', '2026-12-31');
    const gid = getState().goals[0].id;
    actions.addRootNode(gid, 'leaf');
    const nid = getState().goals[0].nodes[0].id;
    actions.addChild(nid, 'child');
    const node = getState().goals[0].nodes[0];
    expect(node.done).toBeUndefined();
    expect(node.children).toHaveLength(1);
    expect(getState().expanded.has(nid)).toBe(true);
  });

  describe('addChild clears planning fields', () => {
    it('a planned leaf that gains a child loses done/plannedWeek/plannedDay', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('G', '2026-12-31');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;
      // plan the leaf by hand (planNode arrives in a later task)
      getState().goals[0].nodes[0].plannedWeek = '2026-07-13';
      getState().goals[0].nodes[0].plannedDay = '2026-07-15';
      actions.addChild(nid, 'child');
      const node = getState().goals[0].nodes[0];
      expect(node.children).toHaveLength(1);
      expect(node.done).toBeUndefined();
      expect(node.plannedWeek).toBeUndefined();
      expect(node.plannedDay).toBeUndefined();
    });
  });

  it('removeNode schedules undo; undoLastDelete restores', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G', '2026-12-31');
    const gid = getState().goals[0].id;
    actions.addRootNode(gid, 'Step 1');
    const nid = getState().goals[0].nodes[0].id;
    actions.removeNode(nid);
    expect(getState().goals[0].nodes).toHaveLength(0);
    expect(getState().pendingUndo).not.toBeNull();
    actions.undoLastDelete();
    expect(getState().goals[0].nodes).toHaveLength(1);
    expect(getState().goals[0].nodes[0].id).toBe(nid);
  });

  it('removeGoal schedules undo; undoLastDelete restores', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G', '2026-12-31');
    actions.removeGoal(getState().goals[0].id);
    expect(getState().goals).toHaveLength(0);
    expect(getState().pendingUndo).not.toBeNull();
    actions.undoLastDelete();
    expect(getState().goals).toHaveLength(1);
    expect(getState().pendingUndo).toBeNull();
  });

  it('undo window expires after 5s', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G', '2026-12-31');
    actions.removeGoal(getState().goals[0].id);
    vi.advanceTimersByTime(5000);
    expect(getState().pendingUndo).toBeNull();
    actions.undoLastDelete();
    expect(getState().goals).toHaveLength(0); // nothing restored
  });

  it('setGoalDates clamps inverted spans', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G', '2026-12-31');
    const gid = getState().goals[0].id;
    actions.setGoalDates(gid, '2026-10-01', '2026-02-01');
    expect(getState().goals[0].start).toBe('2026-02-01');
    expect(getState().goals[0].deadline).toBe('2026-10-01');
  });

  it('setNodeDates sets both dates, ordered via clampSpan', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G', '2026-12-31');
    const gid = getState().goals[0].id;
    actions.addRootNode(gid, 'Step 1');
    const nid = getState().goals[0].nodes[0].id;
    actions.setNodeDates(gid, nid, '2026-10-01', '2026-02-01');
    const node = getState().goals[0].nodes[0];
    expect(node.start).toBe('2026-02-01');
    expect(node.deadline).toBe('2026-10-01');
  });

  it('setNodeDates schedules a deeply nested node', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G', '2026-12-31');
    const gid = getState().goals[0].id;
    actions.addRootNode(gid, 'parent');
    const parentId = getState().goals[0].nodes[0].id;
    actions.addChild(parentId, 'child');
    const childId = getState().goals[0].nodes[0].children![0].id;
    actions.setNodeDates(gid, childId, '2026-03-01', '2026-03-15');
    const child = getState().goals[0].nodes[0].children![0];
    expect(child.start).toBe('2026-03-01');
    expect(child.deadline).toBe('2026-03-15');
  });

  it('setNodeDates is a no-op when the goal or node is missing', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G', '2026-12-31');
    const gid = getState().goals[0].id;
    actions.setNodeDates(gid, 'nope', '2026-03-01', '2026-03-15');
    expect(getState().goals[0].nodes).toHaveLength(0);
    actions.setNodeDates('nope', 'nope', '2026-03-01', '2026-03-15');
    expect(getState().goals).toHaveLength(1);
  });

  it('clearNodeDates removes both start and deadline', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G', '2026-12-31');
    const gid = getState().goals[0].id;
    actions.addRootNode(gid, 'Step 1');
    const nid = getState().goals[0].nodes[0].id;
    actions.setNodeDates(gid, nid, '2026-02-01', '2026-10-01');
    actions.clearNodeDates(gid, nid);
    const node = getState().goals[0].nodes[0];
    expect(node.start).toBeUndefined();
    expect(node.deadline).toBeUndefined();
  });

  it('scheduling a node never affects pct roll-up', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G', '2026-12-31');
    const gid = getState().goals[0].id;
    actions.addRootNode(gid, 'Step 1');
    actions.addRootNode(gid, 'Step 2');
    const nid = getState().goals[0].nodes[0].id;
    actions.toggleLeaf(nid); // one of two leaves done -> 50%
    const pctBefore = goalPct(getState().goals[0]);
    actions.setNodeDates(gid, nid, '2026-02-01', '2026-10-01');
    expect(goalPct(getState().goals[0])).toBe(pctBefore);
    expect(getState().goals[0].nodes[0].done).toBe(true);
    actions.clearNodeDates(gid, nid);
    expect(goalPct(getState().goals[0])).toBe(pctBefore);
    expect(getState().goals[0].nodes[0].done).toBe(true);
  });

  it('toggleHabit adds then removes a today check-in', async () => {
    const { actions, getState } = await freshStore();
    actions.addHabit('Run', 'daily', 4);
    const hid = getState().habits[0].id;
    actions.toggleHabit(hid);
    expect(getState().habits[0].checkins).toHaveLength(1);
    actions.toggleHabit(hid);
    expect(getState().habits[0].checkins).toHaveLength(0);
  });

  it('addHabit stamps createdAt with today', async () => {
    vi.setSystemTime(new Date(2026, 6, 4)); // 2026-07-04
    const { actions, getState } = await freshStore();
    actions.addHabit('Study', 'daily', 4);
    expect(getState().habits[0].createdAt).toBe('2026-07-04');
  });

  it('renameHabit updates the title only', async () => {
    const { actions, getState } = await freshStore();
    actions.addHabit('2 hour of studying', 'daily', 4);
    const hid = getState().habits[0].id;
    actions.renameHabit(hid, '3 hour of studying');
    expect(getState().habits[0].title).toBe('3 hour of studying');
    expect(getState().habits[0].cadence).toBe('daily');
  });

  it('removeHabit schedules undo; undoLastDelete restores', async () => {
    const { actions, getState } = await freshStore();
    actions.addHabit('Run', 'daily', 4);
    const hid = getState().habits[0].id;
    actions.removeHabit(hid);
    expect(getState().habits).toHaveLength(0);
    expect(getState().pendingUndo).not.toBeNull();
    actions.undoLastDelete();
    expect(getState().habits).toHaveLength(1);
    expect(getState().habits[0].id).toBe(hid);
  });

  it('moveTaskToDate reschedules a task', async () => {
    const { actions, getState } = await freshStore();
    actions.addTask('T', '2026-01-05', null);
    actions.moveTaskToDate(getState().tasks[0].id, '2026-07-02');
    expect(getState().tasks[0].date).toBe('2026-07-02');
  });

  it('removeTask schedules undo; undoLastDelete restores', async () => {
    const { actions, getState } = await freshStore();
    actions.addTask('T', '2026-07-02', null);
    const tid = getState().tasks[0].id;
    actions.removeTask(tid);
    expect(getState().tasks).toHaveLength(0);
    expect(getState().pendingUndo).not.toBeNull();
    actions.undoLastDelete();
    expect(getState().tasks).toHaveLength(1);
    expect(getState().tasks[0].id).toBe(tid);
  });

  it('addSession logs; non-positive minutes are ignored', async () => {
    const { actions, getState } = await freshStore();
    actions.addSession('g1', '2026-07-02', 30, 'Studied');
    expect(getState().sessions).toHaveLength(1);
    expect(getState().sessions[0].minutes).toBe(30);
    actions.addSession('g1', '2026-07-02', 0, 'noop');
    expect(getState().sessions).toHaveLength(1);
  });

  it('removeSession schedules undo; undoLastDelete restores the log', async () => {
    const { actions, getState } = await freshStore();
    actions.addSession(null, '2026-07-02', 45);
    const sid = getState().sessions[0].id;
    actions.removeSession(sid);
    expect(getState().sessions).toHaveLength(0);
    expect(getState().pendingUndo).not.toBeNull();
    actions.undoLastDelete();
    expect(getState().sessions).toHaveLength(1);
  });

  it('removeMilestone schedules undo; undoLastDelete restores', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G', '2026-12-31');
    const gid = getState().goals[0].id;
    actions.addMilestone(gid, 'Launch', '2026-08-01');
    const mid = getState().goals[0].milestones![0].id;
    actions.removeMilestone(gid, mid);
    expect(getState().goals[0].milestones).toHaveLength(0);
    expect(getState().pendingUndo).not.toBeNull();
    actions.undoLastDelete();
    expect(getState().goals[0].milestones).toHaveLength(1);
    expect(getState().goals[0].milestones![0].id).toBe(mid);
  });

  describe('addGoals (import path)', () => {
    it('appends, re-sorts column-major, and auto-expands imported containers', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('existing', '2026-12-31'); // lands in column 0
      const imported: Goal[] = [
        {
          id: 'gi_later', title: 'Imported later', start: '2026-07-05', deadline: '2026-12-31',
          column: 2,
          nodes: [{ id: 'grp1', title: 'Group', children: [{ id: 'leaf1', title: 'Leaf', done: false }] }],
        },
        { id: 'gi_top', title: 'Imported top', start: '2026-07-05', deadline: '2026-12-31', column: 0, nodes: [] },
      ];
      actions.addGoals(imported);
      // column-major: both col-0 goals (in insertion order) before the col-2 goal
      expect(getState().goals.map((g) => g.title)).toEqual(['existing', 'Imported top', 'Imported later']);
      // container nodes from imported goals render expanded in the drawer
      expect(getState().expanded.has('grp1')).toBe(true);
    });

    it('is a no-op for an empty array', async () => {
      const { actions, getState } = await freshStore();
      const before = getState().goals;
      actions.addGoals([]);
      expect(getState().goals).toBe(before);
    });
  });

  describe('hydration', () => {
    it('starts loading and becomes ready after initStore', async () => {
      const store = await freshStore();
      expect(store.getState().hydration).toBe('loading');
      await store.initStore();
      expect(store.getState().hydration).toBe('ready');
    });

    it('reports error when the DB cannot load', async () => {
      vi.resetModules();
      const dbMod = await import('../db/db');
      vi.mocked(dbMod.loadState).mockRejectedValueOnce(new Error('idb unavailable'));
      const store = await import('./store');
      await store.initStore();
      expect(store.getState().hydration).toBe('error');
    });
  });
});
