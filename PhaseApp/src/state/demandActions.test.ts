// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { demandIndex } from '../lib/demand';
import type { Goal, Task } from '../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: never[] }> => ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => []),
  loadPlanMode: vi.fn(async () => 'week' as const),
  savePlanMode: vi.fn(async () => {}),
  loadGoalsMode: vi.fn(async (): Promise<'board' | 'timeline'> => 'board'),
  saveGoalsMode: vi.fn(async () => {}),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAllDayBlocks: vi.fn(async () => {}),
  saveSidebarPanels: vi.fn(async () => {}),
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
  loadActiveFocusSession: vi.fn(async () => null),
  saveActiveFocusSession: vi.fn(async () => {}),
  loadAssistantAccelerator: vi.fn(async () => 'Command+Space'),
  saveAssistantAccelerator: vi.fn(async () => {}),
  loadStoredTimeLevel: vi.fn(async () => null),
  saveStoredTimeLevel: vi.fn(async () => {}),
  loadStoredFocusLevel: vi.fn(async () => null),
  saveStoredFocusLevel: vi.fn(async () => {}),
  loadCycleConfig: vi.fn(async () => ({ workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4 })),
  saveCycleConfig: vi.fn(async () => {}),
}));
vi.mock('../db/db', () => dbMocks);
vi.mock('../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

async function freshStore() {
  vi.resetModules();
  return await import('./store');
}

async function demandStore(goals: Goal[], tasks: Task[] = []) {
  const { loadState } = await import('../db/db');
  vi.mocked(loadState).mockResolvedValueOnce({
    goals: structuredClone(goals), habits: [], tasks: structuredClone(tasks), sessions: [], lives: [],
  });
  const store = await freshStore();
  await store.initStore();
  return store;
}

beforeEach(() => vi.clearAllMocks());

describe('setNodeDemand', () => {
  it('sets a value, and the tree resolves it', async () => {
    const { actions, getState } = await demandStore([{ id: 'g', title: 'g', nodes: [{ id: 'a', title: 'A' }] }]);
    actions.setNodeDemand('a', 'deep');
    expect(demandIndex(getState().goals).get('a')).toEqual({ level: 'deep', source: 'own' });
    expect(getState().pendingUndo?.label).toBe('Set "A" to Deep');
  });

  it('clearing DELETES the key rather than storing a sentinel', async () => {
    const { actions, getState } = await demandStore([{ id: 'g', title: 'g', nodes: [{ id: 'a', title: 'A', demand: 'deep' }] }]);
    actions.setNodeDemand('a', null);
    const { findInAll } = await import('../lib/tree');
    const node = findInAll(getState().goals, 'a');
    expect(node).toBeDefined();
    expect('demand' in node!).toBe(false);
    expect(getState().pendingUndo?.label).toBe('Cleared focus needed on "A"');
  });

  it('has NO leaves-only guard — a container is taggable', async () => {
    const { actions, getState } = await demandStore([{
      id: 'g', title: 'g', nodes: [{ id: 'parent', title: 'Parent', children: [{ id: 'kid', title: 'Kid' }] }],
    }]);
    actions.setNodeDemand('parent', 'light');
    expect(demandIndex(getState().goals).get('kid')).toEqual({ level: 'light', source: 'inherited' });
  });

  it('is frozen on a completed project, and arms nothing', async () => {
    const { actions, getState } = await demandStore([{
      id: 'g', title: 'g', completedAt: '2026-01-01', nodes: [{ id: 'a', title: 'A' }],
    }]);
    actions.setNodeDemand('a', 'deep');
    expect('demand' in getState().goals[0].nodes[0]).toBe(false);
    expect(getState().pendingUndo).toBeNull();
  });

  it('a no-op change arms nothing', async () => {
    const { actions, getState } = await demandStore([{ id: 'g', title: 'g', nodes: [{ id: 'a', title: 'A', demand: 'deep' }] }]);
    actions.setNodeDemand('a', 'deep');
    expect(getState().pendingUndo).toBeNull();
  });

  it('is undoable, and undo restores the prior slice', async () => {
    const { actions, getState } = await demandStore([{ id: 'g', title: 'g', nodes: [{ id: 'a', title: 'A' }] }]);
    actions.setNodeDemand('a', 'moderate');
    expect(actions.undoLastDelete()).toBe('Set "A" to Moderate');
    const { findInAll } = await import('../lib/tree');
    expect(findInAll(getState().goals, 'a')?.demand).toBeUndefined();
  });
});

describe('setGoalDemand', () => {
  it('sets a value every descendant inherits', async () => {
    const { actions, getState } = await demandStore([{ id: 'g', title: 'g', nodes: [{ id: 'a', title: 'A' }] }]);
    actions.setGoalDemand('g', 'deep');
    expect(getState().goals[0].demand).toBe('deep');
    expect(demandIndex(getState().goals).get('a')).toEqual({ level: 'deep', source: 'inherited' });
  });

  it('clearing deletes the key', async () => {
    const { actions, getState } = await demandStore([{ id: 'g', title: 'g', demand: 'light', nodes: [] }]);
    actions.setGoalDemand('g', null);
    expect('demand' in getState().goals[0]).toBe(false);
  });
});

describe('setTaskDemand', () => {
  const task = (extra: Partial<Task> = {}): Task => ({ id: 't', title: 'T', done: false, goalId: null, ...extra });

  it('sets a task\'s own value', async () => {
    const { actions, getState } = await demandStore([], [task()]);
    actions.setTaskDemand('t', 'light');
    expect(getState().tasks[0].demand).toBe('light');
  });

  it('clearing deletes the key', async () => {
    const { actions, getState } = await demandStore([], [task({ demand: 'light' })]);
    actions.setTaskDemand('t', null);
    expect('demand' in getState().tasks[0]).toBe(false);
  });
});

describe('setNodesDemand', () => {
  const goals = (): Goal[] => [{
    id: 'g', title: 'g',
    nodes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'parent', title: 'Parent', children: [{ id: 'kid', title: 'Kid' }] },
    ],
  }];

  it('is ONE write and ONE undo entry for N nodes', async () => {
    const { actions, getState } = await demandStore(goals());
    dbMocks.persist.mockClear();
    expect(actions.setNodesDemand(['a', 'b', 'kid'], 'deep')).toBe(true);
    expect(getState().goals[0].nodes[0].demand).toBe('deep');
    expect(getState().goals[0].nodes[1].demand).toBe('deep');
    expect(getState().goals[0].nodes[2].children![0].demand).toBe('deep');
    expect(getState().pendingUndo?.label).toBe('Set 3 tasks to Deep');
    expect(dbMocks.persist).toHaveBeenCalledTimes(1);
  });

  it('clearing deletes the keys in the same single write', async () => {
    const { actions, getState } = await demandStore(goals().map((g) => ({
      ...g,
      nodes: g.nodes.map((n) => (n.id === 'a' ? { ...n, demand: 'deep' as const } : n)),
    })));
    dbMocks.persist.mockClear();
    expect(actions.setNodesDemand(['a'], null)).toBe(true);
    expect('demand' in getState().goals[0].nodes[0]).toBe(false);
    expect(getState().pendingUndo?.label).toBe('Cleared focus needed on 1 task');
    expect(dbMocks.persist).toHaveBeenCalledTimes(1);
  });

  it('skips nodes already carrying the value, and says false when nothing moved', async () => {
    const { actions, getState } = await demandStore(goals().map((g) => ({
      ...g,
      nodes: g.nodes.map((n) => (n.id === 'a' ? { ...n, demand: 'deep' as const } : n)),
    })));
    expect(actions.setNodesDemand(['a'], 'deep')).toBe(false);
    expect(getState().pendingUndo).toBeNull();
  });

  it('returns false for an empty or unknown selection, arming nothing', async () => {
    const { actions, getState } = await demandStore(goals());
    expect(actions.setNodesDemand([], 'deep')).toBe(false);
    expect(actions.setNodesDemand(['nope'], 'deep')).toBe(false);
    expect(getState().pendingUndo).toBeNull();
  });

  it('is frozen on a completed project, exactly as the single-node form is', async () => {
    const { actions, getState } = await demandStore([{
      id: 'g', title: 'g', completedAt: '2026-01-01', nodes: [{ id: 'a', title: 'A' }],
    }]);
    expect(actions.setNodesDemand(['a'], 'deep')).toBe(false);
    expect('demand' in getState().goals[0].nodes[0]).toBe(false);
  });
});
