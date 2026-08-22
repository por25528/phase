import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import type { Asset, Goal, Task } from '../db/types';
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

/**
 * `previewPlacement` is the landing outline's answer, and the ONE thing it has
 * to be is the same answer the write gives.
 *
 * These tests never assert a minute in isolation. Every one of them asks the
 * preview, then performs the write, then compares — because a preview that is
 * merely plausible is exactly the defect this closes: the outline promised
 * 10:00, `resolveSlot` slid the bar to 11:30, and the user found out after they
 * had let go.
 */
describe('previewPlacement', () => {
  const WED = '2026-07-15';

  const goal: Goal = {
    id: 'g1',
    title: 'Algorithms',
    nodes: [
      { id: 'n1', title: 'Problem set 4', estimateMin: 90 },
      { id: 'n2', title: 'Reading', estimateMin: 60 },
      { id: 'parent', title: 'Unit 3', children: [{ id: 'kid', title: 'A leaf' }] },
    ],
  };

  async function planStore(goals: Goal[] = [goal], tasks: Task[] = []) {
    const { loadState } = await import('../db/db');
    vi.mocked(loadState).mockResolvedValueOnce({
      goals: structuredClone(goals), habits: [], tasks: structuredClone(tasks), sessions: [], lives: [],
    });
    const store = await freshStore();
    await store.initStore();
    return store;
  }

  const step = { kind: 'step' as const, id: 'n1', goalId: 'g1' };

  it('names the minute the write then chooses, on an empty day', async () => {
    const { actions, getState, previewPlacement } = await planStore();

    const preview = previewPlacement(step, WED, 600);
    expect(preview).toEqual({ startMin: 600, durationMin: 90 });

    expect(actions.scheduleNode('g1', 'n1', WED, 600)).toBe(true);
    expect(getState().goals[0].nodes[0].blocks![0].startMin).toBe(preview!.startMin);
  });

  it('SLIDES past occupied work, and says so before the drop', async () => {
    // The whole point. Aiming at 10:00 with 09:00-10:30 already taken lands at
    // 10:30, and the outline has to be sitting at 10:30 while the block is
    // still in the air rather than after it is written.
    const { actions, getState, previewPlacement } = await planStore();
    expect(actions.scheduleNode('g1', 'n2', WED, 540)).toBe(true); // 09:00-10:00

    const preview = previewPlacement(step, WED, 570); // aimed at 09:30, inside it
    expect(preview!.startMin).not.toBe(570);

    expect(actions.scheduleNode('g1', 'n1', WED, 570)).toBe(true);
    const written = getState().goals[0].nodes[0].blocks![0].startMin;
    expect(written).toBe(preview!.startMin);
  });

  it('snaps the aim to the same 5-minute grid the write does', async () => {
    const { actions, getState, previewPlacement } = await planStore();
    const preview = previewPlacement(step, WED, 602); // 10:02
    expect(preview!.startMin).toBe(600);

    expect(actions.scheduleNode('g1', 'n1', WED, 602)).toBe(true);
    expect(getState().goals[0].nodes[0].blocks![0].startMin).toBe(preview!.startMin);
  });

  it('writes nothing, arms no undo and raises no toast', async () => {
    const { getState, previewPlacement } = await planStore();
    const before = structuredClone(getState().goals);

    previewPlacement(step, WED, 600);
    previewPlacement(step, WED, 900);

    expect(getState().goals).toEqual(before);
    expect(getState().pendingUndo).toBeFalsy();
    expect(getState().toast).toBeFalsy();
  });

  it('answers null on a day booked solid — the outline simply does not draw', async () => {
    const { actions, getState, previewPlacement } = await planStore();
    // One sitting stretched across the whole day leaves no gap that fits 90m.
    expect(actions.scheduleNode('g1', 'n2', WED, 0)).toBe(true);
    const blockId = getState().goals[0].nodes[1].blocks![0].id;
    actions.resizeNode('n2', blockId, 1440);
    expect(getState().goals[0].nodes[1].blocks![0].minutes).toBe(1440);

    expect(previewPlacement(step, WED, 600)).toBeNull();

    // And the write refuses too — same condition, stated in words by the toast
    // and by the day heading's `full` chip. Nothing is lost by the outline
    // simply not appearing.
    expect(actions.scheduleNode('g1', 'n1', WED, 600)).toBe(false);
  });

  it('refuses a container, exactly as scheduleNode does', async () => {
    const { actions, previewPlacement } = await planStore();
    expect(previewPlacement({ kind: 'step', id: 'parent', goalId: 'g1' }, WED, 600)).toBeNull();
    expect(actions.scheduleNode('g1', 'parent', WED, 600)).toBe(false);
  });

  it('refuses an id that is not there', async () => {
    const { previewPlacement } = await planStore();
    expect(previewPlacement({ kind: 'step', id: 'nope', goalId: 'g1' }, WED, 600)).toBeNull();
    expect(previewPlacement({ kind: 'task', id: 'nope', goalId: null }, WED, 600)).toBeNull();
  });

  it('previews a MOVE against the bar it is vacating, not against itself', async () => {
    // `blockId` names the sitting being dragged. Leave it in the occupancy and
    // the block collides with the self it is in the middle of moving, and a
    // re-drop a few minutes away slides past its own aim.
    const { actions, getState, previewPlacement } = await planStore();
    expect(actions.scheduleNode('g1', 'n1', WED, 540)).toBe(true);
    const blockId = getState().goals[0].nodes[0].blocks![0].id;

    const preview = previewPlacement(step, WED, 570, { blockId });
    expect(preview).toEqual({ startMin: 570, durationMin: 90 });

    expect(actions.scheduleNode('g1', 'n1', WED, 570, { blockId })).toBe(true);
    expect(getState().goals[0].nodes[0].blocks![0].startMin).toBe(preview!.startMin);
  });

  it('carries the SITTING\'s own length when moving, not the estimate', async () => {
    const { actions, getState, previewPlacement } = await planStore();
    expect(actions.scheduleNode('g1', 'n1', WED, 540)).toBe(true);
    const blockId = getState().goals[0].nodes[0].blocks![0].id;
    actions.resizeNode('n1', blockId, 30);

    // The estimate is still 90; the bar being dragged is 30.
    expect(previewPlacement(step, WED, 660, { blockId })!.durationMin).toBe(30);
  });

  it('works for a loose task on the same terms', async () => {
    const tasks: Task[] = [{ id: 't1', title: 'Email', estimateMin: 30, done: false, goalId: null }];
    const { actions, getState, previewPlacement } = await planStore([goal], tasks);
    const target = { kind: 'task' as const, id: 't1', goalId: null };

    const preview = previewPlacement(target, WED, 600);
    expect(preview).toEqual({ startMin: 600, durationMin: 30 });

    expect(actions.scheduleTask('t1', WED, 600)).toBe(true);
    expect(getState().tasks[0].blocks![0].startMin).toBe(preview!.startMin);
  });
});
