// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, Habit, Session, Task } from '../db/types';

/**
 * Today's zones were each conditional on something carrying today's date, so a
 * user with three live projects and an uncommitted week got one grey sentence
 * and a blank page. The free-time offer is the page answering on the day it
 * used to go quiet — and answering means writing a block, not linking to Plan.
 */

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: Habit[]; tasks: Task[]; sessions: Session[] }> =>
    ({ goals: [], habits: [], tasks: [], sessions: [] })),
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
  loadShelfPrefs: vi.fn(async () => ({ width: 'default', density: 'comfortable', position: 'center', sections: { alternatives: true, dials: true } })),
  saveShelfPrefs: vi.fn(async () => {}),
}));
vi.mock('../db/db', () => dbMocks);
vi.mock('../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

/** Wednesday 10:00, so "today" still has room and the clock decides nothing. */
const TODAY = '2026-07-15';

const project: Goal = {
  id: 'g1', title: 'Thesis', column: 0,
  nodes: [{ id: 'n1', title: 'Draft the intro', estimateMin: 60 }],
};

async function mountToday(over: {
  goals?: Goal[];
  tasks?: Task[];
  habits?: Habit[];
  sessions?: Session[];
  onOpenSettings?: () => void;
} = {}) {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(over.goals ?? [project]),
    habits: structuredClone(over.habits ?? []),
    tasks: structuredClone(over.tasks ?? []),
    sessions: structuredClone(over.sessions ?? []),
  });
  const store = await import('../state/store');
  await store.initStore();
  const { Today } = await import('./Today');
  render(createElement(Today, {}));
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 15, 10, 0, 0));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Finished today: `done` plus a `doneAt` equal to today is what buildDailyWork keys on. */
const doneTask = (id: string): Task =>
  ({ id, title: id, done: true, doneAt: TODAY, goalId: null });

describe('done today', () => {
  it('lists what was finished, struck through', async () => {
    await mountToday({ goals: [], tasks: [doneTask('Renew T pass')] });

    expect(screen.getByLabelText('Done today')).toBeTruthy();
    const title = screen.getByText('Renew T pass');
    expect(title.className).toContain('line-through');
  });

  /**
   * The section REPLACES the sentence. Asserting its absence is what stops the
   * two ever shipping together and stating the same fact twice.
   */
  it('replaces the finished-today sentence rather than joining it', async () => {
    await mountToday({ goals: [], tasks: [doneTask('Renew T pass')] });

    expect(screen.queryByText(/finished today/)).toBeNull();
  });

  it('un-ticking a row un-completes it and the row leaves', async () => {
    const store = await mountToday({ goals: [], tasks: [doneTask('Renew T pass')] });

    await act(async () => {
      screen.getByRole('checkbox', { name: 'Mark "Renew T pass" as not done' }).click();
    });

    expect(store.getState().tasks[0].done).toBe(false);
    expect(screen.queryByLabelText('Done today')).toBeNull();
  });

  /** Un-ticking IS the undo. A toast offering to undo an undo is noise. */
  it('arms no undo when un-ticking', async () => {
    const store = await mountToday({ goals: [], tasks: [doneTask('Renew T pass')] });

    await act(async () => {
      screen.getByRole('checkbox', { name: 'Mark "Renew T pass" as not done' }).click();
    });

    expect(store.getState().pendingUndo).toBeFalsy();
  });

  it('states what the work cost, when time was logged for it today', async () => {
    await mountToday({
      goals: [],
      tasks: [doneTask('Renew T pass')],
      sessions: [{
        id: 's1', goalId: null, taskId: 'Renew T pass',
        date: TODAY, minutes: 45, note: '',
      }],
    });

    expect(screen.getByText('45m')).toBeTruthy();
  });

  /** Most work is finished without a logged session; 0m would report a measurement nobody took. */
  it('says nothing about time when none was logged', async () => {
    await mountToday({ goals: [], tasks: [doneTask('Renew T pass')] });

    expect(screen.queryByText('0m')).toBeNull();
  });

  it('says nothing at all when nothing was finished', async () => {
    await mountToday({ goals: [], tasks: [] });

    expect(screen.queryByLabelText('Done today')).toBeNull();
  });

  /**
   * `completedToday` walks `allLeaves`, not `activeLeaves` — the one place this
   * section's membership differs from every neighbour, which filters completed
   * goals out. Finishing the goal does not erase the last thing you finished
   * inside it.
   */
  it('keeps a leaf finished inside a goal that was completed today', async () => {
    await mountToday({
      goals: [{
        id: 'g1', title: 'Thesis', column: 0, completedAt: TODAY,
        nodes: [{ id: 'n1', title: 'Draft the intro', status: 'done', doneAt: TODAY }],
      }],
      tasks: [],
    });

    expect(screen.getByLabelText('Done today')).toBeTruthy();
    expect(screen.getByText('Draft the intro')).toBeTruthy();
  });
});
