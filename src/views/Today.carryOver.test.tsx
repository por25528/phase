// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityWindow, Goal, Habit, Task } from '../db/types';
import { blocksOf } from '../lib/blocks';

/**
 * Today's zones were each conditional on something carrying today's date, so a
 * user with three live projects and an uncommitted week got one grey sentence
 * and a blank page. The free-time offer is the page answering on the day it
 * used to go quiet — and answering means writing a block, not linking to Plan.
 */

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: Habit[]; tasks: Task[]; sessions: never[] }> =>
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
  loadActiveFocusSession: vi.fn(async () => null),
  saveActiveFocusSession: vi.fn(async () => {}),
  loadAssistantAccelerator: vi.fn(async () => 'Command+Space'),
  saveAssistantAccelerator: vi.fn(async () => {}),
  loadStoredTimeLevel: vi.fn(async () => null),
  saveStoredTimeLevel: vi.fn(async () => {}),
  loadStoredFocusLevel: vi.fn(async () => null),
  saveStoredFocusLevel: vi.fn(async () => {}),
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
  habits?: Habit[];
  availability?: AvailabilityWindow[];
  onOpenSettings?: () => void;
} = {}) {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(over.goals ?? [project]),
    habits: structuredClone(over.habits ?? []),
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

/** A task whose day has passed, and a step whose week has. */
const slippedTask = (id: string, date: string): Task =>
  ({ id, title: id, done: false, goalId: null, date, estimateMin: 30 });

/**
 * Something committed to today, so Now has an answer of its own. A carry-over
 * is a candidate the advisor may lead with, and the one row Now is showing is
 * not also a row down here.
 */
const todayTask = (id: string): Task =>
  ({ id, title: id, done: false, goalId: null, date: TODAY, estimateMin: 30 });

describe('carried over', () => {
  it('shows the work it used to only count', async () => {
    await mountToday({
      goals: [],
      tasks: [slippedTask('Renew T pass', '2026-07-13'), todayTask('Stand-up')],
    });

    expect(screen.getByText('Carried over')).toBeTruthy();
    expect(screen.getByText('Renew T pass')).toBeTruthy();
    expect(screen.getByText('2d ago')).toBeTruthy();
  });

  /**
   * The free-time offer above spends the same word for the same act, so a
   * carry-over listed in both put two buttons with one name on the page. The
   * offer's exclude set is the advisor's `seen`, and this is what says so.
   */
  it('offers the placement once, however many sections could carry the row', async () => {
    await mountToday({
      goals: [],
      tasks: [slippedTask('Renew T pass', '2026-07-13'), todayTask('Stand-up')],
    });

    expect(screen.getAllByRole('button', { name: 'Plan “Renew T pass” today' })).toHaveLength(1);
  });

  it('orders oldest first', async () => {
    await mountToday({
      goals: [],
      tasks: [
        slippedTask('Yesterday thing', '2026-07-14'),
        slippedTask('Old thing', '2026-07-01'),
        todayTask('Stand-up'),
      ],
    });

    const section = screen.getByLabelText('Carried over');
    const titles = [...section.querySelectorAll('li')].map((li) => li.textContent);
    expect(titles[0]).toContain('Old thing');
    expect(titles[1]).toContain('Yesterday thing');
  });

  it('places a row on today and the row leaves the section', async () => {
    const store = await mountToday({
      goals: [],
      tasks: [slippedTask('Renew T pass', '2026-07-13'), todayTask('Stand-up')],
    });

    await act(async () => {
      screen.getByRole('button', { name: 'Plan “Renew T pass” today' }).click();
    });

    const [block] = blocksOf(store.getState().tasks[0]);
    expect(block).toMatchObject({ date: TODAY, startMin: 10 * 60 });
    expect(screen.queryByLabelText('Carried over')).toBeNull();
  });

  /** A distance booking, so a stray press is reversible. */
  it('arms an undo', async () => {
    const store = await mountToday({
      goals: [],
      tasks: [slippedTask('Renew T pass', '2026-07-13'), todayTask('Stand-up')],
    });

    await act(async () => {
      screen.getByRole('button', { name: 'Plan “Renew T pass” today' }).click();
    });

    expect(store.getState().pendingUndo?.label).toBe('Scheduled "Renew T pass"');
  });

  it('caps the list and says what it withheld, without offering a way out', async () => {
    await mountToday({
      goals: [],
      tasks: [
        ...Array.from({ length: 7 }, (_, i) => slippedTask(`slip ${i}`, `2026-07-0${i + 1}`)),
        todayTask('Stand-up'),
      ],
    });

    const section = screen.getByLabelText('Carried over');
    expect(section.querySelectorAll('li')).toHaveLength(5);
    // Static text, never a link: sending it to Plan is the dead end this
    // section exists to retire.
    const more = screen.getByText('+2 more');
    expect(more.closest('button')).toBeNull();
    expect(more.closest('a')).toBeNull();
  });

  it('says nothing at all when nothing slipped', async () => {
    await mountToday({ goals: [], tasks: [] });
    expect(screen.queryByLabelText('Carried over')).toBeNull();
  });

  /**
   * The whole complaint about the Attention row was that it named work and
   * then sent you somewhere else to find it. Both must not be true at once.
   */
  it('states the count once, as rows, never also as an exception', async () => {
    await mountToday({
      goals: [],
      tasks: [slippedTask('Renew T pass', '2026-07-13')],
    });

    expect(screen.getByText('Renew T pass')).toBeTruthy();
    expect(screen.queryByText(/slipped from an earlier day/)).toBeNull();
  });
});
