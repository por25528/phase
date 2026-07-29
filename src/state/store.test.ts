import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { goalPct } from '../lib/pct';
import type { Goal, PlanReview, Session, Task } from '../db/types';
import { DEFAULT_AVAILABILITY } from '../lib/availability';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async () => ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async () => [
    { dow: 0, startMin: 540, endMin: 1080 },
    { dow: 1, startMin: 540, endMin: 1080 },
    { dow: 2, startMin: 540, endMin: 1080 },
    { dow: 3, startMin: 540, endMin: 1080 },
    { dow: 4, startMin: 540, endMin: 1080 },
  ]),
  loadAllDayBlocks: vi.fn(async () => true),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAvailability: vi.fn(async () => {}),
  saveAllDayBlocks: vi.fn(async () => {}),
  persist: vi.fn(async () => {}),
  exportState: vi.fn(),
  importStateFromFile: vi.fn(),
  isSlotMigrationDone: vi.fn(async () => true),
  saveSlotMigrationSnapshot: vi.fn(async () => {}),
  markSlotMigrationDone: vi.fn(async () => {}),
}));

vi.mock('../db/db', () => dbMocks);

const tabLockMocks = vi.hoisted(() => ({
  acquireTabLock: vi.fn(async () => true),
}));

vi.mock('../lib/tabLock', () => tabLockMocks);

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
    actions.addGoal('Ship it');
    const gid = getState().goals[0].id;
    actions.addRootNode(gid, 'Step 1');
    const nid = getState().goals[0].nodes[0].id;
    expect(getState().goals[0].nodes[0].done).toBe(false);
    actions.toggleLeaf(nid);
    expect(getState().goals[0].nodes[0].done).toBe(true);
  });

  describe('persistent tasks', () => {
    it('adds a trimmed task with its supplied date and optional project', async () => {
      const { actions, getState } = await freshStore();

      actions.addTask('  Draft outline  ', '2026-07-28', 'goal-1');

      expect(getState().tasks).toEqual([
        expect.objectContaining({
          title: 'Draft outline',
          date: '2026-07-28',
          done: false,
          goalId: 'goal-1',
        }),
      ]);
      expect(getState().tasks[0].id).toBeTruthy();
    });

    it('defaults to today and no project', async () => {
      vi.setSystemTime(new Date(2026, 6, 23, 12));
      const { actions, getState } = await freshStore();

      actions.addTask('Draft outline');

      expect(getState().tasks[0]).toMatchObject({
        date: '2026-07-23',
        goalId: null,
      });
    });

    it('ignores an empty task title', async () => {
      const { actions, getState } = await freshStore();

      actions.addTask('   ');

      expect(getState().tasks).toEqual([]);
    });

    it.each(['not-a-date', '2026-02-30', '2026-7-23'])(
      'ignores a task with invalid date %s without persisting',
      async (date) => {
        const { actions, getState } = await freshStore();
        dbMocks.persist.mockClear();

        actions.addTask('Draft outline', date);

        expect(getState().tasks).toEqual([]);
        expect(dbMocks.persist).not.toHaveBeenCalled();
      },
    );

    it('records the local completion date and removes it when reopened', async () => {
      vi.setSystemTime(new Date(2026, 6, 23, 12));
      const { actions, getState } = await freshStore();
      actions.addTask('File notes');
      const taskId = getState().tasks[0].id;

      actions.toggleTask(taskId);
      expect(getState().tasks[0]).toMatchObject({ done: true, doneAt: '2026-07-23' });

      actions.toggleTask(taskId);
      expect(getState().tasks[0].done).toBe(false);
      expect(getState().tasks[0].doneAt).toBeUndefined();
    });

    it('reschedules a task', async () => {
      const { actions, getState } = await freshStore();
      actions.addTask('File notes', '2026-07-23');
      const taskId = getState().tasks[0].id;

      actions.rescheduleTask(taskId, '2026-07-25');

      expect(getState().tasks[0].date).toBe('2026-07-25');
    });

    it.each(['not-a-date', '2026-02-30', '2026-7-23'])(
      'ignores invalid reschedule date %s without persisting',
      async (date) => {
        const { actions, getState } = await freshStore();
        actions.addTask('File notes', '2026-07-23');
        const taskId = getState().tasks[0].id;
        dbMocks.persist.mockClear();

        actions.rescheduleTask(taskId, date);

        expect(getState().tasks[0].date).toBe('2026-07-23');
        expect(dbMocks.persist).not.toHaveBeenCalled();
      },
    );

    it('does not persist unchanged or missing task reschedules', async () => {
      const { actions, getState } = await freshStore();
      actions.addTask('File notes', '2026-07-23');
      const taskId = getState().tasks[0].id;
      dbMocks.persist.mockClear();

      actions.rescheduleTask(taskId, '2026-07-23');
      actions.rescheduleTask('missing', '2026-07-24');

      expect(dbMocks.persist).not.toHaveBeenCalled();
    });

    it('removes a task with undo support and restores the same id', async () => {
      const { actions, getState } = await freshStore();
      actions.addTask('File notes');
      const taskId = getState().tasks[0].id;

      actions.removeTask(taskId);
      expect(getState().tasks).toEqual([]);
      expect(getState().pendingUndo?.label).toBe('Deleted "File notes" · Undo');

      actions.undoLastDelete();
      expect(getState().tasks).toHaveLength(1);
      expect(getState().tasks[0].id).toBe(taskId);
    });

    it('undoes only the deleted task while preserving intervening task mutations', async () => {
      const { actions, getState } = await freshStore();
      actions.addTask('A', '2026-07-23');
      actions.addTask('B', '2026-07-23');
      const [aId, bId] = getState().tasks.map((task) => task.id);

      actions.removeTask(aId);
      actions.toggleTask(bId);
      actions.rescheduleTask(bId, '2026-07-26');
      actions.addTask('C', '2026-07-25');
      actions.undoLastDelete();

      expect(getState().tasks.map((task) => task.id)).toEqual([
        aId,
        bId,
        expect.any(String),
      ]);
      expect(getState().tasks[1]).toMatchObject({
        id: bId,
        done: true,
        date: '2026-07-26',
      });
      expect(getState().tasks[2].title).toBe('C');
    });

    it('unknown task actions are no-ops without persistence', async () => {
      const { actions } = await freshStore();
      dbMocks.persist.mockClear();

      actions.toggleTask('missing');
      actions.removeTask('missing');

      expect(dbMocks.persist).not.toHaveBeenCalled();
    });
  });

  it('new goals default to column 0 and sort ahead of higher columns', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('A');
    actions.addGoal('B');
    const [a, b] = getState().goals;
    // both column 0, insertion order preserved
    expect(a.column).toBe(0);
    expect(b.column).toBe(0);
    // push B to column 2 via the board, then add C — C (col 0) must sort before B
    actions.setGoalBoard([[a.id], [], [b.id], []]);
    actions.addGoal('C');
    const order = getState().goals.map((g) => g.title);
    const cols = getState().goals.map((g) => g.column);
    expect(order).toEqual(['A', 'C', 'B']); // column-major: col0 (A, C) then col2 (B)
    expect(cols).toEqual([0, 0, 2]);
  });

  it('setGoalBoard rebuilds goals in column-major order and stamps columns', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('one');
    actions.addGoal('two');
    actions.addGoal('three');
    const [g1, g2, g3] = getState().goals.map((g) => g.id);
    // three across columns: g3 highest (col0), g1 col1 top, g2 col1 below
    actions.setGoalBoard([[g3], [g1, g2], [], []]);
    const goals = getState().goals;
    expect(goals.map((g) => g.id)).toEqual([g3, g1, g2]);
    expect(goals.map((g) => g.column)).toEqual([0, 1, 1]);
  });

  it('setGoalBoard never drops a goal missing from the layout', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('keep');
    actions.addGoal('orphan');
    const [keep, orphan] = getState().goals.map((g) => g.id);
    actions.setGoalBoard([[keep], [], [], []]); // orphan omitted
    const ids = getState().goals.map((g) => g.id);
    expect(ids).toContain(keep);
    expect(ids).toContain(orphan);
    expect(ids).toHaveLength(2);
  });

  it('addChild converts a leaf into a container (done removed, parent expanded)', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G');
    const gid = getState().goals[0].id;
    actions.addRootNode(gid, 'leaf');
    const nid = getState().goals[0].nodes[0].id;
    actions.addChild(nid, 'child');
    const node = getState().goals[0].nodes[0];
    expect(node.done).toBeUndefined();
    expect(node.children).toHaveLength(1);
    expect(getState().expanded.has(nid)).toBe(true);
  });

  it('addChild clears a completed leaf completion timestamp', async () => {
    vi.setSystemTime(new Date(2026, 6, 23, 12));
    const { actions, getState } = await freshStore();
    actions.addGoal('G');
    const gid = getState().goals[0].id;
    actions.addRootNode(gid, 'leaf');
    const nid = getState().goals[0].nodes[0].id;
    actions.toggleLeaf(nid);

    actions.addChild(nid, 'child');

    const node = getState().goals[0].nodes[0];
    expect(node.done).toBeUndefined();
    expect(node.doneAt).toBeUndefined();
  });

  describe('addChild clears planning fields', () => {
    it('a planned leaf that gains a child loses done/plannedWeek/plannedDay', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
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
    actions.addGoal('G');
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
    actions.addGoal('G');
    actions.removeGoal(getState().goals[0].id);
    expect(getState().goals).toHaveLength(0);
    expect(getState().pendingUndo).not.toBeNull();
    actions.undoLastDelete();
    expect(getState().goals).toHaveLength(1);
    expect(getState().pendingUndo).toBeNull();
  });

  it('undo window expires after 5s', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G');
    actions.removeGoal(getState().goals[0].id);
    vi.advanceTimersByTime(5000);
    expect(getState().pendingUndo).toBeNull();
    actions.undoLastDelete();
    expect(getState().goals).toHaveLength(0); // nothing restored
  });

  it('addGoal creates a confirmed project without fake dates', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('No fake deadline');
    expect(getState().goals[0]).toMatchObject({
      title: 'No fake deadline',
      datesConfirmed: true,
    });
    expect(getState().goals[0].start).toBeUndefined();
    expect(getState().goals[0].deadline).toBeUndefined();
  });

  it('confirms only the selected legacy project dates', async () => {
    const { loadState } = await import('../db/db');
    vi.mocked(loadState).mockResolvedValueOnce({
      goals: [
        {
          id: 'a', title: 'Legacy A', start: '2026-07-01', deadline: '2026-12-31',
          nodes: [],
        },
        {
          id: 'b', title: 'Legacy B', start: '2026-07-02', deadline: '2026-12-31',
          nodes: [],
        },
      ],
      habits: [], tasks: [], sessions: [],
    });
    const store = await freshStore();
    await store.initStore();
    dbMocks.persist.mockClear();

    store.actions.confirmGoalDates('a');

    expect(store.getState().goals.find((g) => g.id === 'a')?.datesConfirmed).toBe(true);
    expect(store.getState().goals.find((g) => g.id === 'b')?.datesConfirmed).toBeUndefined();
    expect(dbMocks.persist).toHaveBeenCalledOnce();
  });

  it('does not confirm or persist invalid legacy project dates', async () => {
    const { loadState } = await import('../db/db');
    vi.mocked(loadState).mockResolvedValueOnce({
      goals: [{
        id: 'bad', title: 'Bad legacy dates', start: '2026-12-31', deadline: '2026-01-01',
        nodes: [],
      }],
      habits: [], tasks: [], sessions: [],
    });
    const store = await freshStore();
    await store.initStore();
    dbMocks.persist.mockClear();

    store.actions.confirmGoalDates('bad');

    expect(store.getState().goals[0].datesConfirmed).toBeUndefined();
    expect(dbMocks.persist).not.toHaveBeenCalled();
  });

  it('dismisses date review only for the current session', async () => {
    const { actions, getState } = await freshStore();
    expect(getState().dateReviewDismissed).toBe(false);
    dbMocks.persist.mockClear();

    actions.dismissDateReview();

    expect(getState().dateReviewDismissed).toBe(true);
    expect(dbMocks.persist).not.toHaveBeenCalled();
  });

  it('setGoalDates rejects inverted spans atomically', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G');
    const gid = getState().goals[0].id;
    expect(actions.setGoalDates(gid, '2026-10-01', '2026-02-01')).toBe(false);
    expect(getState().goals[0].start).toBeUndefined();
    expect(getState().goals[0].deadline).toBeUndefined();
  });

  it('setGoalDates rejects invalid supplied values atomically without persisting', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G');
    const gid = getState().goals[0].id;
    dbMocks.persist.mockClear();

    expect(actions.setGoalDates(gid, '2026-02-30', '2026-12-31')).toBe(false);
    expect(actions.setGoalDates(gid, undefined, 'tomorrow')).toBe(false);
    expect(getState().goals[0].start).toBeUndefined();
    expect(getState().goals[0].deadline).toBeUndefined();
    expect(getState().pendingUndo).toBeNull();
    expect(dbMocks.persist).not.toHaveBeenCalled();
  });

  it('setGoalDates independently sets and deletes dates, confirms, persists, and supports undo', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G');
    const gid = getState().goals[0].id;
    dbMocks.persist.mockClear();

    expect(actions.setGoalDates(gid, undefined, '2026-09-01')).toBe(true);
    expect(getState().goals[0]).toMatchObject({
      deadline: '2026-09-01',
      datesConfirmed: true,
    });
    expect(getState().goals[0].start).toBeUndefined();

    expect(actions.setGoalDates(gid, '2026-08-01', undefined)).toBe(true);
    expect(getState().goals[0].start).toBe('2026-08-01');
    expect(getState().goals[0].deadline).toBeUndefined();
    expect(getState().pendingUndo?.label).toBe('Updated dates for "G" · Undo');
    expect(dbMocks.persist).toHaveBeenCalledTimes(2);

    actions.undoLastDelete();
    expect(getState().goals[0].start).toBeUndefined();
    expect(getState().goals[0].deadline).toBe('2026-09-01');
  });

  it('setNodeDates sets both dates, ordered via clampSpan', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G');
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
    actions.addGoal('G');
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
    actions.addGoal('G');
    const gid = getState().goals[0].id;
    actions.setNodeDates(gid, 'nope', '2026-03-01', '2026-03-15');
    expect(getState().goals[0].nodes).toHaveLength(0);
    actions.setNodeDates('nope', 'nope', '2026-03-01', '2026-03-15');
    expect(getState().goals).toHaveLength(1);
  });

  it('clearNodeDates removes both start and deadline', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G');
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
    actions.addGoal('G');
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
    actions.addGoal('G');
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
      actions.addGoal('existing'); // lands in column 0
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
      actions.addGoal('G');
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
      actions.addGoal('G');
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
      actions.addGoal('G');
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
    it('records the local completion date and removes it when unchecked', async () => {
      vi.setSystemTime(new Date(2026, 6, 23, 12));
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;

      actions.toggleLeaf(nid);
      expect(getState().goals[0].nodes[0]).toMatchObject({
        done: true,
        doneAt: '2026-07-23',
      });

      actions.toggleLeaf(nid);
      expect(getState().goals[0].nodes[0].done).toBe(false);
      expect(getState().goals[0].nodes[0].doneAt).toBeUndefined();
    });

    it('ignores a stale completion toggle for a container without persisting', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'container');
      const nid = getState().goals[0].nodes[0].id;
      actions.addChild(nid, 'child');
      dbMocks.persist.mockClear();

      actions.toggleLeaf(nid);

      expect(getState().goals[0].nodes[0].done).toBeUndefined();
      expect(dbMocks.persist).not.toHaveBeenCalled();
    });

    it('treats children: [] as a leaf for completion and reopening', async () => {
      vi.setSystemTime(new Date(2026, 6, 23, 12));
      const { actions, getState } = await freshStore();
      actions.addGoals([{
        id: 'g',
        title: 'G',
        nodes: [{ id: 'leaf', title: 'Leaf', children: [], done: false }],
      }]);

      actions.toggleLeaf('leaf');
      expect(getState().goals[0].nodes[0]).toMatchObject({
        done: true,
        doneAt: '2026-07-23',
        children: [],
      });

      actions.toggleLeaf('leaf');
      expect(getState().goals[0].nodes[0]).toMatchObject({
        done: false,
        children: [],
      });
      expect(getState().goals[0].nodes[0].doneAt).toBeUndefined();
    });

    it('completing arms an undo that restores the unchecked state', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
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
      actions.addGoal('G');
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

    it('makes an action-triggered rollover synchronously observable', async () => {
      const { actions, getState } = await freshStore();
      const { weekOf } = await import('../lib/plan');
      const { todayStr, addDays } = await import('../lib/dates');
      const prevWeek = addDays(weekOf(todayStr()), -7);
      actions.addGoal('G');
      const goalId = getState().goals[0].id;
      actions.addRootNode(goalId, 'Outgoing commitment');
      const nodeId = getState().goals[0].nodes[0].id;
      actions.planNode(goalId, nodeId, prevWeek);

      actions.ensureWeekRollover();

      expect(getState().planReview).toMatchObject({
        week: prevWeek,
        entries: [{ nodeId }],
        reviewed: false,
      });
    });

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
        availability: DEFAULT_AVAILABILITY, allDayBlocks: true,
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

    it('hydrates legacy goal and task records without inventing optional fields', async () => {
      const { loadState } = await import('../db/db');
      vi.mocked(loadState).mockResolvedValueOnce({
        goals: [{
          id: 'legacy-goal',
          title: 'Legacy goal',
          start: '2026-01-01',
          deadline: '2026-12-31',
          nodes: [{ id: 'legacy-leaf', title: 'Done before timestamps', done: true }],
          column: 0,
        }],
        habits: [],
        tasks: [{
          id: 'legacy-task',
          title: 'Done before timestamps',
          date: '2026-07-05',
          done: true,
          goalId: null,
        }],
        sessions: [],
      });

      const store = await freshStore();
      await store.initStore();

      const [legacyGoal] = store.getState().goals;
      const [legacyTask] = store.getState().tasks;
      expect(legacyGoal.datesConfirmed).toBeUndefined();
      expect(legacyGoal.nodes[0].doneAt).toBeUndefined();
      expect(legacyTask.doneAt).toBeUndefined();
      expect(legacyGoal).not.toHaveProperty('datesConfirmed');
      expect(legacyGoal.nodes[0]).not.toHaveProperty('doneAt');
      expect(legacyTask).not.toHaveProperty('doneAt');
    });

    it('reports error when the DB cannot load', async () => {
      vi.resetModules();
      const dbMod = await import('../db/db');
      vi.mocked(dbMod.loadState).mockRejectedValueOnce(new Error('idb unavailable'));
      const store = await import('./store');
      await store.initStore();
      expect(store.getState().hydration).toBe('error');
    });

    describe('one-shot slot migration', () => {
      beforeEach(async () => {
        const dbMod = await import('../db/db');
        vi.mocked(dbMod.saveSlotMigrationSnapshot).mockClear();
        vi.mocked(dbMod.markSlotMigrationDone).mockClear();
        vi.mocked(dbMod.persist).mockClear();
        vi.mocked(dbMod.isSlotMigrationDone).mockClear();
        vi.mocked(dbMod.loadState).mockClear();
      });

      it('skips snapshot/persist/mark-done entirely once already done', async () => {
        const store = await freshStore();
        const dbMod = await import('../db/db');
        vi.mocked(dbMod.isSlotMigrationDone).mockResolvedValueOnce(true);

        await store.initStore();

        expect(store.getState().hydration).toBe('ready');
        expect(dbMod.saveSlotMigrationSnapshot).not.toHaveBeenCalled();
        expect(dbMod.markSlotMigrationDone).not.toHaveBeenCalled();
      });

      it('snapshots, migrates, persists, then marks done, in that order, when not yet done', async () => {
        const store = await freshStore();
        const dbMod = await import('../db/db');
        vi.mocked(dbMod.isSlotMigrationDone).mockResolvedValueOnce(false);
        vi.mocked(dbMod.loadState).mockResolvedValueOnce({
          goals: [], habits: [], tasks: [], sessions: [],
        });

        const calls: string[] = [];
        vi.mocked(dbMod.saveSlotMigrationSnapshot).mockImplementationOnce(async () => {
          calls.push('snapshot');
        });
        vi.mocked(dbMod.persist).mockImplementationOnce(async () => {
          calls.push('persist');
        });
        vi.mocked(dbMod.markSlotMigrationDone).mockImplementationOnce(async () => {
          calls.push('markDone');
        });

        await store.initStore();

        expect(store.getState().hydration).toBe('ready');
        expect(calls).toEqual(['snapshot', 'persist', 'markDone']);
      });

      it('never marks done if persist throws, so a retry is possible next launch', async () => {
        const store = await freshStore();
        const dbMod = await import('../db/db');
        vi.mocked(dbMod.isSlotMigrationDone).mockResolvedValueOnce(false);
        vi.mocked(dbMod.loadState).mockResolvedValueOnce({
          goals: [], habits: [], tasks: [], sessions: [],
        });
        vi.mocked(dbMod.persist).mockRejectedValueOnce(new Error('write failed'));

        await store.initStore();

        // The existing catch in initStore refuses to render on any failure,
        // including one raised mid-migration — leaving the flag unset.
        expect(store.getState().hydration).toBe('error');
        expect(dbMod.saveSlotMigrationSnapshot).toHaveBeenCalled();
        expect(dbMod.markSlotMigrationDone).not.toHaveBeenCalled();
      });

      // Real, non-empty data — an open leaf committed to a day but never given
      // a clock time — so the object handed to `persist` and the resulting
      // store state both must carry the MIGRATED node. A stub that swaps in
      // `appState` instead of `migrated` anywhere along the chain would leave
      // `plannedStartMin` absent and this test would catch it.
      //
      // Expected minute derived from the real implementation, not guessed:
      // '2026-07-15' is a Wednesday (dow 2), whose mocked availability window
      // is [540, 1080) with nothing else occupying the day. `migrateSlots`
      // places at `aimMin: window.startMin` (see lib/migrateSlots.ts +
      // lib/slot.ts resolveSlot), so the leaf lands at minute 540 exactly.
      it('hands persist the migrated node, and the store state reflects it too', async () => {
        const store = await freshStore();
        const dbMod = await import('../db/db');
        vi.mocked(dbMod.isSlotMigrationDone).mockResolvedValueOnce(false);
        vi.mocked(dbMod.loadState).mockResolvedValueOnce({
          goals: [{
            id: 'g1', title: 'Real goal', column: 0,
            nodes: [{
              id: 'leaf1', title: 'Real leaf', done: false,
              plannedWeek: '2026-07-13', plannedDay: '2026-07-15',
            }],
          }],
          habits: [], tasks: [], sessions: [],
        });

        await store.initStore();

        expect(dbMod.persist).toHaveBeenCalledWith(
          expect.objectContaining({
            goals: [expect.objectContaining({
              id: 'g1',
              nodes: [expect.objectContaining({
                id: 'leaf1',
                plannedStartMin: 540,
                plannedDay: '2026-07-15',
              })],
            })],
          }),
        );
        const node = store.getState().goals[0].nodes[0];
        expect(node.plannedStartMin).toBe(540);
        expect(node.plannedDay).toBe('2026-07-15');
      });

      // describeMigration returns null for a no-op migration and a string
      // whenever something actually moved. The toast line in initStore must
      // fire on the latter and stay silent on the former.
      it('shows the migration toast when something actually moved, and no toast for a no-op', async () => {
        const store = await freshStore();
        const dbMod = await import('../db/db');
        vi.mocked(dbMod.isSlotMigrationDone).mockResolvedValueOnce(false);
        vi.mocked(dbMod.loadState).mockResolvedValueOnce({
          goals: [{
            id: 'g1', title: 'Real goal', column: 0,
            nodes: [{
              id: 'leaf1', title: 'Real leaf', done: false,
              plannedWeek: '2026-07-13', plannedDay: '2026-07-15',
            }],
          }],
          habits: [], tasks: [], sessions: [],
        });

        await store.initStore();

        expect(store.getState().toast).toBe('1 item placed on the calendar');
      });

      it('shows no toast when the migration is a no-op', async () => {
        const store = await freshStore();
        const dbMod = await import('../db/db');
        vi.mocked(dbMod.isSlotMigrationDone).mockResolvedValueOnce(false);
        vi.mocked(dbMod.loadState).mockResolvedValueOnce({
          goals: [], habits: [], tasks: [], sessions: [],
        });

        await store.initStore();

        expect(store.getState().toast).toBeNull();
      });
    });

    describe('tab lock gates the migration', () => {
      beforeEach(async () => {
        const dbMod = await import('../db/db');
        vi.mocked(dbMod.saveSlotMigrationSnapshot).mockClear();
        vi.mocked(dbMod.markSlotMigrationDone).mockClear();
        vi.mocked(dbMod.persist).mockClear();
        vi.mocked(dbMod.isSlotMigrationDone).mockClear();
        vi.mocked(tabLockMocks.acquireTabLock).mockClear();
        vi.mocked(tabLockMocks.acquireTabLock).mockResolvedValue(true);
      });

      afterEach(async () => {
        // Drain any Once value queued below that the gate's short-circuit
        // left unconsumed, so it can never leak into a later, unrelated test.
        const dbMod = await import('../db/db');
        vi.mocked(dbMod.isSlotMigrationDone).mockResolvedValue(true);
      });

      it('a non-owning tab renders normally without migrating', async () => {
        const store = await freshStore();
        const dbMod = await import('../db/db');
        // isSlotMigrationDone resolves false (migration not yet done) so the
        // ONLY thing that can prevent migration here is the tab-lock gate —
        // if that gate were removed, this would proceed to migrate anyway.
        // Queued as the persistent (non-Once) default for the rest of this
        // test only; the afterEach above restores the safe default so a
        // short-circuited, unconsumed value can never leak into later tests.
        vi.mocked(dbMod.isSlotMigrationDone).mockResolvedValue(false);
        vi.mocked(tabLockMocks.acquireTabLock).mockResolvedValueOnce(false);

        await store.initStore();

        expect(store.getState().hydration).toBe('ready');
        expect(store.getState().secondTab).toBe(true);
        expect(dbMod.saveSlotMigrationSnapshot).not.toHaveBeenCalled();
        expect(dbMod.persist).not.toHaveBeenCalled();
        expect(dbMod.markSlotMigrationDone).not.toHaveBeenCalled();
      });

      it('the owning tab migrates as usual', async () => {
        const store = await freshStore();
        const dbMod = await import('../db/db');
        vi.mocked(dbMod.isSlotMigrationDone).mockResolvedValueOnce(false);
        vi.mocked(tabLockMocks.acquireTabLock).mockResolvedValueOnce(true);

        await store.initStore();

        expect(store.getState().hydration).toBe('ready');
        expect(store.getState().secondTab).toBe(false);
        expect(dbMod.saveSlotMigrationSnapshot).toHaveBeenCalled();
        expect(dbMod.markSlotMigrationDone).toHaveBeenCalled();
      });
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

      store.actions.addGoal('New goal');

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
      }, 13, planReview, store.getState().availability, store.getState().allDayBlocks);
    });
  });

  describe('completion lifecycle', () => {
    it('completeGoal sets completedAt and is undo-aware; reopen is its inverse', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('A');
      const gid = getState().goals[0].id;
      actions.completeGoal(gid);
      expect(getState().goals[0].completedAt).toBeTruthy();
      actions.undoLastDelete();
      expect(getState().goals[0].completedAt).toBeUndefined();
      actions.completeGoal(gid);
      actions.reopenGoal(gid);
      expect(getState().goals[0].completedAt).toBeUndefined();
    });

    it('preserves horizon and position across complete → reorder actives → reopen', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('A');
      actions.addGoal('B');
      actions.addGoal('C');
      const [a, b, c] = getState().goals;
      actions.completeGoal(b.id);
      // Board shows actives [A, C]; user reorders to [C, A].
      actions.setGoalBoard([[c.id, a.id], [], [], []]);
      // Completed B stays woven at its within-column index, not appended to the end.
      expect(getState().goals.map((g) => g.id)).toEqual([c.id, b.id, a.id]);
      actions.reopenGoal(b.id);
      expect(getState().goals.map((g) => g.id)).toEqual([c.id, b.id, a.id]);
      expect(getState().goals.every((g) => (g.column ?? 0) === 0)).toBe(true);
    });

    it('freezes structural edits on a completed project but allows metadata and moves', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('A');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'Step');
      const nid = getState().goals[0].nodes[0].id;
      actions.completeGoal(gid);

      // Frozen: nothing that changes progress or actionable structure.
      actions.toggleLeaf(nid);
      expect(getState().goals[0].nodes[0].done).toBe(false);
      actions.addRootNode(gid, 'Another');
      expect(getState().goals[0].nodes).toHaveLength(1);
      actions.planNode(gid, nid, '2026-07-13');
      expect(getState().goals[0].nodes[0].plannedWeek).toBeUndefined();
      actions.removeNode(nid);
      expect(getState().goals[0].nodes).toHaveLength(1);

      // Allowed: metadata + horizon move.
      actions.renameGoal(gid, 'Renamed');
      expect(getState().goals[0].title).toBe('Renamed');
      actions.moveGoalToColumn(gid, 2);
      expect(getState().goals.find((g) => g.id === gid)?.column).toBe(2);
    });

    it('moveGoalToColumn matches drag order and leaves others in place', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('A');
      actions.addGoal('B');
      actions.addGoal('C');
      const [a, b, c] = getState().goals;
      actions.moveGoalToColumn(b.id, 2);
      expect(getState().goals.map((g) => g.id)).toEqual([a.id, c.id, b.id]);
      expect(getState().goals.map((g) => g.column)).toEqual([0, 0, 2]);
    });
  });
});

describe('openDrawer node focus (T8)', () => {
  const nested: Goal = {
    id: 'gp', title: 'Project', start: '2026-01-01', deadline: '2026-12-31', column: 0,
    nodes: [
      { id: 'root-a', title: 'Root A', children: [
        { id: 'mid', title: 'Mid', children: [{ id: 'leaf', title: 'Leaf', done: false }] },
      ] },
    ],
  };

  it('focuses a node: sets openGoalId + drawerFocusNodeId and re-expands its ancestor containers', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.toggleExpand('root-a'); // collapse what addGoals auto-expanded
    actions.toggleExpand('mid');
    expect(getState().expanded.has('root-a')).toBe(false);

    actions.openDrawer('gp', 'leaf');
    const s = getState();
    expect(s.openGoalId).toBe('gp');
    expect(s.drawerFocusNodeId).toBe('leaf');
    expect(s.expanded.has('root-a')).toBe(true);
    expect(s.expanded.has('mid')).toBe(true);
  });

  it('opens at the root when no node is given', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openDrawer('gp');
    expect(getState().openGoalId).toBe('gp');
    expect(getState().drawerFocusNodeId).toBeNull();
  });

  it('ignores an unknown node id but still opens the project', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openDrawer('gp', 'ghost');
    expect(getState().openGoalId).toBe('gp');
    expect(getState().drawerFocusNodeId).toBeNull();
  });

  it('closeDrawer clears both the open project and the focus node', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openDrawer('gp', 'leaf');
    actions.closeDrawer();
    expect(getState().openGoalId).toBeNull();
    expect(getState().drawerFocusNodeId).toBeNull();
  });
});

describe('addChildren (AI daily subtasks)', () => {
  const withStep: Goal = {
    id: 'g', title: 'G', start: '2026-01-01', deadline: '2026-12-31', column: 0,
    nodes: [{ id: 'n', title: 'Step', done: false, plannedWeek: '2026-07-13', plannedDay: '2026-07-15' }],
  };

  it('appends several children, converting a leaf to a container and clearing its plan fields', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([withStep]);
    actions.addChildren('n', ['Sub A', '  Sub B  ', '', '   ']);
    const node = getState().goals[0].nodes[0];
    expect(node.children?.map((c) => c.title)).toEqual(['Sub A', 'Sub B']); // trimmed, blanks dropped
    expect(node.done).toBeUndefined();
    expect(node.plannedWeek).toBeUndefined();
    expect(node.plannedDay).toBeUndefined();
    expect(getState().expanded.has('n')).toBe(true);
  });

  it('clears completion timestamps when converting a completed leaf into a container', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([{
      ...withStep,
      nodes: [{ ...withStep.nodes[0], done: true, doneAt: '2026-07-22' }],
    }]);

    actions.addChildren('n', ['Sub A']);

    const node = getState().goals[0].nodes[0];
    expect(node.done).toBeUndefined();
    expect(node.doneAt).toBeUndefined();
  });

  it('is a no-op for an all-blank list and for a completed (frozen) project', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([withStep]);
    actions.addChildren('n', ['   ', '']);
    expect(getState().goals[0].nodes[0].children).toBeUndefined();
    actions.completeGoal('g');
    actions.addChildren('n', ['X']);
    expect(getState().goals[0].nodes[0].children).toBeUndefined();
  });
});

describe('deferOpenToNextWeek', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pushes overdue tasks and slipped steps to next week, undoably', async () => {
    vi.setSystemTime(new Date(2026, 6, 23, 12)); // Thu 2026-07-23 → week 07-20, next 07-27
    const { actions, getState } = await freshStore();
    actions.addGoals([{
      id: 'g', title: 'G', column: 0, datesConfirmed: true,
      nodes: [{ id: 'slipped', title: 'Slipped', plannedWeek: '2026-07-13', plannedDay: '2026-07-15' }],
    }]);
    actions.addTask('Overdue', '2026-07-21');
    actions.addTask('Future', '2026-07-30');
    const overdueId = getState().tasks.find((t) => t.title === 'Overdue')!.id;

    actions.deferOpenToNextWeek();

    expect(getState().tasks.find((t) => t.id === overdueId)!.date).toBe('2026-07-27');
    expect(getState().tasks.find((t) => t.title === 'Future')!.date).toBe('2026-07-30');
    const step = getState().goals[0].nodes[0];
    expect(step.plannedWeek).toBe('2026-07-27');
    expect(step.plannedDay).toBeUndefined();
    expect(getState().pendingUndo).not.toBeNull();

    actions.undoLastDelete();
    expect(getState().tasks.find((t) => t.id === overdueId)!.date).toBe('2026-07-21');
    expect(getState().goals[0].nodes[0].plannedWeek).toBe('2026-07-13');
    expect(getState().goals[0].nodes[0].plannedDay).toBe('2026-07-15');
  });

  it('is a no-op when nothing is open (no undo armed)', async () => {
    vi.setSystemTime(new Date(2026, 6, 23, 12));
    const { actions, getState } = await freshStore();
    actions.addTask('Today', '2026-07-23');

    actions.deferOpenToNextWeek();

    expect(getState().pendingUndo).toBeNull();
    expect(getState().tasks[0].date).toBe('2026-07-23');
  });
});

describe('confirmAllGoalDates', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('confirms every valid unconfirmed project, leaving inverted spans for review', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([
      { id: 'a', title: 'A', column: 0, nodes: [], start: '2026-01-01', deadline: '2026-06-01' },
      { id: 'b', title: 'B', column: 0, nodes: [], start: '2026-02-01', deadline: '2026-07-01' },
      { id: 'bad', title: 'Bad', column: 0, nodes: [], start: '2026-08-01', deadline: '2026-01-01' },
    ]);

    actions.confirmAllGoalDates();

    const byId = new Map(getState().goals.map((g) => [g.id, g.datesConfirmed]));
    expect(byId.get('a')).toBe(true);
    expect(byId.get('b')).toBe(true);
    expect(byId.get('bad')).toBeUndefined();
    expect(getState().pendingUndo).not.toBeNull();

    actions.undoLastDelete();
    expect(getState().goals.find((g) => g.id === 'a')!.datesConfirmed).toBeUndefined();
  });

  it('is a no-op when nothing is confirmable', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('plain'); // datesConfirmed already true, no dates

    actions.confirmAllGoalDates();

    expect(getState().pendingUndo).toBeNull();
  });
});

describe('addSampleProject', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('seeds one confirmed example onto the board with its container expanded', async () => {
    vi.setSystemTime(new Date(2026, 6, 23, 12));
    const { actions, getState } = await freshStore();

    actions.addSampleProject();

    const goals = getState().goals;
    expect(goals).toHaveLength(1);
    expect(goals[0].datesConfirmed).toBe(true);
    const container = goals[0].nodes.find((n) => n.children && n.children.length > 0)!;
    expect(getState().expanded.has(container.id)).toBe(true);
  });
});

describe('toggleHabitOn (backfill)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function storeWithHabit() {
    const { loadState } = await import('../db/db');
    vi.mocked(loadState).mockResolvedValueOnce({
      goals: [], sessions: [], tasks: [],
      habits: [{
        id: 'h', title: 'Read', cadence: 'daily', weeklyTarget: 4,
        goalId: null, checkins: [], createdAt: '2026-07-01',
      }],
    });
    const store = await freshStore();
    await store.initStore();
    return store;
  }

  it('backfills and clears a past day, but refuses future and pre-creation days', async () => {
    vi.setSystemTime(new Date(2026, 6, 23, 12)); // 2026-07-23
    const { actions, getState } = await storeWithHabit();

    actions.toggleHabitOn('h', '2026-07-22');
    expect(getState().habits[0].checkins).toContain('2026-07-22');

    actions.toggleHabitOn('h', '2026-07-22'); // toggling again clears it
    expect(getState().habits[0].checkins).not.toContain('2026-07-22');

    actions.toggleHabitOn('h', '2026-07-24'); // future — refused
    actions.toggleHabitOn('h', '2026-06-30'); // before it began — refused
    expect(getState().habits[0].checkins).toEqual([]);
  });

  it('toggleHabit still toggles today through the same path', async () => {
    vi.setSystemTime(new Date(2026, 6, 23, 12));
    const { actions, getState } = await storeWithHabit();

    actions.toggleHabit('h');
    expect(getState().habits[0].checkins).toEqual(['2026-07-23']);
  });
});

describe('plan overlay', () => {
  it('openPlan opens the overlay and records the focus target', async () => {
    const { actions, getState } = await freshStore();
    expect(getState().planOpen).toBe(false);
    expect(getState().planFocusGoalId).toBeNull();
    actions.openPlan('g1');
    expect(getState().planOpen).toBe(true);
    expect(getState().planFocusGoalId).toBe('g1');
  });

  it('openPlan with no argument opens the overlay focused on nothing', async () => {
    const { actions, getState } = await freshStore();
    actions.openPlan();
    expect(getState().planOpen).toBe(true);
    expect(getState().planFocusGoalId).toBeNull();
  });

  it('closePlan clears both the overlay flag and the focus target', async () => {
    const { actions, getState } = await freshStore();
    actions.openPlan('g1');
    actions.closePlan();
    expect(getState().planOpen).toBe(false);
    expect(getState().planFocusGoalId).toBeNull();
  });

  describe('addChild and addChildren clear leaf-only fields when creating a container', () => {
    it('addChild drops estimateMin when a leaf becomes a container', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('Test Goal');
      const goalId = getState().goals[0].id;
      actions.addRootNode(goalId, 'Leaf with estimate');
      const nodeId = getState().goals[0].nodes[0].id;
      // Manually set estimateMin on the leaf
      const goals = getState().goals;
      goals[0].nodes[0].estimateMin = 120;

      actions.addChild(nodeId, 'New child');

      const container = getState().goals[0].nodes[0];
      expect(container.children).toBeDefined();
      expect(container.children!.length).toBe(1);
      expect(container.estimateMin).toBeUndefined();
    });

    it('addChildren drops estimateMin when a leaf becomes a container', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('Test Goal');
      const goalId = getState().goals[0].id;
      actions.addRootNode(goalId, 'Leaf with estimate');
      const nodeId = getState().goals[0].nodes[0].id;
      // Manually set estimateMin on the leaf
      const goals = getState().goals;
      goals[0].nodes[0].estimateMin = 150;

      actions.addChildren(nodeId, ['Child 1', 'Child 2']);

      const container = getState().goals[0].nodes[0];
      expect(container.children).toBeDefined();
      expect(container.children!.length).toBe(2);
      expect(container.estimateMin).toBeUndefined();
    });
  });
});

describe('availability and all-day preference (device settings)', () => {
  it('hydrates availability and allDayBlocks from the db on init', async () => {
    const { actions: _actions, getState, initStore } = await freshStore();
    await initStore();
    expect(getState().availability).toEqual([
      { dow: 0, startMin: 540, endMin: 1080 },
      { dow: 1, startMin: 540, endMin: 1080 },
      { dow: 2, startMin: 540, endMin: 1080 },
      { dow: 3, startMin: 540, endMin: 1080 },
      { dow: 4, startMin: 540, endMin: 1080 },
    ]);
    expect(getState().allDayBlocks).toBe(true);
  });

  it('setAvailability updates state and persists the new windows', async () => {
    const { actions, getState } = await freshStore();
    dbMocks.saveAvailability.mockClear();
    const windows = [{ dow: 2, startMin: 600, endMin: 720 }];

    actions.setAvailability(windows);

    expect(getState().availability).toEqual(windows);
    expect(dbMocks.saveAvailability).toHaveBeenCalledWith(windows);
  });

  it('setAvailability rejects a malformed set at the door, falling back to the default', async () => {
    const { actions, getState } = await freshStore();
    dbMocks.saveAvailability.mockClear();

    // Structurally valid AvailabilityWindow[], but semantically malformed (out-of-range dow/minutes).
    actions.setAvailability([{ dow: 9, startMin: -1, endMin: 5000 }]);

    const { DEFAULT_AVAILABILITY } = await import('../lib/availability');
    expect(getState().availability).toEqual(DEFAULT_AVAILABILITY);
    expect(dbMocks.saveAvailability).toHaveBeenCalledWith(DEFAULT_AVAILABILITY);
  });

  it('setAllDayBlocks updates state and persists the new value', async () => {
    const { actions, getState } = await freshStore();
    dbMocks.saveAllDayBlocks.mockClear();

    actions.setAllDayBlocks(false);

    expect(getState().allDayBlocks).toBe(false);
    expect(dbMocks.saveAllDayBlocks).toHaveBeenCalledWith(false);
  });

  it('setAllDayBlocks is a no-op when the value is unchanged', async () => {
    const { actions } = await freshStore();
    dbMocks.saveAllDayBlocks.mockClear();

    actions.setAllDayBlocks(true); // already true in the initial state literal

    expect(dbMocks.saveAllDayBlocks).not.toHaveBeenCalled();
  });
});

describe('estimates', () => {
  const goalWithLeaf: Goal = {
    id: 'g1', title: 'G', nodes: [{ id: 'n1', title: 'N', done: false }],
  };

  it('sets and clears a node estimate', async () => {
    const { findInAll } = await import('../lib/tree');
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithLeaf)]);

    store.actions.setNodeEstimate('n1', 90);
    expect(findInAll(store.getState().goals, 'n1')?.estimateMin).toBe(90);

    store.actions.setNodeEstimate('n1', null);
    // Key ABSENCE, not just an undefined value — `delete` and `estimateMin:
    // undefined` round-trip differently through Dexie and the JSON backup,
    // and the implementation is supposed to `delete` the key. Assert the
    // node still exists first: `?? {}` on a missing node would otherwise
    // make the key-absence check pass vacuously.
    const clearedNode = findInAll(store.getState().goals, 'n1');
    expect(clearedNode).not.toBeNull();
    expect('estimateMin' in clearedNode!).toBe(false);
  });

  it('clears a node estimate given a non-positive value', async () => {
    const { findInAll } = await import('../lib/tree');
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithLeaf)]);

    store.actions.setNodeEstimate('n1', 60);
    store.actions.setNodeEstimate('n1', 0);
    // Same non-vacuous shape as above: confirm the node exists before
    // checking that the key is gone.
    const clearedNode = findInAll(store.getState().goals, 'n1');
    expect(clearedNode).not.toBeNull();
    expect('estimateMin' in clearedNode!).toBe(false);
  });

  it('refuses to estimate a container', async () => {
    const { findInAll } = await import('../lib/tree');
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([{
      id: 'g1', title: 'G',
      nodes: [{ id: 'c1', title: 'C', children: [{ id: 'n1', title: 'N', done: false }] }],
    }]);

    store.actions.setNodeEstimate('c1', 90);
    expect(findInAll(store.getState().goals, 'c1')?.estimateMin).toBeUndefined();
  });

  it('sets and clears a task estimate', async () => {
    const store = await freshStore();
    await store.initStore();
    store.actions.addTask('T', '2026-07-28', null);
    const id = store.getState().tasks[0].id;

    store.actions.setTaskEstimate(id, 25);
    expect(store.getState().tasks[0].estimateMin).toBe(25);

    store.actions.setTaskEstimate(id, null);
    // Key ABSENCE, not just an undefined value — see the node-clearing test above.
    expect('estimateMin' in store.getState().tasks[0]).toBe(false);
  });
});
