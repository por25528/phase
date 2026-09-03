// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, Habit, Task } from '../db/types';

/**
 * A task captured with no project and no date used to reach Today only if the
 * free-time offer happened to have room for it. The Loose tasks section is the
 * page owning that work: capped, deduplicated against everything already on
 * screen, completable in place.
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

// Wednesday 10:00 (see `beforeEach`), so the committed week is 2026-07-13.

const project: Goal = {
  id: 'g1', title: 'Thesis', column: 0,
  nodes: [{ id: 'n1', title: 'Draft the intro', estimateMin: 60 }],
};

async function mountToday(over: {
  goals?: Goal[];
  tasks?: Task[];
  habits?: Habit[];
  onOpenSettings?: () => void;
} = {}) {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(over.goals ?? [project]),
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

describe('a topic on Today', () => {
  const WEEK = '2026-07-13';
  const subject: Goal = {
    id: 'g1', title: 'Algorithms', type: 'study', column: 0,
    nodes: [{ id: 'area', title: 'Topics', topics: true, children: [
      { id: 'graphs', title: 'Graphs', plannedWeek: WEEK, estimateMin: 45, confidence: 'okay', confidenceAt: '2026-07-10' },
      { id: 'trees', title: 'Trees', plannedWeek: WEEK, estimateMin: 45 },
    ] }, { id: 'ps', title: 'Problem set', plannedWeek: WEEK, estimateMin: 60 }],
  };

  it('draws the confidence mark where a step has its checkbox, and still offers a session', async () => {
    await mountToday({ goals: [subject] });
    expect(screen.queryByRole('checkbox', { name: 'Mark "Graphs" as done' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Mark "Trees" as done' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Okay' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Not rated' })).toBeTruthy();
    // The step beside them keeps its tick.
    expect(screen.getByRole('checkbox', { name: 'Mark "Problem set" as done' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Start session on/ })).toBeTruthy();
  });
});
