import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Asset, Goal } from '../db/types';
import type { ActiveFocusSession } from '../lib/focusSession';
import type { StoredTimeLevel } from '../lib/timeLens';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async () => ({ goals: [], habits: [], tasks: [], sessions: [], lives: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => []),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAllDayBlocks: vi.fn(async () => {}),
  saveSidebarPanels: vi.fn(async () => {}),
  loadPlanMode: vi.fn(async () => 'week' as const),
  savePlanMode: vi.fn(async () => {}),
  loadGoalsMode: vi.fn(async (): Promise<'board' | 'timeline'> => 'board'),
  saveGoalsMode: vi.fn(async () => {}),
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
  loadActiveFocusSession: vi.fn(async (): Promise<ActiveFocusSession | null> => null),
  saveActiveFocusSession: vi.fn(async () => {}),
  loadAssistantAccelerator: vi.fn(async () => 'Command+Space'),
  saveAssistantAccelerator: vi.fn(async () => {}),
  loadStoredTimeLevel: vi.fn(async (): Promise<StoredTimeLevel | null> => null),
  saveStoredTimeLevel: vi.fn(async () => {}),
  loadStoredFocusLevel: vi.fn(async () => null),
  saveStoredFocusLevel: vi.fn(async () => {}),
  loadCycleConfig: vi.fn(async () => ({ workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4 })),
  saveCycleConfig: vi.fn(async () => {}),
  loadShelfPrefs: vi.fn(async () => ({ width: 'default', density: 'comfortable', position: 'center', sections: { alternatives: true, dials: true } })),
  saveShelfPrefs: vi.fn(async () => {}),
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

describe('insertWorkBefore', () => {
  const goal: Goal = {
    id: 'g1', title: 'Algorithms',
    nodes: [{ id: 'a', title: 'Read ch 1' }, { id: 'b', title: 'Read ch 2' }],
  };

  async function workStore(goals: Goal[] = [goal]) {
    const { loadState } = await import('../db/db');
    vi.mocked(loadState).mockResolvedValueOnce({
      goals: structuredClone(goals), habits: [], tasks: [], sessions: [], lives: [],
    });
    const store = await freshStore();
    await store.initStore();
    return store;
  }

  beforeEach(() => {
    tabLockMocks.acquireTabLock.mockClear();
    tabLockMocks.acquireTabLock.mockResolvedValue(true);
  });

  it('step anchor: inserts before the sibling, arms an undo that restores goals', async () => {
    const { actions, getState } = await workStore();

    const ref = actions.insertWorkBefore({ kind: 'step', id: 'b', goalId: 'g1' }, 'Review ch 3');
    expect(ref).not.toBeNull();
    expect(ref).toEqual({ kind: 'step', id: expect.any(String), goalId: 'g1' });
    const ids = getState().goals[0].nodes.map((n) => n.id);
    expect(ids).toEqual(['a', ref!.id, 'b']);
    expect(getState().pendingUndo?.label).toBe('Added "Review ch 3" first');

    actions.undoLastDelete();
    expect(getState().goals[0].nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('task anchor: splices a new task before it, carrying the anchor goalId', async () => {
    const { actions, getState } = await freshStore();
    actions.addTask('Buy stamps');
    const t1 = getState().tasks[0].id;

    const ref = actions.insertWorkBefore({ kind: 'task', id: t1, goalId: null }, 'Buy tape');
    expect(ref).toEqual({ kind: 'task', id: expect.any(String), goalId: null });
    expect(getState().tasks.map((t) => t.id)).toEqual([ref!.id, t1]);
    expect(getState().tasks[0]).not.toHaveProperty('date');
    expect(getState().tasks[0]).not.toHaveProperty('estimateMin');
    expect(getState().pendingUndo?.label).toBe('Added "Buy tape" first');

    actions.undoLastDelete();
    expect(getState().tasks.map((t) => t.id)).toEqual([t1]);
  });

  it('refuses a gone anchor and a blank title', async () => {
    const { actions, getState } = await workStore();
    actions.addTask('Buy stamps');
    const t1 = getState().tasks[0].id;

    expect(actions.insertWorkBefore({ kind: 'step', id: 'nope', goalId: 'g1' }, 'X')).toBeNull();
    expect(actions.insertWorkBefore({ kind: 'task', id: t1, goalId: null }, '   ')).toBeNull();
    expect(getState().pendingUndo).toBeFalsy();
  });

  it('refuses a step anchor on a completed project — frozen, like every other structural write', async () => {
    const frozenGoal: Goal = { ...goal, completedAt: '2026-01-01' };
    const { actions, getState } = await workStore([frozenGoal]);

    expect(actions.insertWorkBefore({ kind: 'step', id: 'b', goalId: 'g1' }, 'Review ch 3')).toBeNull();
    expect(getState().goals[0].nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(getState().pendingUndo).toBeFalsy();
  });
});
