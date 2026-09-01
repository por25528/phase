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

describe('the standing focus level', () => {
  const MIN = 60_000;
  const t0 = 1_700_000_000_000;
  const focusGoal: Goal = {
    id: 'g1', title: 'Algorithms',
    nodes: [{ id: 'n1', title: 'Problem set 4' }],
  };
  const ref = { kind: 'step' as const, id: 'n1', goalId: 'g1' };
  const starter = { kind: 'starter' as const, minutes: 30 as const };

  /** The neighbouring suite's `focusStore`: one goal, one leaf, hydrated. */
  async function focusStore() {
    const { loadState } = await import('../db/db');
    vi.mocked(loadState).mockResolvedValueOnce({
      goals: [focusGoal], habits: [], tasks: [], sessions: [], lives: [],
    });
    const store = await freshStore();
    await store.initStore();
    dbMocks.saveStoredTimeLevel.mockClear();
    return store;
  }

  beforeEach(() => {
    tabLockMocks.acquireTabLock.mockClear();
    tabLockMocks.acquireTabLock.mockResolvedValue(true);
    dbMocks.loadStoredTimeLevel.mockClear();
    dbMocks.loadStoredTimeLevel.mockResolvedValue(null);
    dbMocks.saveStoredTimeLevel.mockClear();
    dbMocks.loadStoredFocusLevel.mockClear();
    dbMocks.loadStoredFocusLevel.mockResolvedValue(null);
    dbMocks.saveStoredFocusLevel.mockClear();
  });

  it('starts at medium', async () => {
    const { getState } = await freshStore();
    expect(getState().timeLevel).toBe('medium');
  });

  it('is set by setTimeLevel and reported back', async () => {
    const { actions, getState } = await focusStore();
    expect(actions.setTimeLevel('low')).toBe(true);
    expect(getState().timeLevel).toBe('low');
  });

  it('refuses a level that is not one of the three', async () => {
    const { actions, getState } = await focusStore();
    actions.setTimeLevel('high');
    // @ts-expect-error — the boundary must refuse it at runtime too.
    expect(actions.setTimeLevel('sideways')).toBe(false);
    expect(getState().timeLevel).toBe('high');
    expect(dbMocks.saveStoredTimeLevel).toHaveBeenCalledTimes(1);
  });

  it('stamps the day it was set, so tomorrow can retire it', async () => {
    const { actions } = await focusStore();
    const { todayStr } = await import('../lib/dates');
    actions.setTimeLevel('low');
    expect(dbMocks.saveStoredTimeLevel).toHaveBeenCalledWith({
      level: 'low', date: todayStr(),
    });
  });

  it('a non-owning tab never writes the level', async () => {
    tabLockMocks.acquireTabLock.mockResolvedValue(false);
    const { actions, getState } = await focusStore();
    expect(actions.setTimeLevel('low')).toBe(true);
    expect(getState().timeLevel).toBe('low');
    expect(dbMocks.saveStoredTimeLevel).not.toHaveBeenCalled();
  });

  it('hydrates a level set today', async () => {
    const { todayStr } = await import('../lib/dates');
    dbMocks.loadStoredTimeLevel.mockResolvedValueOnce({ level: 'low', date: todayStr() });
    const store = await freshStore();
    await store.initStore();
    expect(store.getState().timeLevel).toBe('low');
  });

  it('resets a level left behind on an earlier day', async () => {
    const { todayStr, addDays } = await import('../lib/dates');
    dbMocks.loadStoredTimeLevel.mockResolvedValueOnce({
      level: 'low', date: addDays(todayStr(), -1),
    });
    const store = await freshStore();
    await store.initStore();
    expect(store.getState().timeLevel).toBe('medium');
  });

  it('freezes the level onto the draft it starts', async () => {
    const { actions, getState } = await focusStore();
    actions.setTimeLevel('low');
    expect(actions.startFocus(ref, starter, t0)).toBe(true);
    expect(getState().activeFocusSession?.focusLevel).toBe('low');
  });

  it('carries low onto the logged session, and nothing onto the others', async () => {
    const { actions, getState } = await focusStore();

    actions.setTimeLevel('low');
    actions.startFocus(ref, starter, t0);
    expect(actions.completeFocus(t0 + 20 * MIN)).toBe('logged');
    expect(getState().sessions.at(-1)?.focus).toBe('low');

    actions.setTimeLevel('high');
    actions.startFocus(ref, starter, t0 + 30 * MIN);
    expect(actions.completeFocus(t0 + 50 * MIN)).toBe('logged');
    expect(getState().sessions.at(-1)?.focus).toBeUndefined();
  });

  it('carries the level a stale session started at through confirmation', async () => {
    const { actions, getState } = await focusStore();

    actions.setTimeLevel('low');
    actions.startFocus(ref, starter, t0);
    expect(actions.completeFocus(t0 + 200 * MIN)).toBe('needs-confirmation');
    // The dial moved while the draft sat in `confirming`; the session it logs
    // is still the one that ran in the loud room.
    actions.setTimeLevel('high');
    expect(actions.confirmFocus(90)).toBe(true);
    expect(getState().sessions.at(-1)?.focus).toBe('low');
  });
});

describe('the focus dial', () => {
  it('is set by setFocusLevel and reported back', async () => {
    const { todayStr } = await import('../lib/dates');
    const { actions, getState } = await freshStore();
    expect(getState().focusLevel).toBe('medium');
    expect(actions.setFocusLevel('low')).toBe(true);
    expect(getState().focusLevel).toBe('low');
    expect(dbMocks.saveStoredFocusLevel).toHaveBeenCalledWith({
      level: 'low', date: todayStr(),
    });
  });

  it('refuses a focus level that is not a level', async () => {
    const { actions } = await freshStore();
    expect(actions.setFocusLevel('enormous' as never)).toBe(false);
  });
});
