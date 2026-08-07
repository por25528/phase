import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { goalPct } from '../lib/pct';
import { leafCount } from '../lib/board';
import type { Asset, Goal, GoalNode, PlanReview, Session, Task } from '../db/types';
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
  loadSidebarPanels: vi.fn(async () => []),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAvailability: vi.fn(async () => {}),
  saveAllDayBlocks: vi.fn(async () => {}),
  saveSidebarPanels: vi.fn(async () => {}),
  loadPlanMode: vi.fn(async () => 'week' as const),
  savePlanMode: vi.fn(async () => {}),
  persist: vi.fn(async () => {}),
  exportState: vi.fn(),
  importStateFromFile: vi.fn(),
  isSlotMigrationDone: vi.fn(async () => true),
  saveSlotMigrationSnapshot: vi.fn(async () => {}),
  loadSlotMigrationSnapshot: vi.fn(async () => null),
  markSlotMigrationDone: vi.fn(async () => {}),
  isCheckpointMigrationDone: vi.fn(async () => true),
  saveCheckpointMigrationSnapshot: vi.fn(async () => {}),
  loadCheckpointMigrationSnapshot: vi.fn(async () => null),
  markCheckpointMigrationDone: vi.fn(async () => {}),
}));

vi.mock('../db/db', () => dbMocks);

const assetMocks = vi.hoisted(() => ({
  putAsset: vi.fn(async () => {}),
  allAssetIds: vi.fn(async () => [] as string[]),
  getAsset: vi.fn(async (_id: string): Promise<Asset | undefined> => undefined),
  deleteAssets: vi.fn(async () => {}),
}));

vi.mock('../db/assets', () => assetMocks);

const tabLockMocks = vi.hoisted(() => ({
  acquireTabLock: vi.fn(async () => true),
}));

vi.mock('../lib/tabLock', () => tabLockMocks);

async function freshStore() {
  vi.resetModules();
  return await import('./store');
}

function expectNoContainerCheckpoints(goals: Goal[]): void {
  function visit(nodes: GoalNode[]): void {
    for (const node of nodes) {
      if (!node.children?.length) continue;
      expect(node.checkpoint).not.toBe(true);
      visit(node.children);
    }
  }

  goals.forEach((goal) => visit(goal.nodes));
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
  beforeEach(() => {
    vi.useFakeTimers();
    assetMocks.putAsset.mockClear();
    assetMocks.allAssetIds.mockClear();
    assetMocks.getAsset.mockClear();
    assetMocks.deleteAssets.mockClear();
    tabLockMocks.acquireTabLock.mockClear();
    tabLockMocks.acquireTabLock.mockResolvedValue(true);
  });
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

    it('drops the start minute when a task moves to a different day', async () => {
      // The new day may have no room at that minute, or no availability at all.
      // Returning it to the backlog is honest; carrying the time over is not.
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addTask('Email', '2026-07-15');
      const id = getState().tasks[0].id;
      actions.scheduleTask(id, '2026-07-15', 600);
      expect(getState().tasks[0].startMin).toBe(600);

      actions.rescheduleTask(id, '2026-07-16');
      expect(getState().tasks[0].date).toBe('2026-07-16');
      expect('startMin' in getState().tasks[0]).toBe(false);
    });

    it('keeps the start minute when rescheduling to the same day', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addTask('Email', '2026-07-15');
      const id = getState().tasks[0].id;
      actions.scheduleTask(id, '2026-07-15', 600);
      actions.rescheduleTask(id, '2026-07-15');
      expect(getState().tasks[0].startMin).toBe(600);
    });

    it('removes a task with undo support and restores the same id', async () => {
      const { actions, getState } = await freshStore();
      actions.addTask('File notes');
      const taskId = getState().tasks[0].id;

      actions.removeTask(taskId);
      expect(getState().tasks).toEqual([]);
      expect(getState().pendingUndo?.label).toBe('Deleted "File notes"');

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

  describe('checkpoints', () => {
    it('toggles a leaf checkpoint on and removes the field when toggled off', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;

      actions.toggleCheckpoint(nid);
      expect(getState().goals[0].nodes[0].checkpoint).toBe(true);

      actions.toggleCheckpoint(nid);
      expect('checkpoint' in getState().goals[0].nodes[0]).toBe(false);
    });

    it('refuses to toggle a container and does not write', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'container');
      const nid = getState().goals[0].nodes[0].id;
      actions.addChild(nid, 'child');
      dbMocks.persist.mockClear();

      actions.toggleCheckpoint(nid);

      expect(getState().goals[0].nodes[0].checkpoint).toBeUndefined();
      expect(dbMocks.persist).not.toHaveBeenCalled();
    });

    it('toggles a leaf whose children array is empty', async () => {
      const { actions, getState } = await freshStore();
      const goal: Goal = {
        id: 'g-empty-children', title: 'G', nodes: [
          { id: 'leaf-with-empty-children', title: 'Leaf', children: [] },
        ],
      };
      actions.addGoals([goal]);
      dbMocks.persist.mockClear();

      actions.toggleCheckpoint('leaf-with-empty-children');

      expect(getState().goals[0].nodes[0].checkpoint).toBe(true);
      expect(dbMocks.persist).toHaveBeenCalledOnce();
    });

    it('keeps checkpoint leaves in leafCount and goalPct, and ticking one moves the percentage', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'checkpoint');
      actions.addRootNode(gid, 'ordinary');
      const nid = getState().goals[0].nodes[0].id;

      actions.toggleCheckpoint(nid);
      expect(leafCount(getState().goals[0].nodes)).toEqual({ total: 2, done: 0 });
      expect(goalPct(getState().goals[0])).toBe(0);

      actions.toggleLeaf(nid);
      expect(leafCount(getState().goals[0].nodes)).toEqual({ total: 2, done: 1 });
      expect(goalPct(getState().goals[0])).toBe(50);
    });

    it('clears a checkpoint when addChild converts a leaf and undo restores both', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'checkpoint');
      const nid = getState().goals[0].nodes[0].id;
      actions.toggleCheckpoint(nid);

      actions.addChild(nid, 'child');

      const converted = getState().goals[0].nodes[0];
      expect(converted.checkpoint).toBeUndefined();
      expect(converted.children).toHaveLength(1);
      expect(getState().pendingUndo).not.toBeNull();

      actions.undoLastDelete();

      const restored = getState().goals[0].nodes[0];
      expect(restored.children).toBeUndefined();
      expect(restored.checkpoint).toBe(true);
    });
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
      // plan the leaf by hand — addChild's field-clearing is what's under test
      // here, not scheduleNode's slot resolution.
      getState().goals[0].nodes[0].plannedWeek = '2026-07-13';
      getState().goals[0].nodes[0].plannedDay = '2026-07-15';
      actions.addChild(nid, 'child');
      const node = getState().goals[0].nodes[0];
      expect(node.children).toHaveLength(1);
      expect(node.done).toBeUndefined();
      expect(node.plannedWeek).toBeUndefined();
      expect(node.plannedDay).toBeUndefined();
    });

    /**
     * "+ sub" is a hover affordance sitting two pixels from ✕, and on a step
     * that was finished and scheduled it silently un-completed it and pulled it
     * off the calendar. The field-clearing is right — a container cannot carry
     * a slot — but it went through bare `setAndPersist`, so there was no
     * confirmation, no toast and no way back.
     */
    it('arms an undo when the converted leaf was carrying a plan', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'Pset 4');
      const nid = getState().goals[0].nodes[0].id;
      getState().goals[0].nodes[0].plannedWeek = '2026-07-13';
      getState().goals[0].nodes[0].estimateMin = 90;

      actions.addChild(nid, 'child');
      expect(getState().pendingUndo?.label).toBe('"Pset 4" became a group — its plan was cleared');

      actions.undoLastDelete();
      const restored = getState().goals[0].nodes[0];
      expect(restored.children).toBeUndefined();
      expect(restored.plannedWeek).toBe('2026-07-13');
      expect(restored.estimateMin).toBe(90);
    });

    // Typing out a list must not raise a toast per row — nothing is lost when
    // the leaf was bare, or when the target is already a container.
    it('stays quiet when the conversion discards nothing', async () => {
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'Psets');
      const nid = getState().goals[0].nodes[0].id;

      actions.addChild(nid, 'Pset 1');
      expect(getState().pendingUndo).toBeNull();
      actions.addChild(nid, 'Pset 2');
      expect(getState().pendingUndo).toBeNull();
      expect(getState().goals[0].nodes[0].children).toHaveLength(2);
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

  // The timer now hides the toast rather than throwing the restore away. Five
  // seconds is below the time it takes to notice a misclick, so the undo
  // outlives its own toast and ⌘Z can still reach it.
  it('hides a cheap edit toast after 5s but keeps the change reversible', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G');
    const id = getState().goals[0].id;
    actions.setGoalDates(id, '2026-08-01', '2026-08-10');
    expect(getState().goals[0].start).toBe('2026-08-01');

    vi.advanceTimersByTime(5000);
    expect(getState().pendingUndo).toBeNull();

    actions.undoLastDelete();
    expect(getState().goals[0].start).toBeUndefined();
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
    expect(getState().pendingUndo?.label).toBe('Updated dates for "G"');
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

  it('setNodeNotes writes only to the selected node', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G');
    const goalId = getState().goals[0].id;
    actions.addRootNode(goalId, 'Step 1');
    actions.addRootNode(goalId, 'Step 2');
    const [first, second] = getState().goals[0].nodes;

    actions.setNodeNotes(first.id, 'A note');

    expect(getState().goals[0].nodes[0].notes).toBe('A note');
    expect(getState().goals[0].nodes[1].notes).toBeUndefined();
    expect(second.notes).toBeUndefined();
  });

  it('setNodeNotes removes empty markdown and preserves progress and metadata', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('G');
    const goalId = getState().goals[0].id;
    actions.addRootNode(goalId, 'Step 1');
    actions.addRootNode(goalId, 'Step 2');
    const nodeId = getState().goals[0].nodes[0].id;
    actions.toggleLeaf(nodeId);
    actions.setNodeDates(goalId, nodeId, '2026-02-01', '2026-02-10');
    actions.setNodeNotes(nodeId, 'A note');
    const before = getState().goals[0].nodes[0];
    const pctBefore = goalPct(getState().goals[0]);

    actions.setNodeNotes(nodeId, '');

    const node = getState().goals[0].nodes[0];
    expect('notes' in node).toBe(false);
    expect(node.done).toBe(before.done);
    expect(node.start).toBe(before.start);
    expect(node.deadline).toBe(before.deadline);
    expect(goalPct(getState().goals[0])).toBe(pctBefore);
  });

  describe('addAsset', () => {
    const encoder = async (file: Blob) => ({ bytes: file, width: 4, height: 3 });

    it('does not write from a tab that does not own the lock', async () => {
      tabLockMocks.acquireTabLock.mockResolvedValueOnce(false);
      const store = await freshStore();
      await store.initStore();

      await expect(store.actions.addAsset(new Blob(['image']), encoder)).rejects.toThrow(/another tab/);
      expect(assetMocks.putAsset).not.toHaveBeenCalled();
      expect(store.getState().persistFailed).toBe(false);
    });

    it('latches persistence failure and keeps it after a later asset write succeeds', async () => {
      const { actions, getState } = await freshStore();
      assetMocks.putAsset.mockRejectedValueOnce(new Error('disk full'));

      await expect(actions.addAsset(new Blob(['image']), encoder)).rejects.toThrow('disk full');
      expect(getState().persistFailed).toBe(true);

      await expect(actions.addAsset(new Blob(['image']), encoder)).resolves.toMatch(/^a_/);
      expect(getState().persistFailed).toBe(true);
      expect(assetMocks.putAsset).toHaveBeenCalledTimes(2);
    });
  });

  describe('reclaimSpace', () => {
    it('deletes only unreferenced project and step assets and reports bytes freed', async () => {
      const store = await freshStore();
      await store.initStore();
      store.actions.addGoals([{
        id: 'g', title: 'Project', notes: '![project](asset:project)', nodes: [{
          id: 'n', title: 'Step', notes: '![step](asset:step)', children: [{
            id: 'leaf', title: 'Leaf', notes: 'asset:step',
          }],
        }],
      }]);
      assetMocks.allAssetIds.mockResolvedValueOnce(['project', 'step', 'orphan']);
      assetMocks.getAsset.mockImplementation(async (id: string) => ({
        id,
        mime: 'image/webp',
        bytes: new Blob([id.repeat(id === 'orphan' ? 4 : 1)]),
        width: 1,
        height: 1,
        createdAt: '2026-08-01',
      }));

      await expect(store.actions.reclaimSpace()).resolves.toEqual({ count: 1, bytes: 24 });
      expect(assetMocks.deleteAssets).toHaveBeenCalledWith(['orphan']);
      expect(assetMocks.getAsset).toHaveBeenCalledWith('orphan');
    });

    it('does not sweep or delete from a non-owning tab', async () => {
      tabLockMocks.acquireTabLock.mockResolvedValueOnce(false);
      const store = await freshStore();
      await store.initStore();

      await expect(store.actions.reclaimSpace()).resolves.toEqual({ count: 0, bytes: 0 });
      expect(assetMocks.allAssetIds).not.toHaveBeenCalled();
      expect(assetMocks.getAsset).not.toHaveBeenCalled();
      expect(assetMocks.deleteAssets).not.toHaveBeenCalled();
    });

    it('defers while an undo is armed, leaving its asset reachable for restore', async () => {
      const store = await freshStore();
      await store.initStore();
      store.actions.addGoals([{
        id: 'g', title: 'Project', notes: '![image](asset:a_1)', nodes: [],
      }]);

      store.actions.removeGoal('g');
      expect(store.getState().pendingUndo).not.toBeNull();

      await expect(store.actions.reclaimSpace()).resolves.toEqual({ deferred: true });
      expect(assetMocks.allAssetIds).not.toHaveBeenCalled();
      expect(assetMocks.deleteAssets).not.toHaveBeenCalled();

      store.actions.undoLastDelete();
      expect(store.getState().goals[0].notes).toBe('![image](asset:a_1)');
      expect(assetMocks.deleteAssets).not.toHaveBeenCalled();
    });

    it('never runs during hydration without the explicit action', async () => {
      const store = await freshStore();

      await store.initStore();

      expect(assetMocks.allAssetIds).not.toHaveBeenCalled();
      expect(assetMocks.deleteAssets).not.toHaveBeenCalled();
    });
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

  describe('scheduleNode / unscheduleNode', () => {
    // '2026-07-15' is a Wednesday; the module default availability (Mon-Fri
    // 09:00-18:00) covers it, so resolveSlot has somewhere to place the leaf.
    it('schedules a leaf onto a day, deriving plannedWeek and a real start minute', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;

      actions.scheduleNode(gid, nid, '2026-07-15', 600);
      const n = getState().goals[0].nodes[0];
      expect(n.plannedWeek).toBe('2026-07-13');
      expect(n.plannedDay).toBe('2026-07-15');
      expect(n.plannedStartMin).toBe(600);
    });

    it('is a no-op on containers and unknown ids', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;
      actions.addChild(nid, 'child'); // nid is now a container
      actions.scheduleNode(gid, nid, '2026-07-15', 600);
      expect(getState().goals[0].nodes[0].plannedWeek).toBeUndefined();
      actions.scheduleNode('nope', 'nada', '2026-07-15', 600); // must not throw
    });

    it('refuses with a toast naming the longest free stretch when nothing fits', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;
      actions.setNodeEstimate(nid, 600); // longer than the whole 09:00-18:00 window

      actions.scheduleNode(gid, nid, '2026-07-15', 600);

      expect(getState().goals[0].nodes[0].plannedDay).toBeUndefined();
      expect(getState().toast).toBe('No 10h gap left that day — longest free stretch is 9h');
    });

    it('unscheduleNode clears all three fields with an undo window', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;
      actions.scheduleNode(gid, nid, '2026-07-15', 600);

      actions.unscheduleNode(gid, nid);

      const cleared = getState().goals[0].nodes[0];
      expect(cleared.plannedWeek).toBeUndefined();
      expect(cleared.plannedDay).toBeUndefined();
      expect(cleared.plannedStartMin).toBeUndefined();
      expect(getState().pendingUndo).not.toBeNull();

      actions.undoLastDelete();
      const restored = getState().goals[0].nodes[0];
      expect(restored.plannedWeek).toBe('2026-07-13');
      expect(restored.plannedDay).toBe('2026-07-15');
      expect(restored.plannedStartMin).toBe(600);
    });

    it('unscheduling from the project page does not navigate away', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;
      actions.scheduleNode(gid, nid, '2026-07-15', 600);
      actions.openProject(gid, nid);

      actions.unscheduleNode(gid, nid);

      expect(getState().view).toBe('project');
      expect(getState().revealItem).toBeNull();
    });

    it('unscheduling from the Plan view still reveals the step', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;
      actions.scheduleNode(gid, nid, '2026-07-15', 600);

      actions.unscheduleNode(gid, nid);

      expect(getState().view).toBe('plan');
      expect(getState().revealItem).toMatchObject({ kind: 'step', id: nid });
    });

    // Regression guard for excludeId in scheduleNode's own `placed` lookup:
    // without it, a node already sitting at 600..660 on this day would appear
    // in its own `placed` list, collide with itself at every aim minute in
    // that gap, and never be able to move within the free time it already
    // occupies.
    it('re-schedules a node already placed on the same day to a new aim minute', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'leaf');
      const nid = getState().goals[0].nodes[0].id;

      actions.scheduleNode(gid, nid, '2026-07-15', 600); // first placement: 600..660
      expect(actions.scheduleNode(gid, nid, '2026-07-15', 630)).toBe(true); // move within the same free day

      const n = getState().goals[0].nodes[0];
      expect(n.plannedDay).toBe('2026-07-15');
      expect(n.plannedStartMin).toBe(630);
    });

    /**
     * Rearranging the day you are standing in.
     *
     * Placement resolved against the real wall clock, and `remainingWindow`
     * treats everything before "now" as gone — so at 2pm the only gap Wednesday
     * had left was 14:00–18:00. Dragging the 09:00 block up to 11:00 therefore
     * found no gap at the aim, slid to the first one that fit, and dropped the
     * block at 14:00: a move the user never asked for, with no toast and no
     * undo. `NO_PAST_LIMIT` exists for precisely this — its own note says
     * "adjusting a commitment the user already made" — and `clampResize` was
     * already using it for the sibling case of resizing a 09:00 block at 2pm.
     */
    it('moves a block earlier in a day already underway, instead of sliding it to now', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, '6.1200 pset');
      const nid = getState().goals[0].nodes[0].id;
      actions.scheduleNode(gid, nid, '2026-07-15', 540); // 09:00
      expect(getState().goals[0].nodes[0].plannedStartMin).toBe(540);

      vi.setSystemTime(new Date(2026, 6, 15, 14)); // it is now 2pm
      expect(actions.scheduleNode(gid, nid, '2026-07-15', 660)).toBe(true); // aim 11:00

      expect(getState().goals[0].nodes[0].plannedStartMin).toBe(660);
    });

    it('moves a block back onto an earlier weekday of the same week', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'Investor deck');
      const nid = getState().goals[0].nodes[0].id;
      actions.scheduleNode(gid, nid, '2026-07-15', 600); // Wed

      vi.setSystemTime(new Date(2026, 6, 15, 14));
      // Monday of the same week is nine hours empty; it used to refuse this
      // with "no free time left that day".
      expect(actions.scheduleNode(gid, nid, '2026-07-13', 600)).toBe(true);

      const n = getState().goals[0].nodes[0];
      expect(n.plannedDay).toBe('2026-07-13');
      expect(n.plannedStartMin).toBe(600);
    });
  });

  describe('createTaskAt', () => {
    // '2026-07-15' is a Wednesday; the module default availability
    // (Mon-Fri 09:00-18:00) covers it, so resolveSlot has somewhere to place it.
    it('creates a placed task in one undoable write', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();

      expect(actions.createTaskAt('Read the Raft paper', '2026-07-15', 600, 90)).toBe(true);

      const task = getState().tasks[0];
      expect(task.title).toBe('Read the Raft paper');
      expect(task.date).toBe('2026-07-15');
      expect(task.startMin).toBe(600);
      expect(task.estimateMin).toBe(90);
      expect(task.goalId).toBeNull();
      expect(task.done).toBe(false);
      // ONE entry, and it is the creation — not an estimate change left behind
      // by a three-write composition.
      expect(getState().pendingUndo?.label).toBe('Created "Read the Raft paper"');
    });

    it('undo removes the task it created', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();

      actions.createTaskAt('Read the Raft paper', '2026-07-15', 600, 90);
      expect(getState().tasks).toHaveLength(1);

      actions.undoLastDelete();
      expect(getState().tasks).toEqual([]);
    });

    it('creates nothing and returns false when the day has no room', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();

      // 600 minutes is longer than the whole 09:00-18:00 window.
      expect(actions.createTaskAt('Too big', '2026-07-15', 600, 600)).toBe(false);

      expect(getState().tasks).toEqual([]);
      expect(getState().toast).toBe('No 10h gap left that day — longest free stretch is 9h');
      expect(getState().pendingUndo).toBeNull();
    });

    it('refuses a blank title without touching the day', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();

      expect(actions.createTaskAt('   ', '2026-07-15', 600, 60)).toBe(false);
      expect(getState().tasks).toEqual([]);
      expect(getState().pendingUndo).toBeNull();
    });

    it("honours the day's real gaps rather than the minute it was handed", async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();

      actions.createTaskAt('First', '2026-07-15', 540, 120);  // 09:00-11:00
      // Aims into the middle of what is now occupied. The only gap left that
      // day is 11:00-18:00, so this must land on its near edge rather than at
      // the minute the gesture asked for.
      actions.createTaskAt('Second', '2026-07-15', 600, 60);

      const second = getState().tasks.find((t) => t.title === 'Second')!;
      expect(second.startMin).toBe(660);
    });
  });

  describe('scheduleTask', () => {
    // Mirrors the scheduleNode regression guard above: without excludeId in
    // scheduleTask's own `placed` lookup, a task already sitting at 600..660
    // would collide with itself and never be able to move within its own gap.
    it('re-schedules a task already placed on the same day to a new aim minute', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addTask('leaf', '2026-07-15');
      const tid = getState().tasks[0].id;

      actions.scheduleTask(tid, '2026-07-15', 600); // first placement: 600..660
      expect(actions.scheduleTask(tid, '2026-07-15', 630)).toBe(true); // move within the same free day

      const t = getState().tasks[0];
      expect(t.date).toBe('2026-07-15');
      expect(t.startMin).toBe(630);
    });
  });

  describe('unscheduleTask', () => {
    /**
     * The `×` takes the task off the plan entirely, matching `unscheduleNode`.
     *
     * It used to unpin the time and keep `date`, because at the time no surface
     * listed a dateless task. The backlog rail changed that — it lists any task
     * missing either field — but the behaviour didn't follow, and `tasksForWeek`
     * (which feeds the week header's capacity) filters on `date` alone. So one
     * unscheduled task was billed to "planned" in the header while sitting under
     * "To plan" in the rail beside it.
     */
    it('takes the task off the plan entirely, with an undo window', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addTask('leaf', '2026-07-15');
      const tid = getState().tasks[0].id;
      actions.scheduleTask(tid, '2026-07-15', 600);

      actions.unscheduleTask(tid);

      const cleared = getState().tasks[0];
      expect(cleared.date).toBeUndefined();
      expect(cleared.startMin).toBeUndefined();
      expect(getState().pendingUndo).not.toBeNull();

      actions.undoLastDelete();
      const restored = getState().tasks[0];
      expect(restored.date).toBe('2026-07-15');
      expect(restored.startMin).toBe(600);
    });

    // The whole point of clearing the date: the task must stop being counted as
    // planned, and must still be reachable. Both, or neither is safe.
    it('leaves the task in the backlog rail and out of the week capacity', async () => {
      const { backlogGroups } = await import('../lib/backlog');
      const { tasksForWeek } = await import('../lib/dailyWork');
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addTask('Investor deck', '2026-07-15');
      const tid = getState().tasks[0].id;
      actions.scheduleTask(tid, '2026-07-15', 600);

      actions.unscheduleTask(tid);

      const { tasks } = getState();
      expect(tasksForWeek(tasks, '2026-07-13')).toEqual([]);
      const rail = backlogGroups(getState().goals, tasks, '2026-07-13', '2026-07-15');
      expect(rail.flatMap((g) => g.items).map((i) => i.title)).toContain('Investor deck');
    });

    it('is a no-op on a task that is not pinned to a time', async () => {
      const { actions, getState } = await freshStore();
      actions.addTask('leaf', '2026-07-15');
      const tid = getState().tasks[0].id;

      actions.unscheduleTask(tid);

      expect(getState().tasks[0].date).toBe('2026-07-15');
      expect(getState().pendingUndo).toBeNull();
    });
  });

  describe('resizeNode / resizeTask', () => {
    // Both leaves sit on 2026-07-15 (Wed, 09:00-18:00 window). 'first' occupies
    // 540..600 (60min); 'second' immediately follows at 660..720 (60min).
    async function scheduledPair() {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addGoal('G');
      const gid = getState().goals[0].id;
      actions.addRootNode(gid, 'first');
      actions.addRootNode(gid, 'second');
      const firstId = getState().goals[0].nodes[0].id;
      const secondId = getState().goals[0].nodes[1].id;
      actions.scheduleNode(gid, firstId, '2026-07-15', 540);
      actions.scheduleNode(gid, secondId, '2026-07-15', 660);
      return { actions, getState, gid, firstId, secondId };
    }

    // Regression guard: without excludeId in the resize path, `first`'s own
    // 540..600 span would appear in `placed`, so `first` would collide with
    // ITSELF and never be able to grow — even into genuinely free time before
    // `second`. This proves growing in place (excluding self) works.
    it('resizes a node in place, growing into the free gap right up to the next block', async () => {
      const { actions, getState, firstId } = await scheduledPair();

      actions.resizeNode(firstId, 120); // 540..660 would exactly touch `second` at 660

      expect(getState().goals[0].nodes.find((n) => n.id === firstId)?.estimateMin).toBe(120);
    });

    it('clamps a resize so it cannot overlap the next block', async () => {
      const { actions, getState, firstId } = await scheduledPair();

      actions.resizeNode(firstId, 600); // would run straight through `second`

      // Clamped to the free gap: 540 (its own start) .. 660 (second's start) = 120min.
      expect(getState().goals[0].nodes.find((n) => n.id === firstId)?.estimateMin).toBe(120);
    });

    it('leaves estimateMin untouched and explains itself when the resize is refused (non-positive request)', async () => {
      const { actions, getState, firstId } = await scheduledPair();

      actions.resizeNode(firstId, 0);

      expect(getState().goals[0].nodes.find((n) => n.id === firstId)?.estimateMin).toBeUndefined();
      expect(getState().toast).toBe('Can\'t resize "first" — it no longer fits a free slot that day');
    });

    it('resizeTask mirrors resizeNode: grows in place and clamps against the next block', async () => {
      vi.setSystemTime(new Date(2026, 6, 15, 8));
      const { actions, getState } = await freshStore();
      actions.addTask('first', '2026-07-15');
      actions.addTask('second', '2026-07-15');
      const [firstId, secondId] = getState().tasks.map((t) => t.id);
      actions.scheduleTask(firstId, '2026-07-15', 540);
      actions.scheduleTask(secondId, '2026-07-15', 660);

      actions.resizeTask(firstId, 120); // exactly touches `second` — must succeed
      expect(getState().tasks.find((t) => t.id === firstId)?.estimateMin).toBe(120);

      actions.resizeTask(firstId, 600); // would run through `second` — must clamp
      expect(getState().tasks.find((t) => t.id === firstId)?.estimateMin).toBe(120);
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
      expect(getState().pendingUndo?.label).toBe('Completed "Draft introduction"');
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
      // Plan the leaf by hand (scheduleNode resolves a real slot elsewhere;
      // the rollover snapshot only cares about plannedWeek).
      getState().goals[0].nodes[0].plannedWeek = prevWeek;

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
      actions.unscheduleNode('g1', 'n1');
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
        availability: DEFAULT_AVAILABILITY, allDayBlocks: true, sidebarPanels: [],
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
        vi.mocked(dbMod.saveCheckpointMigrationSnapshot).mockClear();
        vi.mocked(dbMod.markCheckpointMigrationDone).mockClear();
        vi.mocked(dbMod.isCheckpointMigrationDone).mockClear();
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

      // markSlotMigrationDone is wrapped in its OWN try/catch, separate from
      // the outer one above: the data is already persisted and correct at
      // that point, and migrateSlots is idempotent, so a failure to record
      // the flag must not fail hydration — it only costs a harmless re-run
      // next launch. Uses real, non-empty data so we can also confirm the
      // migrated node (not the pre-migration original) reached the store
      // despite the flag write rejecting.
      it('does not fail hydration when markSlotMigrationDone rejects, and keeps the migrated data', async () => {
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
        vi.mocked(dbMod.markSlotMigrationDone).mockRejectedValueOnce(new Error('flag write failed'));

        await store.initStore();

        expect(store.getState().hydration).toBe('ready');
        const node = store.getState().goals[0].nodes[0];
        expect(node.plannedStartMin).toBe(540);
        expect(node.plannedDay).toBe('2026-07-15');
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
        // Assert on the mechanism, not just the resulting state: `toast` is
        // already null before initStore runs, so replacing the
        // `if (migrationToast) actions.showToast(migrationToast)` guard with
        // an unconditional call would pass a state-only assertion here too
        // (showToast(null) writes the same null the state already holds).
        // Spying on showToast itself catches that mutation.
        const showToastSpy = vi.spyOn(store.actions, 'showToast');

        await store.initStore();

        expect(showToastSpy).not.toHaveBeenCalled();
        expect(store.getState().toast).toBeNull();
      });
    });

    describe('one-shot checkpoint migration', () => {
      beforeEach(async () => {
        const dbMod = await import('../db/db');
        vi.mocked(dbMod.saveCheckpointMigrationSnapshot).mockClear();
        vi.mocked(dbMod.markCheckpointMigrationDone).mockClear();
        vi.mocked(dbMod.persist).mockClear();
        vi.mocked(dbMod.isCheckpointMigrationDone).mockClear();
        vi.mocked(dbMod.loadState).mockClear();
        vi.mocked(dbMod.isSlotMigrationDone).mockResolvedValue(true);
      });

      it('skips snapshot, persist, and mark-done once already done', async () => {
        const store = await freshStore();
        const dbMod = await import('../db/db');
        vi.mocked(dbMod.isCheckpointMigrationDone).mockResolvedValueOnce(true);

        await store.initStore();

        expect(store.getState().hydration).toBe('ready');
        expect(dbMod.saveCheckpointMigrationSnapshot).not.toHaveBeenCalled();
        expect(dbMod.markCheckpointMigrationDone).not.toHaveBeenCalled();
      });

      it('snapshots before conversion, persists, then marks done', async () => {
        const store = await freshStore();
        const dbMod = await import('../db/db');
        const legacyGoal = {
          id: 'g1',
          title: 'Legacy project',
          nodes: [{ id: 'step', title: 'Step', done: false }],
          milestones: [{ id: 'm1', title: 'Demo', date: '2026-08-10' }],
        };
        vi.mocked(dbMod.isCheckpointMigrationDone).mockResolvedValueOnce(false);
        vi.mocked(dbMod.loadState).mockResolvedValueOnce({
          goals: [legacyGoal as unknown as Goal], habits: [], tasks: [], sessions: [],
        });

        const calls: string[] = [];
        vi.mocked(dbMod.saveCheckpointMigrationSnapshot).mockImplementationOnce(async (goals) => {
          calls.push('snapshot');
          expect(goals[0]).toHaveProperty('milestones');
        });
        vi.mocked(dbMod.persist).mockImplementationOnce(async (next) => {
          calls.push('persist');
          expect(next.goals[0].nodes).toHaveLength(2);
          expect(next.goals[0]).not.toHaveProperty('milestones');
        });
        vi.mocked(dbMod.markCheckpointMigrationDone).mockImplementationOnce(async () => {
          calls.push('markDone');
        });

        await store.initStore();

        expect(store.getState().hydration).toBe('ready');
        expect(calls).toEqual(['snapshot', 'persist', 'markDone']);
        expect(store.getState().goals[0].nodes[1]).toMatchObject({
          id: 'm1', checkpoint: true, start: '2026-08-10', deadline: '2026-08-10',
        });
      });
    });

    describe('tab lock gates the migration', () => {
      beforeEach(async () => {
        const dbMod = await import('../db/db');
        vi.mocked(dbMod.saveSlotMigrationSnapshot).mockClear();
        vi.mocked(dbMod.markSlotMigrationDone).mockClear();
        vi.mocked(dbMod.persist).mockClear();
        vi.mocked(dbMod.isSlotMigrationDone).mockClear();
        vi.mocked(dbMod.saveCheckpointMigrationSnapshot).mockClear();
        vi.mocked(dbMod.markCheckpointMigrationDone).mockClear();
        vi.mocked(dbMod.isCheckpointMigrationDone).mockClear();
        vi.mocked(tabLockMocks.acquireTabLock).mockClear();
        vi.mocked(tabLockMocks.acquireTabLock).mockResolvedValue(true);
      });

      afterEach(async () => {
        // Resets the fallback resolved value back to the safe default (done).
        // mockResolvedValue replaces the persistent fallback, not a queued
        // mockResolvedValueOnce — this describe block never queues a
        // mockResolvedValueOnce for isSlotMigrationDone, so there is nothing
        // to drain here. This just guards against a later test seeing the
        // `false` fallback that "a non-owning tab..." leaves behind.
        const dbMod = await import('../db/db');
        vi.mocked(dbMod.isSlotMigrationDone).mockResolvedValue(true);
        vi.mocked(dbMod.isCheckpointMigrationDone).mockResolvedValue(true);
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
        vi.mocked(dbMod.isCheckpointMigrationDone).mockResolvedValue(false);
        vi.mocked(tabLockMocks.acquireTabLock).mockResolvedValueOnce(false);

        await store.initStore();

        expect(store.getState().hydration).toBe('ready');
        expect(store.getState().secondTab).toBe(true);
        expect(dbMod.saveSlotMigrationSnapshot).not.toHaveBeenCalled();
        expect(dbMod.persist).not.toHaveBeenCalled();
        expect(dbMod.markSlotMigrationDone).not.toHaveBeenCalled();
        expect(dbMod.saveCheckpointMigrationSnapshot).not.toHaveBeenCalled();
        expect(dbMod.markCheckpointMigrationDone).not.toHaveBeenCalled();
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

      await store.actions.exportBackup();

      expect(exportState).toHaveBeenCalledOnce();
      expect(exportState).toHaveBeenCalledWith({
        goals: [], habits: [], tasks: [legacyTask], sessions: [legacySession],
      }, 13, planReview, store.getState().availability, store.getState().allDayBlocks,
       store.getState().sidebarPanels, null, null);
    });

    it('loads the pre-migration snapshot and carries it into the export', async () => {
      const { store } = await freshStoreWithLegacyData();
      const { exportState, loadSlotMigrationSnapshot, loadCheckpointMigrationSnapshot } = await import('../db/db');
      vi.mocked(exportState).mockClear();
      const snapshot = { goals: [], tasks: [] };
      vi.mocked(loadSlotMigrationSnapshot).mockResolvedValueOnce(snapshot);
      vi.mocked(loadCheckpointMigrationSnapshot).mockResolvedValueOnce(null);

      await store.actions.exportBackup();

      expect(exportState).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(),
        expect.anything(), snapshot, null,
      );
    });

    it('still exports when migration snapshot reads fail', async () => {
      const { store } = await freshStoreWithLegacyData();
      const { exportState, loadSlotMigrationSnapshot, loadCheckpointMigrationSnapshot } = await import('../db/db');
      vi.mocked(exportState).mockClear();
      vi.mocked(loadSlotMigrationSnapshot).mockRejectedValueOnce(new Error('snapshot unavailable'));
      vi.mocked(loadCheckpointMigrationSnapshot).mockRejectedValueOnce(new Error('snapshot unavailable'));

      await store.actions.exportBackup();

      expect(exportState).toHaveBeenCalledOnce();
      expect(exportState).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(),
        expect.anything(), null, null,
      );
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
      vi.setSystemTime(new Date(2026, 6, 13, 8)); // Mon 2026-07-13, before the 09:00 window opens
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
      actions.scheduleNode(gid, nid, '2026-07-13', 600);
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

describe('openProject node focus (T8)', () => {
  const nested: Goal = {
    id: 'gp', title: 'Project', start: '2026-01-01', deadline: '2026-12-31', column: 0,
    nodes: [
      { id: 'root-a', title: 'Root A', children: [
        { id: 'mid', title: 'Mid', children: [{ id: 'leaf', title: 'Leaf', done: false }] },
      ] },
    ],
  };

  it('focuses a node: switches view, sets openGoalId + focusNodeId + openStepId, re-expands ancestors', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.toggleExpand('root-a'); // collapse what addGoals auto-expanded
    actions.toggleExpand('mid');
    expect(getState().expanded.has('root-a')).toBe(false);

    actions.openProject('gp', 'leaf');
    const s = getState();
    expect(s.view).toBe('project');
    expect(s.openGoalId).toBe('gp');
    expect(s.focusNodeId).toBe('leaf');
    expect(s.openStepId).toBe('leaf');
    expect(s.projectTab).toBe('steps');
    expect(s.expanded.has('root-a')).toBe(true);
    expect(s.expanded.has('mid')).toBe(true);
  });

  it('opens at the root when no node is given', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openProject('gp');
    const s = getState();
    expect(s.view).toBe('project');
    expect(s.openGoalId).toBe('gp');
    expect(s.focusNodeId).toBeNull();
    expect(s.openStepId).toBeNull();
  });

  it('ignores an unknown node id but still opens the project', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openProject('gp', 'ghost');
    const s = getState();
    expect(s.view).toBe('project');
    expect(s.openGoalId).toBe('gp');
    expect(s.focusNodeId).toBeNull();
    expect(s.openStepId).toBeNull();
  });

  it('always opens on the steps tab, even after the notes tab was last used', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openProject('gp');
    actions.setProjectTab('notes');
    expect(getState().projectTab).toBe('notes');
    actions.closeProject();
    actions.openProject('gp');
    expect(getState().projectTab).toBe('steps');
  });

  it.each([
    ['timeline', 'timeline'],
    ['plan', 'plan'],
    ['goals', 'goals'],
  ] as const)('closeProject returns to the %s view and clears project state', async (sourceView, expectedView) => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.setView(sourceView);
    actions.openProject('gp', 'leaf');
    actions.closeProject();
    const s = getState();
    expect(s.view).toBe(expectedView);
    expect(s.openGoalId).toBeNull();
    expect(s.focusNodeId).toBeNull();
    expect(s.openStepId).toBeNull();
  });

  it('keeps the original return view when opening another project from the project page', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested, { ...nested, id: 'gb', title: 'Project B' }]);
    actions.setView('timeline');

    actions.openProject('gp');
    actions.openProject('gb');
    actions.closeProject();

    expect(getState().view).toBe('timeline');
  });

  it('preserves the active horizon across a project round-trip', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.setActiveHorizon(2);
    actions.setView('goals');

    actions.openProject('gp');
    actions.closeProject();

    expect(getState().activeHorizon).toBe(2);
  });

  it('clearFocusNode drops the pulse pointer without leaving the page', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openProject('gp', 'leaf');
    actions.clearFocusNode();
    const s = getState();
    expect(s.focusNodeId).toBeNull();
    expect(s.view).toBe('project');
    expect(s.openGoalId).toBe('gp');
    expect(s.openStepId).toBe('leaf');
  });

  it('openStep selects a node without disturbing the page or the tab', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openProject('gp');
    actions.setProjectTab('notes');

    actions.openStep('leaf');
    const s = getState();
    expect(s.openStepId).toBe('leaf');
    expect(s.view).toBe('project');
    expect(s.openGoalId).toBe('gp');
    // Opening a step is a selection, not a navigation: it must not yank the
    // user back to another tab.
    expect(s.projectTab).toBe('notes');
    // And it is NOT a pulse — that belongs to arriving from elsewhere.
    expect(s.focusNodeId).toBeNull();
  });

  it('closeStep clears only the selection', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openProject('gp', 'leaf');
    actions.closeStep();
    const s = getState();
    expect(s.openStepId).toBeNull();
    expect(s.view).toBe('project');
    expect(s.openGoalId).toBe('gp');
  });

  it('openStep ignores an unknown node id', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openProject('gp');
    actions.openStep('ghost');
    expect(getState().openStepId).toBeNull();
  });

  it('setView away from the project clears all project pointers', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openProject('gp', 'leaf');

    actions.setView('plan');

    const s = getState();
    expect(s.view).toBe('plan');
    expect(s.openGoalId).toBeNull();
    expect(s.openStepId).toBeNull();
    expect(s.focusNodeId).toBeNull();
  });

  it('clears the open step when its node is removed, while undo restores the node only', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.openProject('gp', 'leaf');

    actions.removeNode('leaf');

    expect(getState().openStepId).toBeNull();
    expect(getState().goals[0].nodes[0].children?.[0].children).toHaveLength(0);

    actions.undoLastDelete();

    expect(getState().goals[0].nodes[0].children?.[0].children?.[0].id).toBe('leaf');
    expect(getState().openStepId).toBeNull();
  });

  it('keeps the open step when a different node is removed', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([nested]);
    actions.addRootNode('gp', 'Other');
    const otherId = getState().goals.find((g) => g.id === 'gp')!.nodes[1].id;
    actions.openProject('gp', 'leaf');

    actions.removeNode(otherId);

    expect(getState().openStepId).toBe('leaf');
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

  it('clears a checkpoint when converting a leaf and undo restores the leaf and flag', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([{
      ...withStep,
      nodes: [{ ...withStep.nodes[0], checkpoint: true }],
    }]);

    actions.addChildren('n', ['Sub A']);

    const converted = getState().goals[0].nodes[0];
    expect(converted.checkpoint).toBeUndefined();
    expect(converted.children).toHaveLength(1);
    expectNoContainerCheckpoints(getState().goals);
    expect(getState().pendingUndo).not.toBeNull();

    actions.undoLastDelete();

    const restored = getState().goals[0].nodes[0];
    expect(restored.children).toBeUndefined();
    expect(restored.checkpoint).toBe(true);
  });

  it('does not arm undo for a plain non-checkpoint leaf', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([{
      id: 'g', title: 'G', column: 0,
      nodes: [{ id: 'n', title: 'Step', done: false }],
    }]);

    actions.addChildren('n', ['Sub A']);

    expect(getState().pendingUndo).toBeNull();
    expect(getState().goals[0].nodes[0].children).toHaveLength(1);
    expectNoContainerCheckpoints(getState().goals);
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

  // Backfill rewrites the record streaks are computed from, and nothing on
  // screen shows it happened — so it has to be recoverable.
  it('makes a past-day edit undoable and names the day', async () => {
    vi.setSystemTime(new Date(2026, 6, 23, 12));
    const { actions, getState } = await storeWithHabit();

    actions.toggleHabitOn('h', '2026-07-20');
    expect(getState().pendingUndo?.label).toBe('Marked "Read" on Jul 20');

    actions.undoLastDelete();
    expect(getState().habits[0].checkins).toEqual([]);

    actions.toggleHabitOn('h', '2026-07-20');
    actions.toggleHabitOn('h', '2026-07-20');
    expect(getState().pendingUndo?.label).toBe('Cleared "Read" on Jul 20');
  });

  it('leaves today silent — the row itself already shows the change', async () => {
    vi.setSystemTime(new Date(2026, 6, 23, 12));
    const { actions, getState } = await storeWithHabit();

    actions.toggleHabit('h');
    expect(getState().pendingUndo).toBeNull();
  });
});

describe('view', () => {
  it('opens on the Plan calendar', async () => {
    const { getState } = await freshStore();
    expect(getState().view).toBe('plan');
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
  // Two of these pin the clock so scheduling resolves against a known day; the
  // fake-timer lifecycle keeps that from leaking into the suites after it.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const goalWithLeaf: Goal = {
    id: 'g1', title: 'G', nodes: [{ id: 'n1', title: 'N', done: false }],
  };

  /**
   * Block height is `durationOf(estimateMin)`, so raising the estimate of an
   * already-placed item stretched it over its neighbours and past the end of
   * the day — the exact collision `resolveSlot` gatekeeps every drop against,
   * reachable from a field that said nothing at all. The estimate itself is not
   * clamped (it is a fact about the work, and `resizeNode` is the gesture that
   * means "make the block this long"), but the consequence is now stated.
   */
  it('warns when a bigger estimate outgrows the slot the item sits in', async () => {
    vi.setSystemTime(new Date(2026, 6, 15, 8));
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([{
      id: 'g9', title: '6.1200', nodes: [
        { id: 'a', title: 'Pset', done: false, estimateMin: 30 },
        { id: 'b', title: 'Recitation', done: false, estimateMin: 30 },
      ],
    }]);
    store.actions.scheduleNode('g9', 'a', '2026-07-15', 540); // 09:00–09:30
    store.actions.scheduleNode('g9', 'b', '2026-07-15', 600); // 10:00–10:30

    store.actions.setNodeEstimate('a', 600); // ten hours, straight through b

    const { findInAll } = await import('../lib/tree');
    expect(findInAll(store.getState().goals, 'a')?.estimateMin).toBe(600);
    expect(store.getState().toast).toBe('"Pset" no longer fits its slot — move it or shorten the day');
  });

  it('says nothing when the estimate still fits, or the item is not on the grid', async () => {
    vi.setSystemTime(new Date(2026, 6, 15, 8));
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([{
      id: 'g9', title: '6.1200', nodes: [{ id: 'a', title: 'Pset', done: false, estimateMin: 30 }],
    }]);

    store.actions.setNodeEstimate('a', 120); // unplaced — nothing to overflow
    expect(store.getState().toast).toBeNull();

    store.actions.scheduleNode('g9', 'a', '2026-07-15', 540);
    store.actions.setNodeEstimate('a', 60); // an empty day has room
    expect(store.getState().toast).toBeNull();
  });

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

  // The estimate control now sits on the drawer's step tree as well as the
  // rail — the surface where people type fast and mis-click. Overwriting an
  // estimate destroys the number that was there; clearing one destroys it
  // outright. Both have to be recoverable.
  it('undoes an estimate change back to the previous value', async () => {
    const { findInAll } = await import('../lib/tree');
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithLeaf)]);

    store.actions.setNodeEstimate('n1', 45);
    store.actions.setNodeEstimate('n1', 120);
    expect(findInAll(store.getState().goals, 'n1')?.estimateMin).toBe(120);
    expect(store.getState().pendingUndo?.label).toContain('was 45m');

    store.actions.undoLastDelete();
    expect(findInAll(store.getState().goals, 'n1')?.estimateMin).toBe(45);
  });

  it('undoes a cleared estimate', async () => {
    const { findInAll } = await import('../lib/tree');
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithLeaf)]);

    store.actions.setNodeEstimate('n1', 90);
    store.actions.setNodeEstimate('n1', null);
    expect('estimateMin' in findInAll(store.getState().goals, 'n1')!).toBe(false);

    store.actions.undoLastDelete();
    expect(findInAll(store.getState().goals, 'n1')?.estimateMin).toBe(90);
  });

  it('undoes a task estimate change', async () => {
    const store = await freshStore();
    await store.initStore();
    store.actions.addTask('T', '2026-07-28', null);
    const id = store.getState().tasks[0].id;

    store.actions.setTaskEstimate(id, 30);
    store.actions.setTaskEstimate(id, 60);
    store.actions.undoLastDelete();
    expect(store.getState().tasks[0].estimateMin).toBe(30);
  });

  /*
   * Re-picking the value a step already carries must not arm an undo.
   *
   * `EstimateControl` puts six preset buttons a click apart, so pressing the
   * one already set is an ordinary slip. Every undoable edit's write sweeps the
   * non-surgical restores before it (see setAndPersist), so without this guard
   * that slip would silently discard a pending project delete — consuming the
   * recovery path for a write that changed nothing at all.
   */
  it('does not arm an undo when the estimate is unchanged', async () => {
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithLeaf)]);
    store.actions.setNodeEstimate('n1', 60);

    store.actions.removeGoal('g1');
    const armed = store.getState().pendingUndo?.label;
    expect(armed).toContain('Deleted');

    store.actions.setNodeEstimate('n1', 60); // same value — a no-op
    expect(store.getState().pendingUndo?.label).toBe(armed);

    store.actions.undoLastDelete();
    expect(store.getState().goals).toHaveLength(1);
  });

  it('formats the previous value in the undo label, even from imported data', async () => {
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([{
      id: 'gf', title: 'Imported',
      nodes: [{ id: 'nf', title: 'Step', done: false, estimateMin: 90.4 }],
    }]);

    store.actions.setNodeEstimate('nf', 60);
    // The raw stored value formatted as "1h30.399999999999999".
    expect(store.getState().pendingUndo?.label).toBe('"Step" is now 1h (was 1h30)');
  });

  it('does not arm an undo when clearing an already-absent estimate', async () => {
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithLeaf)]);

    store.actions.setNodeEstimate('n1', null);
    expect(store.getState().pendingUndo).toBeNull();
  });

  // Imported data carries whatever the file said. A fractional estimate must
  // normalise rather than land as-is — every capacity figure downstream
  // assumes a positive integer number of minutes.
  it('normalises a fractional estimate rather than trusting it', async () => {
    const { findInAll } = await import('../lib/tree');
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([{
      id: 'gi', title: 'Imported',
      nodes: [{ id: 'ni', title: 'Step', done: false, estimateMin: 90.4 }],
    }]);

    store.actions.setNodeEstimate('ni', 45.6);
    expect(findInAll(store.getState().goals, 'ni')?.estimateMin).toBe(46);
  });
});

/*
 * `Session` shipped with a type, a table, a backup round trip and
 * `loggedTimeForWeek` — and no producer. The week recap's "You logged N
 * minutes across M sessions" sat behind `logged.sessions > 0`, which nothing
 * could ever make true. These cover the action that closes that.
 */
describe('logging actual time', () => {
  const goalWithStep: Goal = {
    id: 'g1', title: 'P', column: 0,
    nodes: [{ id: 'n1', title: 'Step', done: false, estimateMin: 60 }],
  };

  it('records a session against a step', async () => {
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithStep)]);

    expect(store.actions.logSession('step', 'n1', 90, '2026-07-28')).toBe(true);
    const [s] = store.getState().sessions;
    expect(s).toMatchObject({ nodeId: 'n1', goalId: 'g1', minutes: 90, date: '2026-07-28' });
    expect(s.taskId).toBeUndefined();
  });

  it('records a session against a task', async () => {
    const store = await freshStore();
    await store.initStore();
    store.actions.addTask('T', '2026-07-28', null);
    const id = store.getState().tasks[0].id;

    expect(store.actions.logSession('task', id, 25, '2026-07-28')).toBe(true);
    const [s] = store.getState().sessions;
    expect(s).toMatchObject({ taskId: id, minutes: 25 });
    expect(s.nodeId).toBeUndefined();
  });

  it('appends rather than overwriting — a second sitting is a second session', async () => {
    const { loggedForNode } = await import('../lib/actuals');
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithStep)]);

    store.actions.logSession('step', 'n1', 45, '2026-07-28');
    store.actions.logSession('step', 'n1', 30, '2026-07-29');
    expect(store.getState().sessions).toHaveLength(2);
    expect(loggedForNode(store.getState().sessions, 'n1')).toBe(75);
  });

  it('logging never moves the percentage', async () => {
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithStep)]);

    const before = goalPct(store.getState().goals[0]);
    store.actions.logSession('step', 'n1', 240, '2026-07-28');
    // Time is journalled, never scored. Ticking the checkbox is still the only
    // thing that moves a number — the invariant the whole progress model rests
    // on, now that a second time field exists to tempt it.
    expect(goalPct(store.getState().goals[0])).toBe(before);
  });

  it('refuses a non-positive or unparseable duration', async () => {
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithStep)]);

    expect(store.actions.logSession('step', 'n1', 0, '2026-07-28')).toBe(false);
    expect(store.actions.logSession('step', 'n1', -30, '2026-07-28')).toBe(false);
    expect(store.actions.logSession('step', 'n1', Number.NaN, '2026-07-28')).toBe(false);
    expect(store.getState().sessions).toEqual([]);
  });

  it('refuses an invalid date', async () => {
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithStep)]);

    expect(store.actions.logSession('step', 'n1', 60, 'not-a-date')).toBe(false);
    expect(store.getState().sessions).toEqual([]);
  });

  it('refuses an unknown step or task', async () => {
    const store = await freshStore();
    await store.initStore();
    expect(store.actions.logSession('step', 'nope', 60, '2026-07-28')).toBe(false);
    expect(store.actions.logSession('task', 'nope', 60, '2026-07-28')).toBe(false);
    expect(store.getState().sessions).toEqual([]);
  });

  it('refuses a container — it holds no estimate to measure against', async () => {
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([{
      id: 'g2', title: 'G',
      nodes: [{ id: 'c1', title: 'C', children: [{ id: 'k1', title: 'K', done: false }] }],
    }]);

    expect(store.actions.logSession('step', 'c1', 60, '2026-07-28')).toBe(false);
    expect(store.getState().sessions).toEqual([]);
  });

  it('undoes a logged session', async () => {
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithStep)]);

    store.actions.logSession('step', 'n1', 90, '2026-07-28');
    expect(store.getState().pendingUndo?.label).toContain('Logged 1h30');

    store.actions.undoLastDelete();
    expect(store.getState().sessions).toEqual([]);
  });

  it('clears every session for one item, undoably', async () => {
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithStep)]);
    store.actions.addTask('T', '2026-07-28', null);
    const taskId = store.getState().tasks[0].id;

    store.actions.logSession('step', 'n1', 45, '2026-07-28');
    store.actions.logSession('step', 'n1', 30, '2026-07-28');
    store.actions.logSession('task', taskId, 20, '2026-07-28');

    expect(store.actions.clearSessionsFor('step', 'n1')).toBe(true);
    // Only that item's ledger. The task's session is a different record and
    // must survive.
    expect(store.getState().sessions).toHaveLength(1);
    expect(store.getState().sessions[0].taskId).toBe(taskId);

    store.actions.undoLastDelete();
    expect(store.getState().sessions).toHaveLength(3);
  });

  it('reports a refusal when there is nothing to clear', async () => {
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithStep)]);
    // Callers must not report success on a refusal, so this cannot return true
    // for a no-op — and it must not arm an undo that would revert something else.
    expect(store.actions.clearSessionsFor('step', 'n1')).toBe(false);
    expect(store.getState().pendingUndo).toBeNull();
  });

  it('names the count and the item when clearing', async () => {
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithStep)]);
    store.actions.logSession('step', 'n1', 45, '2026-07-28');
    store.actions.logSession('step', 'n1', 30, '2026-07-28');

    store.actions.clearSessionsFor('step', 'n1');
    expect(store.getState().pendingUndo?.label).toBe('Cleared 2 time entries on "Step"');
  });

  /*
   * Deleting a step leaves its sessions behind, ON PURPOSE.
   *
   * `withUndo` snapshots exactly one slice, so a cascade that removed the node
   * (`goals`) and its sessions (`sessions`) could only restore one of them —
   * undo would bring the step back with its history silently gone. An orphan is
   * inert by comparison. This test exists so that a future "tidy up orphaned
   * sessions" change has to confront the undo consequence rather than discover
   * it in production.
   */
  it('leaves sessions intact when the step is deleted, so undo restores both', async () => {
    const { loggedForNode } = await import('../lib/actuals');
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithStep)]);
    store.actions.logSession('step', 'n1', 90, '2026-07-28');

    store.actions.removeNode('n1');
    expect(store.getState().sessions).toHaveLength(1);

    store.actions.undoLastDelete();
    const { findInAll } = await import('../lib/tree');
    expect(findInAll(store.getState().goals, 'n1')).not.toBeNull();
    expect(loggedForNode(store.getState().sessions, 'n1')).toBe(90);
  });

  it('ignores orphaned sessions in a project’s calibration', async () => {
    const { projectCalibration } = await import('../lib/actuals');
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithStep)]);
    store.actions.logSession('step', 'n1', 90, '2026-07-28');
    store.actions.removeNode('n1');

    // Calibration walks LIVE leaves, so a dangling session cannot skew it.
    expect(projectCalibration(store.getState().goals[0], store.getState().sessions)).toBeNull();
  });

  it('refuses to log against a completed project’s step', async () => {
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithStep)]);
    store.actions.toggleLeaf('n1');
    store.actions.completeGoal('g1');

    // `setNodeEstimate` has always been frozen on a completed project. The two
    // controls sit on the same row, so they must agree about whether the
    // project is editable.
    expect(store.actions.logSession('step', 'n1', 60, '2026-07-28')).toBe(false);
    expect(store.getState().sessions).toEqual([]);
  });

  it('makes the week recap’s logged-time figure reachable', async () => {
    const { loggedTimeForWeek } = await import('../lib/plan');
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([structuredClone(goalWithStep)]);

    store.actions.logSession('step', 'n1', 45, '2026-07-28');
    store.actions.logSession('step', 'n1', 60, '2026-07-30');
    // '2026-07-27' is the Monday of that week. This is the exact call
    // RecapPanel makes, and it could never return anything but zero before.
    expect(loggedTimeForWeek(store.getState().sessions, '2026-07-27')).toEqual({
      minutes: 105, sessions: 2,
    });
  });
});

// C-7: the undo was a single slot behind a 5s toast. Deleting a project and
// then ticking any checkbox inside that window destroyed the project with no
// warning that the undo had just been consumed.
/**
 * A failed write was a 1.9-second toast and nothing else, while in-memory state
 * advanced as if it had succeeded. Quota exceeded mid-session, user looks away
 * for three seconds, then works for an hour against state that lives only in
 * RAM and closes the tab. The condition has to outlive the moment.
 */
/**
 * Every `persist` is a full clear + bulkPut of all four tables from THIS tab's
 * in-memory snapshot, so one write from a stale second tab rewrites the entire
 * database from its stale view. The banner was shown and the clobbering
 * happened anyway.
 */
describe('a tab that does not own the lock', () => {
  it('renders and reads, but never writes', async () => {
    const { acquireTabLock } = await import('../lib/tabLock');
    const { persist } = await import('../db/db');
    vi.mocked(acquireTabLock).mockResolvedValueOnce(false);

    const store = await freshStore();
    const { actions, getState } = store;
    await store.initStore();
    await new Promise((r) => setTimeout(r, 0));
    expect(getState().secondTab).toBe(true);

    vi.mocked(persist).mockClear();
    actions.addGoal('Typed in the wrong tab');

    // Visible locally — Export is the escape hatch — but nothing reaches disk.
    expect(getState().goals.map((g) => g.title)).toContain('Typed in the wrong tab');
    expect(vi.mocked(persist)).not.toHaveBeenCalled();
  });

  /**
   * `setAndPersist`'s guard covers the four main tables. Every OTHER write went
   * straight through — so a non-owning tab still overwrote the owner's
   * settings, and `ensureWeekRollover` (unconditional at the end of
   * `initStore`) stamped its own `planReview` over the owner's on every launch.
   */
  it('writes no settings either — not just no tables', async () => {
    const { acquireTabLock } = await import('../lib/tabLock');
    const db = await import('../db/db');
    vi.mocked(acquireTabLock).mockResolvedValueOnce(false);

    const store = await freshStore();
    await store.initStore();
    await new Promise((r) => setTimeout(r, 0));
    expect(store.getState().secondTab).toBe(true);

    vi.mocked(db.saveAvailability).mockClear();
    vi.mocked(db.saveAllDayBlocks).mockClear();
    vi.mocked(db.saveSidebarPanels).mockClear();
    vi.mocked(db.savePlanReview).mockClear();

    store.actions.setAvailability([{ dow: 0, startMin: 540, endMin: 600 }]);
    store.actions.setAllDayBlocks(false);
    store.actions.setSidebarPanels(['habits']);
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(db.saveAvailability)).not.toHaveBeenCalled();
    expect(vi.mocked(db.saveAllDayBlocks)).not.toHaveBeenCalled();
    expect(vi.mocked(db.saveSidebarPanels)).not.toHaveBeenCalled();
    expect(vi.mocked(db.savePlanReview)).not.toHaveBeenCalled();
  });

  it('refuses an import rather than letting it write all four tables', async () => {
    const { acquireTabLock } = await import('../lib/tabLock');
    const { importStateFromFile } = await import('../db/db');
    vi.mocked(acquireTabLock).mockResolvedValueOnce(false);

    const store = await freshStore();
    await store.initStore();
    await new Promise((r) => setTimeout(r, 0));

    vi.mocked(importStateFromFile).mockClear();
    await store.actions.importBackup(new File([''], 'backup.json'));

    expect(vi.mocked(importStateFromFile)).not.toHaveBeenCalled();
    expect(store.getState().toast).toContain('another tab');
  });

  it('writes normally when it does own the lock', async () => {
    const { persist } = await import('../db/db');
    const { actions, getState } = await freshStore();
    await new Promise((r) => setTimeout(r, 0));
    expect(getState().secondTab).toBe(false);

    vi.mocked(persist).mockClear();
    actions.addGoal('Typed in the right tab');
    expect(vi.mocked(persist)).toHaveBeenCalled();
  });
});

/**
 * The board card computed exactly which step "Plan next step" meant, passed the
 * goalId to `onPlan`, and `onPlan` ignored it and called `setView('plan')`.
 * Since `cardPrimaryAction` returns 'plan' for nearly every healthy project,
 * that was the default action on most cards — and it dropped you into a rail
 * holding a dozen projects with nothing selected.
 */
/**
 * Every neighbouring board action speaks — add, import and complete all raise a
 * toast — and the horizon move, reached from a ⋯ menu so entirely blind, raised
 * nothing and had no undo. Below 920px only one horizon renders and the menu is
 * the only cross-horizon route there, so the card just left the screen.
 */
/**
 * "Replan" was `scheduleNode(goalId, nodeId, today, 0)`. Under the default
 * Mon–Fri availability that fails outright on a weekend — exactly when a weekly
 * review happens — and on a weekday that succeeded, nothing on screen changed:
 * `weekRecap` buckets on `node.done`, and the return value was discarded, so
 * only the failure path ever spoke.
 */
describe('replanNode', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function storeWithCarryOver() {
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([{
      id: 'g', title: '6.5840', column: 0,
      nodes: [{ id: 'n', title: 'Part 2B', done: false, estimateMin: 60 }],
    }]);
    return store;
  }

  it('finds the next weekday when today is a weekend, instead of failing', async () => {
    // 2026-07-18 is a Saturday; the default window is Mon–Fri.
    vi.setSystemTime(new Date(2026, 6, 18, 9));
    const { actions, getState } = await storeWithCarryOver();

    actions.replanNode('g', 'n');

    const { findInAll } = await import('../lib/tree');
    expect(findInAll(getState().goals, 'n')?.plannedDay).toBe('2026-07-20'); // Monday
    expect(getState().toast).toContain('Replanned "Part 2B"');
  });

  it('says so on success — the old silence was indistinguishable from a dead button', async () => {
    vi.setSystemTime(new Date(2026, 6, 15, 8)); // a Wednesday
    const { actions, getState } = await storeWithCarryOver();

    actions.replanNode('g', 'n');

    const { findInAll } = await import('../lib/tree');
    expect(findInAll(getState().goals, 'n')?.plannedDay).toBe('2026-07-15');
    expect(getState().toast).toContain('Replanned');
  });

  it('explains itself when nothing in the horizon can take it', async () => {
    vi.setSystemTime(new Date(2026, 6, 15, 8));
    const store = await freshStore();
    await store.initStore();
    store.actions.setAvailability([]); // no working hours at all
    store.actions.addGoals([{
      id: 'g', title: '6.5840', column: 0,
      nodes: [{ id: 'n', title: 'Part 2B', done: false, estimateMin: 60 }],
    }]);

    store.actions.replanNode('g', 'n');

    const { findInAll } = await import('../lib/tree');
    expect(findInAll(store.getState().goals, 'n')?.plannedDay).toBeUndefined();
    expect(store.getState().toast).toContain('No free slot');
  });
});

describe('moveGoalToColumn', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('names the destination and offers the move back', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('6.1200 Psets');
    const id = getState().goals[0].id;

    actions.moveGoalToColumn(id, 2);

    expect(getState().goals[0].column).toBe(2);
    expect(getState().pendingUndo?.label).toBe('Moved "6.1200 Psets" to Later');

    actions.undoLastDelete();
    expect(getState().goals[0].column).toBe(0);
  });

  /**
   * Choosing the horizon a project is already in is not a move. It used to
   * toast "Moved X to Now" and arm a whole-goals-slice undo for a write that
   * changed nothing — and that undo displaced whatever real one was armed
   * before it.
   */
  it('says nothing when the project is already in that horizon', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('Already here');
    const id = getState().goals[0].id;
    actions.removeTask('nope'); // no-op; just to leave pendingUndo null

    actions.moveGoalToColumn(id, 0);

    expect(getState().pendingUndo).toBeNull();
    expect(getState().goals[0].column).toBe(0);
  });

  it('clamps an out-of-range column instead of inventing a horizon', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('Startup');
    const id = getState().goals[0].id;

    actions.moveGoalToColumn(id, 99);

    expect(getState().goals[0].column).toBe(3);
    expect(getState().pendingUndo?.label).toBe('Moved "Startup" to Someday');
  });
});

describe('moveGoalRank', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports the move it made', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('Alpha');
    actions.addGoal('Bravo');
    const [a, b] = getState().goals;

    expect(actions.moveGoalRank(a.id, 1)).toBe(true);

    expect(getState().goals.map((g) => g.id)).toEqual([b.id, a.id]);
    expect(getState().pendingUndo?.label).toBe('Moved "Alpha" down in Now');
  });

  /**
   * A card already against the end of its column does not move, and the store
   * has always been silent about it — no toast, no undo, deliberately, so
   * holding the chord down cannot spray either.
   *
   * But it was silent by returning `undefined` on the refusal AND on the
   * success, so `Goals.tsx`'s `moveRank` could not tell them apart and rang the
   * card either way: highlight, scrollIntoView, and a `requestAnimationFrame`
   * that calls `.focus()`. Its sibling `moveToHorizon` guards against exactly
   * this and says so — "highlighting a card that never moved announces a move
   * that did not happen" — and this was the unfixed half.
   *
   * The stray focus is not cosmetic. Under load that rAF fired AFTER the next
   * card had been focused, took focus back, and sent the next keystroke to the
   * wrong project.
   */
  it('refuses at either end of a column, and says so', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoal('Alpha');
    actions.addGoal('Bravo');
    const [a, b] = getState().goals;

    expect(actions.moveGoalRank(a.id, -1)).toBe(false); // already top
    expect(actions.moveGoalRank(b.id, 1)).toBe(false);  // already bottom
    expect(actions.moveGoalRank(a.id, 0)).toBe(false);  // not a move at all

    expect(getState().pendingUndo).toBeNull();
    expect(getState().goals.map((g) => g.id)).toEqual([a.id, b.id]);
  });
});

describe('planNextStepFor', () => {
  it('selects the project’s most urgent unplanned step, on the calendar', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([{
      id: 'g1', title: '6.1200', column: 0, nodes: [
        { id: 'later', title: 'Pset 9', deadline: '2026-12-01' },
        { id: 'soon', title: 'Pset 1', deadline: '2026-01-05' },
      ],
    }]);

    actions.planNextStepFor('g1');

    expect(getState().view).toBe('plan');
    // The rail's own ordering, not a second "first open leaf" walk that could
    // disagree with it.
    expect(getState().revealItem).toMatchObject({ kind: 'step', id: 'soon' });
  });

  it('still goes to the calendar when the project has nothing left to plan', async () => {
    const { actions, getState } = await freshStore();
    actions.addGoals([{
      id: 'g1', title: 'Done project', column: 0,
      nodes: [{ id: 'n1', title: 'Finished', done: true }],
    }]);

    actions.planNextStepFor('g1');

    expect(getState().view).toBe('plan');
    expect(getState().revealItem).toBeNull();
  });
});

  describe('persist failure', () => {
  it('latches a banner flag until a later write succeeds', async () => {
    const { persist } = await import('../db/db');
    const { actions, getState } = await freshStore();
    await new Promise((r) => setTimeout(r, 0));
    expect(getState().persistFailed).toBe(false);

    vi.mocked(persist).mockRejectedValueOnce(new Error('QuotaExceededError'));
    actions.addGoal('6.1200');
    await new Promise((r) => setTimeout(r, 0));
    expect(getState().persistFailed).toBe(true);

    // Still latched across an edit that never touches the database.
    actions.setView('goals');
    expect(getState().persistFailed).toBe(true);

    actions.addGoal('18.06'); // this one lands
    await new Promise((r) => setTimeout(r, 0));
    expect(getState().persistFailed).toBe(false);
  });

  it('keeps the in-memory edit so nothing is lost before the export', async () => {
    const { persist } = await import('../db/db');
    const { actions, getState } = await freshStore();
    await new Promise((r) => setTimeout(r, 0));

    vi.mocked(persist).mockRejectedValueOnce(new Error('disk full'));
    actions.addGoal('Startup: investor deck');
    await new Promise((r) => setTimeout(r, 0));

    expect(getState().goals.map((g) => g.title)).toContain('Startup: investor deck');
  });

  it('does not clear an app-state failure when an asset write succeeds', async () => {
    const { persist } = await import('../db/db');
    const { actions, getState } = await freshStore();
    const encoder = async (file: Blob) => ({ bytes: file, width: 4, height: 3 });

    vi.mocked(persist).mockRejectedValueOnce(new Error('disk full'));
    actions.addGoal('Unsaved edit');
    await new Promise((r) => setTimeout(r, 0));
    expect(getState().persistFailed).toBe(true);

    await actions.addAsset(new Blob(['image']), encoder);
    expect(getState().persistFailed).toBe(true);

    actions.addGoal('Saved edit');
    await new Promise((r) => setTimeout(r, 0));
    expect(getState().persistFailed).toBe(false);
  });

  it('reports an asset import failure without rolling back imported app state', async () => {
    const { importStateFromFile } = await import('../db/db');
    const { actions, getState } = await freshStore();
    const imported = {
      goals: [{ id: 'imported', title: 'Imported project', column: 0, nodes: [{
        id: 'step', title: 'Imported step', notes: '![image](asset:a_1)', done: false,
      }] }],
      habits: [], tasks: [], sessions: [], pxPerDay: 13,
      availability: DEFAULT_AVAILABILITY, allDayBlocks: true, sidebarPanels: [],
    };
    const failure = Object.assign(
      new Error('Imported goals and notes, but images could not be saved.'),
      { code: 'asset-import-failed', imported },
    );
    vi.mocked(importStateFromFile).mockRejectedValueOnce(failure);

    await actions.importBackup(new File([''], 'backup.json'));

    expect(getState().persistFailed).toBe(true);
    expect(getState().toast).toMatch(/images could not be saved/);
    expect(getState().goals).toEqual(imported.goals);
  });
});

/**
 * Enter used to call `addChild(parentId)`, which pushes onto the END of the
 * parent's list — so on the first of ten psets the new row landed tenth,
 * unfocused, titled "New item". And `parentId` is null for every root-level
 * step, which is all of them on a freshly created project, so Enter did nothing
 * whatsoever there.
 */
describe('insertSiblingAfter', () => {
  async function storeWithSteps() {
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([{
      id: 'g', title: '6.1200', column: 0, nodes: [
        { id: 'a', title: 'Pset 1', done: false },
        { id: 'b', title: 'Pset 2', done: false },
      ],
    }]);
    return store;
  }

  it('inserts below the row rather than at the end of the list', async () => {
    const { actions, getState } = await storeWithSteps();

    actions.insertSiblingAfter('a', 'Pset 1.5');

    expect(getState().goals[0].nodes.map((n) => n.title)).toEqual(['Pset 1', 'Pset 1.5', 'Pset 2']);
  });

  it('works at root level, where Enter used to do nothing', async () => {
    const { actions, getState } = await storeWithSteps();
    actions.insertSiblingAfter('b', 'Pset 3');
    expect(getState().goals[0].nodes.map((n) => n.title)).toEqual(['Pset 1', 'Pset 2', 'Pset 3']);
  });

  it('flags the new step so its row opens ready to type, exactly once', async () => {
    const { actions, getState } = await storeWithSteps();

    actions.insertSiblingAfter('a');
    const newId = getState().newNodeId;
    expect(newId).toBeTruthy();
    expect(getState().goals[0].nodes[1].id).toBe(newId);

    actions.clearNewNode();
    expect(getState().newNodeId).toBeNull();
  });

  it('is frozen on a completed project, like every other structural edit', async () => {
    const { actions, getState } = await storeWithSteps();
    actions.completeGoal('g');

    actions.insertSiblingAfter('a', 'Should not appear');

    expect(getState().goals[0].nodes.map((n) => n.title)).toEqual(['Pset 1', 'Pset 2']);
  });
});

describe('bulk step operations', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function storeWithPsets() {
    const store = await freshStore();
    await store.initStore();
    store.actions.addGoals([{
      id: 'g', title: '6.1200', column: 0, nodes: [
        { id: 'a', title: 'Pset 6', done: true, doneAt: '2026-07-01' },
        { id: 'b', title: 'Pset 7', done: false },
        { id: 'grp', title: 'Pset 8', children: [
          { id: 'c1', title: 'Problems 1-3', done: false },
          { id: 'c2', title: 'Problems 4-6', done: false },
        ] },
        { id: 'd', title: 'Pset 9', done: false },
      ],
    }]);
    return store;
  }

  /**
   * Looping the single-node actions would arm one undo entry per row — so the
   * toast would name only the last, and each write's stale-restore sweep would
   * discard the entries armed before it. A batch the user performed once has to
   * be one action.
   */
  it('deletes a whole selection under a single undo', async () => {
    const { actions, getState } = await storeWithPsets();

    actions.removeNodes(['b', 'd']);

    expect(getState().goals[0].nodes.map((n) => n.id)).toEqual(['a', 'grp']);
    expect(getState().pendingUndo?.label).toBe('Deleted 2 steps');

    actions.undoLastDelete();
    expect(getState().goals[0].nodes.map((n) => n.id)).toEqual(['a', 'b', 'grp', 'd']);
  });

  it('clears the open step for bulk removal, but not for another node', async () => {
    const { actions, getState } = await storeWithPsets();
    actions.openProject('g', 'b');

    actions.removeNodes(['d']);
    expect(getState().openStepId).toBe('b');

    actions.undoLastDelete();
    actions.removeNodes(['b']);
    expect(getState().openStepId).toBeNull();

    actions.undoLastDelete();
    expect(getState().goals[0].nodes.some((n) => n.id === 'b')).toBe(true);
    expect(getState().openStepId).toBeNull();
  });

  it('counts the subtree, not the selected rows, in the toast', async () => {
    const { actions, getState } = await storeWithPsets();
    actions.removeNodes(['grp']);
    // grp + its two children.
    expect(getState().pendingUndo?.label).toBe('Deleted 3 steps');
  });

  it('does not double-remove when a group and its child are both selected', async () => {
    const { actions, getState } = await storeWithPsets();

    actions.removeNodes(['grp', 'c1']);

    expect(getState().goals[0].nodes.map((n) => n.id)).toEqual(['a', 'b', 'd']);
    expect(getState().pendingUndo?.label).toBe('Deleted 3 steps');
  });

  it('completes the open LEAVES under a selection, never the container', async () => {
    const { actions, getState } = await storeWithPsets();
    const { findInAll } = await import('../lib/tree');

    actions.completeNodes(['grp', 'b']);

    expect(findInAll(getState().goals, 'c1')?.done).toBe(true);
    expect(findInAll(getState().goals, 'c2')?.done).toBe(true);
    expect(findInAll(getState().goals, 'b')?.done).toBe(true);
    // The container itself stays a container — its done-ness is derived.
    expect(findInAll(getState().goals, 'grp')?.done).toBeUndefined();
    expect(getState().pendingUndo?.label).toBe('Completed 3 steps');
  });

  it('leaves an already-finished step untouched instead of re-stamping doneAt', async () => {
    const { actions, getState } = await storeWithPsets();
    const { findInAll } = await import('../lib/tree');

    actions.completeNodes(['a', 'b']);

    expect(findInAll(getState().goals, 'a')?.doneAt).toBe('2026-07-01');
    expect(getState().pendingUndo?.label).toBe('Completed 1 step');
  });

  it('undoes a batch completion in one step', async () => {
    const { actions, getState } = await storeWithPsets();
    const { findInAll } = await import('../lib/tree');

    actions.completeNodes(['grp']);
    actions.undoLastDelete();

    expect(findInAll(getState().goals, 'c1')?.done).toBe(false);
    expect(findInAll(getState().goals, 'c2')?.done).toBe(false);
  });

  it('is a no-op on an empty or already-satisfied selection', async () => {
    const { actions, getState } = await storeWithPsets();

    actions.removeNodes([]);
    actions.completeNodes([]);
    actions.completeNodes(['a']); // already done
    expect(getState().pendingUndo).toBeNull();
    expect(getState().goals[0].nodes).toHaveLength(4);
  });

  it('is frozen on a completed project, like every other structural edit', async () => {
    const { actions, getState } = await storeWithPsets();
    const { findInAll } = await import('../lib/tree');
    actions.completeGoal('g');
    const armed = getState().pendingUndo; // completeGoal's own offer

    actions.removeNodes(['b', 'd']);
    actions.completeNodes(['b']);

    expect(getState().goals[0].nodes).toHaveLength(4);
    expect(findInAll(getState().goals, 'b')?.done).toBe(false);
    // Neither batch wrote, so neither displaced the offer already on screen.
    expect(getState().pendingUndo).toEqual(armed);
  });

  it('does not mutate the live state array', async () => {
    const { actions, getState } = await storeWithPsets();
    const before = structuredClone(getState().goals);
    const liveRef = getState().goals;

    actions.removeNodes(['grp']);

    expect(liveRef).toEqual(before); // the old array is untouched
    expect(getState().goals).not.toBe(liveRef);
  });
});

describe('restructuring a step tree', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function storeWithTwoSteps() {
    const { loadState } = await import('../db/db');
    vi.mocked(loadState).mockResolvedValueOnce({
      goals: [{
        id: 'g', title: '6.1200', column: 0, nodes: [
          { id: 'a', title: 'Pset 3', done: true, doneAt: '2026-07-14', estimateMin: 90 },
          { id: 'b', title: 'Pset 4', done: false },
        ],
      }],
      habits: [], tasks: [], sessions: [],
    });
    const store = await freshStore();
    await store.initStore();
    return store;
  }

  /**
   * Indenting "Pset 4" under "Pset 3" converts Pset 3 into a container, and the
   * leaf-XOR-container invariant means its completion, its done-date and its
   * estimate are discarded. That is correct — but it went through bare
   * `setAndPersist`, so a single keystroke silently un-completed a finished
   * step with no way back. (It was bound to Tab at the time, so it was also
   * reachable by anyone trying to leave the tree.)
   */
  it('lets you undo an indent that discarded the new parent’s completion', async () => {
    const { actions, getState } = await storeWithTwoSteps();

    actions.indentNode('b');

    const parent = getState().goals[0].nodes[0];
    expect(parent.children?.map((c) => c.id)).toEqual(['b']);
    expect(parent.done).toBeUndefined();
    expect(parent.estimateMin).toBeUndefined();
    expect(getState().pendingUndo?.label).toBe('Indented "Pset 4"');

    actions.undoLastDelete();

    const [a, b] = getState().goals[0].nodes;
    expect(a).toMatchObject({ id: 'a', done: true, doneAt: '2026-07-14', estimateMin: 90 });
    expect(b.id).toBe('b');
  });

  it('clears a checkpoint from the new container and restores it with undo', async () => {
    const { actions, getState } = await storeWithTwoSteps();
    actions.toggleCheckpoint('a');

    actions.indentNode('b');

    expectNoContainerCheckpoints(getState().goals);
    expect(getState().goals[0].nodes[0].checkpoint).toBeUndefined();

    actions.undoLastDelete();

    expect(getState().goals[0].nodes[0].checkpoint).toBe(true);
  });

  it('offers no undo for a move the tree refused', async () => {
    const { actions, getState } = await storeWithTwoSteps();

    actions.indentNode('a');  // first sibling — nothing to indent under
    expect(getState().pendingUndo).toBeNull();

    actions.outdentNode('a'); // already at root
    expect(getState().pendingUndo).toBeNull();

    expect(getState().goals[0].nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('undoes an outdent', async () => {
    const { actions, getState } = await storeWithTwoSteps();
    actions.indentNode('b');

    actions.outdentNode('b');
    expect(getState().goals[0].nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(getState().pendingUndo?.label).toBe('Outdented "Pset 4"');

    actions.undoLastDelete();
    expect(getState().goals[0].nodes[0].children?.map((c) => c.id)).toEqual(['b']);
  });
});

describe('undo durability', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function storeWithProject() {
    const { loadState } = await import('../db/db');
    vi.mocked(loadState).mockResolvedValueOnce({
      goals: [{
        id: 'g', title: '6.5840', column: 0, nodes: [
          { id: 'c', title: 'Part 2B', children: [
            { id: 'a', title: 'A', done: false },
            { id: 'b', title: 'B', done: false },
          ] },
        ],
      }],
      habits: [], tasks: [], sessions: [],
    });
    const store = await freshStore();
    await store.initStore();
    return store;
  }

  it('names how many steps went with the project', async () => {
    const { actions, getState } = await storeWithProject();
    actions.removeGoal('g');
    expect(getState().pendingUndo?.label).toBe('Deleted "6.5840" and its 2 steps');
  });

  it('does not let another undoable edit silently discard a pending delete', async () => {
    const { actions, getState } = await storeWithProject();
    actions.addGoal('Second');
    const other = getState().goals.find((x) => x.title === 'Second')!.id;
    actions.addRootNode(other, 'A step');
    const step = getState().goals.find((x) => x.id === other)!.nodes[0].id;

    actions.removeGoal('g');
    expect(getState().goals.some((x) => x.id === 'g')).toBe(false);

    // The sequence that used to lose the project: a second undoable edit lands
    // inside the toast window and overwrote the single restore slot.
    actions.toggleLeaf(step);
    expect(getState().pendingUndo?.label).toBe('Completed "A step"');

    actions.undoLastDelete(); // walks back the completion
    expect(getState().goals.find((x) => x.id === other)!.nodes[0].done).toBeFalsy();

    actions.undoLastDelete(); // and then still reaches the project
    expect(getState().goals.some((x) => x.id === 'g')).toBe(true);
  });

  /**
   * A withUndo restore replays a whole slice, so it also reverts anything
   * written to that slice afterwards. Most mutations (rename, move horizon,
   * reorder, schedule) are NOT undoable, so a stale restore must be dropped
   * rather than allowed to quietly revert them.
   */
  it('drops a slice restore once an unrelated, non-undoable edit lands', async () => {
    const { actions, getState } = await storeWithProject();
    actions.addGoal('Second');
    const secondId = getState().goals.find((g) => g.title === 'Second')!.id;

    actions.removeGoal('g');
    actions.renameGoal(secondId, 'Renamed'); // not undoable

    actions.undoLastDelete();

    // The rename survives — undo must never silently reverse it...
    expect(getState().goals.find((x) => x.id === secondId)?.title).toBe('Renamed');
    // ...and having dropped the stale restore, the delete stays applied.
    expect(getState().goals.some((x) => x.id === 'g')).toBe(false);
  });

  it('keeps a surgical task restore usable after other edits', async () => {
    const { actions, getState } = await storeWithProject();
    actions.addTask('Doomed');
    const taskId = getState().tasks[0].id;

    actions.removeTask(taskId);
    actions.addTask('Later arrival'); // not undoable, but harmless here

    actions.undoLastDelete();
    expect(getState().tasks.map((t) => t.title).sort()).toEqual(['Doomed', 'Later arrival']);
  });

  it('keeps the delete recoverable after its toast has faded', async () => {
    const { actions, getState } = await storeWithProject();
    actions.removeGoal('g');

    vi.advanceTimersByTime(20000);
    expect(getState().pendingUndo).toBeNull(); // toast gone

    actions.undoLastDelete();
    expect(getState().goals.map((g) => g.id)).toEqual(['g']);
  });

  it('holds a structural delete toast open longer than a cheap toggle', async () => {
    const { actions, getState } = await storeWithProject();

    actions.removeGoal('g');
    vi.advanceTimersByTime(6000);
    expect(getState().pendingUndo).not.toBeNull(); // still offering Undo at 6s

    vi.advanceTimersByTime(10000);
    expect(getState().pendingUndo).toBeNull();
  });

  /**
   * The offer and the restore must retire together.
   *
   * The stale-restore sweep above is correct, but it left `pendingUndo` alone —
   * so the toast kept saying 'Deleted "6.5840" and its 2 steps — Undo' for the
   * rest of its 15 seconds after the restore behind it had been discarded, and
   * clicking Undo popped an empty stack and dismissed the toast. That is
   * pixel-identical to a successful undo, so the project looked recoverable,
   * then looked recovered, and was neither.
   */
  it('retires the Undo toast when the edit that voids its restore lands', async () => {
    const { actions, getState } = await storeWithProject();
    actions.addGoal('Second');
    const secondId = getState().goals.find((g) => g.title === 'Second')!.id;

    actions.removeGoal('g');
    expect(getState().pendingUndo?.label).toBe('Deleted "6.5840" and its 2 steps');

    actions.renameGoal(secondId, 'Renamed'); // not undoable — voids the restore

    expect(getState().pendingUndo).toBeNull();
  });

  it('keeps offering Undo when the intervening edit leaves the restore usable', async () => {
    const { actions, getState } = await storeWithProject();
    actions.addTask('Doomed');
    const taskId = getState().tasks[0].id;

    actions.removeTask(taskId); // surgical — survives unrelated writes
    actions.addGoal('Unrelated');

    expect(getState().pendingUndo?.label).toBe('Deleted "Doomed"');
    actions.undoLastDelete();
    expect(getState().tasks.map((t) => t.title)).toEqual(['Doomed']);
  });

  /**
   * An import is a generation boundary. A whole-slice restore armed against the
   * PREVIOUS dataset, replayed after one, overwrites the imported data and
   * persists it — so ⌘Z, the most natural reflex right after restoring a
   * backup, destroyed the backup it had just restored.
   */
  it('disarms undo across a backup import', async () => {
    const { importStateFromFile, persist } = await import('../db/db');
    const { actions, getState } = await storeWithProject();

    actions.removeGoal('g'); // arms a 15s whole-slice restore of the OLD goals
    expect(getState().pendingUndo).not.toBeNull();

    vi.mocked(importStateFromFile).mockResolvedValueOnce({
      goals: [{ id: 'imported', title: 'Restored project', column: 0, nodes: [] }],
      habits: [], tasks: [], sessions: [],
      pxPerDay: 13, availability: DEFAULT_AVAILABILITY, allDayBlocks: true, sidebarPanels: [],
    });
    await actions.importBackup(new File([''], 'backup.json'));
    expect(getState().goals.map((g) => g.id)).toEqual(['imported']);
    expect(getState().pendingUndo).toBeNull();

    vi.mocked(persist).mockClear();
    actions.undoLastDelete();

    // The import survives, in memory and on disk.
    expect(getState().goals.map((g) => g.id)).toEqual(['imported']);
    expect(vi.mocked(persist)).not.toHaveBeenCalled();
  });

  it('places legacy milestones into the store as checkpoints immediately on import', async () => {
    vi.useRealTimers();
    const { importStateFromFile } = await import('../db/db');
    const actualDb = await vi.importActual<typeof import('../db/db')>('../db/db');
    const { actions, getState } = await storeWithProject();
    vi.mocked(importStateFromFile).mockImplementationOnce((file) => actualDb.importStateFromFile(file));

    await actions.importBackup(new File([JSON.stringify({
      goals: [{
        id: 'imported',
        title: 'Restored project',
        column: 0,
        nodes: [],
        milestones: [{ id: 'm1', title: 'Demo', date: '2026-08-10' }],
      }],
      habits: [], tasks: [], sessions: [],
    })], 'backup.json'));

    expect(getState().goals[0].nodes).toMatchObject([{
      id: 'm1', title: 'Demo', checkpoint: true, start: '2026-08-10', deadline: '2026-08-10',
    }]);
    expect(getState().goals[0]).not.toHaveProperty('milestones');
  });

  /**
   * The generation boundary covers where the user is STANDING, not just the
   * undo stack. Re-importing an export of the same dataset reuses every id, so
   * a project page left open would keep rendering — pointed at a node from the
   * replaced generation rather than the one it was opened on.
   */
  it('leaves the project page and clears its pointers across an import', async () => {
    const { importStateFromFile } = await import('../db/db');
    const { actions, getState } = await storeWithProject();

    actions.openProject('g');
    expect(getState().view).toBe('project');
    expect(getState().openGoalId).toBe('g');

    vi.mocked(importStateFromFile).mockResolvedValueOnce({
      goals: [{ id: 'g', title: 'Same id, new generation', column: 0, nodes: [] }],
      habits: [], tasks: [], sessions: [],
      pxPerDay: 13, availability: DEFAULT_AVAILABILITY, allDayBlocks: true, sidebarPanels: [],
    });
    await actions.importBackup(new File([''], 'backup.json'));

    const s = getState();
    expect(s.view).toBe('goals');
    expect(s.openGoalId).toBeNull();
    expect(s.focusNodeId).toBeNull();
    expect(s.openStepId).toBeNull();
  });
});
