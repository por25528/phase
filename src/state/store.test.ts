import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db/db', () => ({
  loadState: vi.fn(async () => ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadZoom: vi.fn(async () => 'year'),
  saveZoom: vi.fn(async () => {}),
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

  it('toggleHabit adds then removes a today check-in', async () => {
    const { actions, getState } = await freshStore();
    actions.addHabit('Run', 'daily', 4);
    const hid = getState().habits[0].id;
    actions.toggleHabit(hid);
    expect(getState().habits[0].checkins).toHaveLength(1);
    actions.toggleHabit(hid);
    expect(getState().habits[0].checkins).toHaveLength(0);
  });

  it('moveTaskToDate reschedules a task', async () => {
    const { actions, getState } = await freshStore();
    actions.addTask('T', '2026-01-05', null);
    actions.moveTaskToDate(getState().tasks[0].id, '2026-07-02');
    expect(getState().tasks[0].date).toBe('2026-07-02');
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
});
