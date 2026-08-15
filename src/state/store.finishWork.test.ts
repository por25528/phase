import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Asset, Goal } from '../db/types';
import type { ActiveFocusSession } from '../lib/focusSession';
import type { StoredTimeLevel } from '../lib/timeLens';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async () => ({ goals: [], habits: [], tasks: [], sessions: [], lives: [] })),
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

import { isDone } from '../lib/status';

describe('finishWork', () => {
  const t0 = 1_700_000_000_000;
  const goal: Goal = {
    id: 'g1', title: 'Algorithms',
    nodes: [{ id: 'n1', title: 'Problem set 4' }],
  };
  const ref = { kind: 'step' as const, id: 'n1', goalId: 'g1' };

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

  it('ticks a leaf and arms the same undo toggleLeaf would', async () => {
    const { actions, getState } = await workStore();

    expect(actions.finishWork(ref, t0)).toEqual({
      outcome: 'done',
      label: 'Completed "Problem set 4"',
    });
    expect(isDone(getState().goals[0].nodes[0])).toBe(true);
    expect(getState().sessions).toEqual([]);
    expect(getState().pendingUndo?.label).toBe('Completed "Problem set 4"');

    actions.undoLastDelete();
    expect(isDone(getState().goals[0].nodes[0])).toBe(false);
  });

  it('refuses a leaf that is already done, and writes nothing', async () => {
    const { actions, getState } = await workStore();
    actions.finishWork(ref, t0);

    expect(actions.finishWork(ref, t0)).toEqual({ outcome: 'refused' });
    expect(getState().sessions).toEqual([]);
  });

  it('refuses a container — a parent has no status of its own', async () => {
    const { actions } = await workStore([{
      id: 'g1', title: 'Algorithms',
      nodes: [{ id: 'p1', title: 'Unit 1', children: [{ id: 'n1', title: 'Problem set 4' }] }],
    }]);

    expect(actions.finishWork({ kind: 'step', id: 'p1', goalId: 'g1' }, t0))
      .toEqual({ outcome: 'refused' });
  });

  it('completes a loose task', async () => {
    const { actions, getState } = await freshStore();
    actions.addTask('Watch roblox');
    const taskId = getState().tasks[0].id;

    expect(actions.finishWork({ kind: 'task', id: taskId, goalId: null }, t0)).toEqual({
      outcome: 'done',
      label: 'Completed "Watch roblox"',
    });
    expect(getState().tasks[0].done).toBe(true);
  });
});
