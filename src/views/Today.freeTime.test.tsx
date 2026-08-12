// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityWindow, Goal, Task } from '../db/types';
import { blocksOf } from '../lib/blocks';

/**
 * Today's zones were each conditional on something carrying today's date, so a
 * user with three live projects and an uncommitted week got one grey sentence
 * and a blank page. The free-time offer is the page answering on the day it
 * used to go quiet — and answering means writing a block, not linking to Plan.
 */

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: Task[]; sessions: never[] }> =>
    ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async (): Promise<AvailabilityWindow[]> => []),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => []),
  loadPlanMode: vi.fn(async () => 'week' as const),
  savePlanMode: vi.fn(async () => {}),
  loadGoalsMode: vi.fn(async (): Promise<'board' | 'timeline'> => 'board'),
  saveGoalsMode: vi.fn(async () => {}),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAvailability: vi.fn(async () => {}),
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
const WORKDAY: AvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
  dow, startMin: 9 * 60, endMin: 17 * 60,
}));

const project: Goal = {
  id: 'g1', title: 'Thesis', column: 0,
  nodes: [{ id: 'n1', title: 'Draft the intro', estimateMin: 60 }],
};

async function mountToday(over: {
  goals?: Goal[];
  tasks?: Task[];
  availability?: AvailabilityWindow[];
  onOpenSettings?: () => void;
} = {}) {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(over.goals ?? [project]),
    habits: [],
    tasks: structuredClone(over.tasks ?? []),
    sessions: [],
  });
  dbMocks.loadAvailability.mockResolvedValueOnce(over.availability ?? WORKDAY);
  const store = await import('../state/store');
  await store.initStore();
  const { Today } = await import('./Today');
  render(createElement(Today, { onOpenSettings: over.onOpenSettings ?? (() => {}) }));
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

describe('the free-time offer', () => {
  it('shows committed work once even when it is also eligible for the offer', async () => {
    await mountToday({
      goals: [{
        id: 'g1', title: 'Thesis', column: 0,
        nodes: [
          { id: 'n1', title: 'Draft the intro', plannedWeek: '2026-07-13' },
          { id: 'n2', title: 'Revise the intro', plannedWeek: '2026-07-13' },
        ],
      }],
    });

    const countTitle = (title: string) => [...document.querySelectorAll('span')]
      .filter((span) => span.textContent === title).length;
    expect(countTitle('Draft the intro')).toBe(1);
    expect(countTitle('Revise the intro')).toBe(1);
  });

  it('offers a project’s next action when the day is uncommitted', async () => {
    await mountToday();

    expect(screen.getByText('7h free today')).toBeTruthy(); // 10:00 → 17:00
    expect(screen.getByRole('button', { name: 'Plan “Draft the intro” today' })).toBeTruthy();
    // The Now zone stays silent: two messages both saying "nothing" is the
    // apologetic page this replaces.
    expect(screen.queryByText(/Nothing committed to today/)).toBeNull();
  });

  it('books the step at the next free minute, and the row leaves', async () => {
    const store = await mountToday();

    await act(async () => {
      screen.getByRole('button', { name: 'Plan “Draft the intro” today' }).click();
    });

    const [block] = blocksOf(store.getState().goals[0].nodes[0]);
    expect(block).toMatchObject({ date: TODAY, startMin: 10 * 60, minutes: 60 });
    // Placed work is not backlog, so the offer drops it — and the item is now
    // upstairs in Now.
    expect(screen.queryByRole('button', { name: 'Plan “Draft the intro” today' })).toBeNull();
    expect(screen.getByText('Draft the intro')).toBeTruthy();
  });

  /**
   * The row IS the button, so there is no way to touch this zone without
   * booking something. A press you did not mean used to cost a trip to Plan.
   */
  it('a booking made by accident can be taken back', async () => {
    const store = await mountToday();

    await act(async () => {
      screen.getByRole('button', { name: 'Plan “Draft the intro” today' }).click();
    });
    expect(store.getState().pendingUndo?.label).toBe('Scheduled "Draft the intro"');

    await act(async () => {
      store.actions.undoLastDelete();
    });

    // Unplaced again, so `backlogGroups` re-includes it and the offer returns.
    expect(blocksOf(store.getState().goals[0].nodes[0])).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Plan “Draft the intro” today' })).toBeTruthy();
  });

  it('books a loose task too', async () => {
    const store = await mountToday({
      goals: [],
      tasks: [{ id: 't1', title: 'Renew T pass', done: false, goalId: null, estimateMin: 30 }],
    });

    await act(async () => {
      screen.getByRole('button', { name: 'Plan “Renew T pass” today' }).click();
    });

    expect(blocksOf(store.getState().tasks[0])).toHaveLength(1);
  });

  /**
   * The Sunday-evening case. The window has closed, so the offer names the day
   * it will actually book rather than pretending there is time left.
   */
  it('rolls to the next open day once today’s window has closed', async () => {
    vi.setSystemTime(new Date(2026, 6, 15, 19, 0, 0));
    const store = await mountToday();

    expect(screen.getByText('No time left today — tomorrow has 8h free')).toBeTruthy();
    await act(async () => {
      screen.getByRole('button', { name: 'Plan “Draft the intro” tomorrow' }).click();
    });

    expect(blocksOf(store.getState().goals[0].nodes[0])[0]).toMatchObject({
      date: '2026-07-16', startMin: 9 * 60,
    });
  });

  it('says nobody set working hours rather than claiming there is no time', async () => {
    const onOpenSettings = vi.fn();
    await mountToday({ availability: [], onOpenSettings });

    expect(screen.getByText(/No working hours set/)).toBeTruthy();
    screen.getByRole('button', { name: 'Set your working hours' }).click();
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('offers nothing when there is nothing left to place', async () => {
    await mountToday({ goals: [] });

    expect(screen.queryByLabelText('Free time')).toBeNull();
    expect(screen.getByText(/Nothing committed to today/)).toBeTruthy();
  });
});
