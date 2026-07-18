import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { goalPct } from '../lib/pct';
import type { Goal, PlanReview, Session, Task } from '../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async () => ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  persist: vi.fn(async () => {}),
  exportState: vi.fn(),
  importStateFromFile: vi.fn(),
}));

vi.mock('../db/db', () => dbMocks);

async function freshStore() {
  vi.resetModules();
  return await import('./store');
}

const legacyTask: Task = {
  id: 'legacy-task', title: 'Legacy task', date: '2026-07-10', done: false, goalId: null,
};
const legacySession: Session = {
  id: 'legacy-session', goalId: null, date: '2026-07-10', minutes: 45, note: 'Legacy study log',
};

async function freshStoreWithLegacyData() {
  const { loadState, loadPlanReview } = await import('../db/db');
  const { weekOf } = await import('../lib/plan');
  const { todayStr, addDays } = await import('../lib/dates');
  const planReview: PlanReview = {
    week: addDays(weekOf(todayStr()), -7), entries: [], reviewed: true,
  };
  vi.mocked(loadState).mockResolvedValueOnce({
    goals: [], habits: [], tasks: [legacyTask], sessions: [legacySession],
  });
  vi.mocked(loadPlanReview).mockResolvedValueOnce(planReview);
  const store = await freshStore();
  await store.initStore();
  return { store, planReview };
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

  describe('planNode / unplanNode', () => {
    it('plans a leaf into a week, normalizing week and day together', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('G', '2026-12-31');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;

      // day wins: plannedWeek is derived FROM the day
      actions.planNode(gid, nid, '2026-07-01', '2026-07-15');
      let n = getState().goals[0].nodes[0];
      expect(n.plannedWeek).toBe('2026-07-13');
      expect(n.plannedDay).toBe('2026-07-15');

      // re-plan without a day clears the pin and normalizes the week
      actions.planNode(gid, nid, '2026-07-15');
      n = getState().goals[0].nodes[0];
      expect(n.plannedWeek).toBe('2026-07-13');
      expect(n.plannedDay).toBeUndefined();
    });

    it('is a no-op on containers and unknown ids', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('G', '2026-12-31');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;
      actions.addChild(nid, 'child'); // nid is now a container
      actions.planNode(gid, nid, '2026-07-13');
      expect(getState().goals[0].nodes[0].plannedWeek).toBeUndefined();
      actions.planNode('nope', 'nada', '2026-07-13'); // must not throw
    });

    it('unplanNode clears both fields with an undo window', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('G', '2026-12-31');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;
      actions.planNode(gid, nid, '2026-07-13', '2026-07-15');
      actions.unplanNode(gid, nid);
      expect(getState().goals[0].nodes[0].plannedWeek).toBeUndefined();
      expect(getState().pendingUndo).not.toBeNull();
      actions.undoLastDelete();
      expect(getState().goals[0].nodes[0].plannedWeek).toBe('2026-07-13');
      expect(getState().goals[0].nodes[0].plannedDay).toBe('2026-07-15');
    });
  });

  describe('toggleLeaf completion undo', () => {
    it('completing arms an undo that restores the unchecked state', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('G', '2026-12-31');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'Draft introduction');
      const nid = getState().goals[0].nodes[0].id;

      actions.toggleLeaf(nid);
      expect(getState().goals[0].nodes[0].done).toBe(true);
      expect(getState().pendingUndo?.label).toBe('Completed "Draft introduction" · Undo');
      actions.undoLastDelete();
      expect(getState().goals[0].nodes[0].done).toBe(false);
    });

    it('unchecking is direct — no undo toast', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('G', '2026-12-31');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;
      actions.toggleLeaf(nid);       // done
      actions.undoLastDelete();      // clear pending undo state
      actions.toggleLeaf(nid);       // done again
      actions.toggleLeaf(nid);       // uncheck
      expect(getState().goals[0].nodes[0].done).toBe(false);
    });
  });

  describe('week rollover snapshot', () => {
    // NOTE: initStore itself calls ensureWeekRollover(), so a fresh store
    // already holds an (empty, pre-reviewed) snapshot for the previous week.
    // To test snapshot CREATION with entries, drive the init path: make the
    // db mocks return a stale review and goals with leaves planned for the
    // outgoing week. Import the mocked fns from '../db/db' and use
    // vi.mocked(...).mockResolvedValueOnce BEFORE calling freshStore().

    it('snapshots the outgoing week at init when the stored review is stale', async () => {
      const { loadState, loadPlanReview } = await import('../db/db');
      const { weekOf } = await import('../lib/plan');
      const { todayStr, addDays } = await import('../lib/dates');
      const prevWeek = addDays(weekOf(todayStr()), -7);
      vi.mocked(loadState).mockResolvedValueOnce({
        goals: [{
          id: 'g1', title: 'G', start: '2026-01-01', deadline: '2026-12-31', column: 0,
          nodes: [{ id: 'n1', title: 'Old commitment', done: false, plannedWeek: prevWeek }],
        }],
        habits: [], tasks: [], sessions: [],
      });
      vi.mocked(loadPlanReview).mockResolvedValueOnce({ week: '2020-01-06', entries: [], reviewed: true });
      const store = await freshStore();
      await store.initStore();
      const { getState, actions } = store;
      const pr = getState().planReview;
      expect(pr?.week).toBe(prevWeek);
      expect(pr?.entries.map((e) => e.nodeId)).toEqual(['n1']);
      expect(pr?.reviewed).toBe(false);

      // Triage must not change the snapshot, and rollover is idempotent:
      actions.unplanNode('g1', 'n1');
      actions.ensureWeekRollover();
      expect(getState().planReview?.entries).toHaveLength(1);
    });

    it('a previous week with no commitments is born pre-reviewed', async () => {
      const store = await freshStore();
      await store.initStore(); // empty goals → empty snapshot
      const { getState } = store;
      expect(getState().planReview?.entries).toHaveLength(0);
      expect(getState().planReview?.reviewed).toBe(true);
    });

    it('markWeekReviewed flips reviewed on an unreviewed snapshot', async () => {
      const { loadState, loadPlanReview } = await import('../db/db');
      const { weekOf } = await import('../lib/plan');
      const { todayStr, addDays } = await import('../lib/dates');
      const prevWeek = addDays(weekOf(todayStr()), -7);
      vi.mocked(loadState).mockResolvedValueOnce({
        goals: [{
          id: 'g1', title: 'G', start: '2026-01-01', deadline: '2026-12-31', column: 0,
          nodes: [{ id: 'n1', title: 'leaf', done: false, plannedWeek: prevWeek }],
        }],
        habits: [], tasks: [], sessions: [],
      });
      vi.mocked(loadPlanReview).mockResolvedValueOnce(null);
      const store = await freshStore();
      await store.initStore();
      const { actions, getState } = store;
      expect(getState().planReview?.reviewed).toBe(false);
      actions.markWeekReviewed();
      expect(getState().planReview?.reviewed).toBe(true);
    });

    it('rebuilds the previous-week snapshot after importing a backup without one', async () => {
      const { loadState, loadPlanReview, importStateFromFile } = await import('../db/db');
      const { weekOf } = await import('../lib/plan');
      const { todayStr, addDays } = await import('../lib/dates');
      const prevWeek = addDays(weekOf(todayStr()), -7);

      vi.mocked(loadState).mockResolvedValueOnce({
        goals: [{
          id: 'old-goal', title: 'Old goal', start: '2026-01-01', deadline: '2026-12-31', column: 0,
          nodes: [{ id: 'old-node', title: 'Old commitment', done: false, plannedWeek: prevWeek }],
        }],
        habits: [], tasks: [], sessions: [],
      });
      vi.mocked(loadPlanReview)
        .mockResolvedValueOnce({
          week: prevWeek,
          entries: [{ nodeId: 'old-node', goalId: 'old-goal', leafTitle: 'Old commitment', goalTitle: 'Old goal' }],
          reviewed: false,
        })
        .mockResolvedValueOnce(null);
      vi.mocked(importStateFromFile).mockResolvedValueOnce({
        goals: [{
          id: 'new-goal', title: 'New goal', start: '2026-01-01', deadline: '2026-12-31', column: 0,
          nodes: [{ id: 'new-node', title: 'New commitment', done: false, plannedWeek: prevWeek }],
        }],
        habits: [], tasks: [], sessions: [], pxPerDay: 40,
      });

      const store = await freshStore();
      await store.initStore();
      await store.actions.importBackup(new File([], 'backup.json'));

      expect(store.getState().planReview).toEqual({
        week: prevWeek,
        entries: [{
          nodeId: 'new-node', goalId: 'new-goal', leafTitle: 'New commitment', goalTitle: 'New goal',
        }],
        reviewed: false,
      });
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

  describe('legacy task and session data retention', () => {
    it('hydrates non-empty legacy task and session arrays', async () => {
      const { store } = await freshStoreWithLegacyData();

      expect(store.getState().tasks).toEqual([legacyTask]);
      expect(store.getState().sessions).toEqual([legacySession]);
    });

    it('retains legacy arrays when a supported mutation persists state', async () => {
      const { store } = await freshStoreWithLegacyData();
      const { persist } = await import('../db/db');
      vi.mocked(persist).mockClear();

      store.actions.addGoal('New goal', '2026-12-31');

      expect(persist).toHaveBeenCalledOnce();
      expect(persist).toHaveBeenCalledWith(expect.objectContaining({
        tasks: [legacyTask],
        sessions: [legacySession],
      }));
      expect(store.getState().tasks).toEqual([legacyTask]);
      expect(store.getState().sessions).toEqual([legacySession]);
    });

    it('includes legacy arrays and the plan review in backup export', async () => {
      const { store, planReview } = await freshStoreWithLegacyData();
      const { exportState } = await import('../db/db');
      vi.mocked(exportState).mockClear();

      store.actions.exportBackup();

      expect(exportState).toHaveBeenCalledOnce();
      expect(exportState).toHaveBeenCalledWith({
        goals: [], habits: [], tasks: [legacyTask], sessions: [legacySession],
      }, 13, planReview);
    });
  });
});
