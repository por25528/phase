// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, Habit, Task } from '../db/types';

/**
 * Today's Now row takes the same "Do this first" verb the shelf already
 * offers — `actions.insertWorkBefore` — so the correction is one write
 * whichever surface it is pressed from, and the new step leads the page the
 * moment it lands.
 */

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: Habit[]; tasks: Task[]; sessions: never[] }> =>
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

/** A task committed to today, so Now has a primary of its own to insert before. */
const todayTask = (id: string): Task =>
  ({ id, title: id, done: false, goalId: null, date: TODAY, estimateMin: 30 });

async function mountToday(over: {
  goals?: Goal[];
  tasks?: Task[];
  habits?: Habit[];
} = {}) {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(over.goals ?? []),
    habits: structuredClone(over.habits ?? []),
    tasks: structuredClone(over.tasks ?? []),
    sessions: [],
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

describe('Do first', () => {
  it('inserts before the primary and the new step leads the page', async () => {
    await mountToday({
      tasks: [todayTask('write'), todayTask('submit')],
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Do first' }));
    });
    const input = screen.getByLabelText('Do this first');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Review notes' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    // the Now row now names the inserted step
    expect(within(screen.getByRole('region', { name: 'Now' })).getByText('Review notes')).toBeTruthy();
  });

  it('marks its wrapper data-insert-first, so the shelf\'s capture-phase Escape guard stands aside', async () => {
    await mountToday({
      tasks: [todayTask('write')],
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Do first' }));
    });

    expect(document.querySelector('[data-insert-first]')).toBeTruthy();
  });
});
