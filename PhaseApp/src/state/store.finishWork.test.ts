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
  const MIN = 60_000;
  const starter = { kind: 'starter' as const, minutes: 30 as const };

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

  it('logs the sitting and ticks the task in ONE undoable write', async () => {
    const { actions, getState } = await workStore();
    actions.startFocus(ref, starter, t0);

    expect(actions.finishWork(ref, t0 + 12 * MIN)).toEqual({
      outcome: 'done',
      label: 'Completed "Problem set 4" · logged 12m',
    });

    expect(getState().sessions).toHaveLength(1);
    expect(getState().sessions[0].minutes).toBe(12);
    expect(getState().sessions[0].nodeId).toBe('n1');
    expect(isDone(getState().goals[0].nodes[0])).toBe(true);
    expect(getState().activeFocusSession).toBeNull();
    expect(getState().pendingUndo?.label).toBe('Completed "Problem set 4" · logged 12m');
  });

  /*
   * The whole reason this action exists rather than two calls. Two sequential
   * withUndo writes would let the second sweep the first, so undo would
   * un-tick the task and leave the minutes logged.
   */
  it('undo restores BOTH slices, never half of them', async () => {
    const { actions, getState } = await workStore();
    actions.startFocus(ref, starter, t0);
    actions.finishWork(ref, t0 + 12 * MIN);

    actions.undoLastDelete();

    expect(getState().sessions).toEqual([]);
    expect(isDone(getState().goals[0].nodes[0])).toBe(false);
  });

  it('freezes the TIME level onto the session, exactly as completeFocus does', async () => {
    const { actions, getState } = await workStore();
    actions.setTimeLevel('low');
    actions.startFocus(ref, starter, t0);

    actions.finishWork(ref, t0 + 12 * MIN);

    expect(getState().sessions[0].focus).toBe('low');
  });

  /*
   * The tick is certain — you said you finished. The minutes are not: a session
   * that "ran" nine hours is more likely a laptop lid than a marathon, and
   * logging it would poison the history behind every "Usually 45-60m" the shelf
   * shows. One slice, so undo stays whole; the draft parks for its own question.
   */
  it('ticks the task but parks a stale sitting instead of logging it', async () => {
    const { actions, getState } = await workStore();
    actions.startFocus(ref, starter, t0);

    expect(actions.finishWork(ref, t0 + 200 * MIN)).toEqual({
      outcome: 'needs-confirmation',
      label: 'Completed "Problem set 4"',
    });

    expect(isDone(getState().goals[0].nodes[0])).toBe(true);
    expect(getState().sessions).toEqual([]);
    expect(getState().activeFocusSession?.phase).toBe('confirming');
    expect(getState().activeFocusSession?.proposedMinutes).toBe(200);
  });

  it('leaves a draft about other work completely alone', async () => {
    const { actions, getState } = await workStore([{
      id: 'g1', title: 'Algorithms',
      nodes: [{ id: 'n1', title: 'Problem set 4' }, { id: 'n2', title: 'Read chapter 3' }],
    }]);
    actions.startFocus({ kind: 'step', id: 'n2', goalId: 'g1' }, starter, t0);

    expect(actions.finishWork(ref, t0 + 12 * MIN)).toEqual({
      outcome: 'done',
      label: 'Completed "Problem set 4"',
    });

    expect(getState().sessions).toEqual([]);
    expect(getState().activeFocusSession?.ref.id).toBe('n2');
    expect(getState().activeFocusSession?.phase).toBe('active');
  });

  /*
   * The shelf's checkbox is not the only way to finish work: Today's row, the
   * bulk bar and the agent socket all reach `toggleLeaf`/`toggleTask`, and
   * none of them knew a draft was running. The shelf then showed a session
   * still ticking on a task the page below it had struck through.
   */
  describe('a draft settles when its work is finished by any other path', () => {
    it('parks in confirming when toggleLeaf ticks the draft\'s own step', async () => {
      const { actions, getState } = await workStore();
      actions.startFocus(ref, starter, t0);
      actions.toggleLeaf('n1');
      expect(isDone(getState().goals[0].nodes[0])).toBe(true);
      expect(getState().activeFocusSession?.phase).toBe('confirming');
      // The completing write's undo survives: nothing else was written.
      expect(getState().pendingUndo?.label).toBe('Completed "Problem set 4"');
      expect(getState().sessions).toEqual([]);
    });

    it('is discarded when the step is deleted', async () => {
      const { actions, getState } = await workStore();
      actions.startFocus(ref, starter, t0);
      actions.removeNodes(['n1']);
      expect(getState().activeFocusSession).toBeNull();
    });

    it('is untouched by edits to other work', async () => {
      const { actions, getState } = await workStore([{
        ...goal, nodes: [...goal.nodes, { id: 'n2', title: 'Other' }],
      }]);
      actions.startFocus(ref, starter, t0);
      actions.toggleLeaf('n2');
      expect(getState().activeFocusSession?.phase).toBe('active');
    });
  });
});
