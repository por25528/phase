// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, Session } from '../../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: Session[] }> => ({
    goals: [], habits: [], tasks: [], sessions: [],
  })),
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
vi.mock('../../db/db', () => dbMocks);
vi.mock('../../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

type Store = typeof import('../../state/store');

/**
 * Boot a store holding one goal and render the project header against live
 * store state — the same store-boot shape `StepPanel.test.tsx` and
 * `TaskPage.test.tsx` use, so an action's effect is readable through
 * `store.getState()`.
 */
async function renderProjectHeader(params: {
  title: string;
  isCompleted?: boolean;
}): Promise<Store> {
  vi.resetModules();
  const goal: Goal = {
    id: 'g1',
    title: params.title,
    ...(params.isCompleted ? { completedAt: '2026-08-01' } : {}),
    nodes: [],
  };
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [goal], habits: [], tasks: [], sessions: [],
  });
  const store = await import('../../state/store');
  await store.initStore();
  const { ProjectHeader } = await import('./ProjectHeader');
  const Host = () => {
    const current = store.useAppStore();
    const liveGoal = current.goals.find((g) => g.id === 'g1')!;
    return createElement(ProjectHeader, {
      goal: liveGoal,
      actions: current.actions,
      backLabel: 'Goals',
      onBack: () => {},
    });
  };
  render(createElement(Host));
  return store;
}

/**
 * The goal-level tag lives in the header's control group, NOT inside the
 * overflow menu: the menu holds Complete/Reopen — irreversible lifecycle verbs
 * — and a property editor among them would read as one. One gesture here tags
 * every node the project inherits from.
 */
describe('ProjectHeader focus needed', () => {
  it('is absent on a completed project, which is frozen', async () => {
    await renderProjectHeader({ title: 'Thesis', isCompleted: true });

    expect(screen.queryByRole('button', { name: /Focus needed/ })).toBeNull();
  });
});

/**
 * The density pass: health becomes one pill instead of the first link in a
 * four-fact dot-chain, and the demand control leaves the header line — it
 * moves into `GoalMetaPopover` (Task 5), which is a property, not a header
 * fact.
 */
describe('the header after the density pass', () => {
  it('no longer carries a demand control — that is a property, and it lives with the properties', async () => {
    await renderProjectHeader({ title: 'Systems' });
    expect(screen.queryByRole('button', { name: /Focus needed/ })).toBeNull();
  });

  /*
   * The pill said "On track" / "At risk", and it came from `goalHealth`, which
   * priced the work remaining against the free hours before the deadline.
   * There are no free hours, so there is no verdict — and a header that kept
   * the object while losing the arithmetic behind it would be a label nobody
   * could act on.
   */
  it('carries no health pill — nothing forecasts a goal any more', async () => {
    await renderProjectHeader({ title: 'Systems' });
    expect(screen.queryByTestId('health-pill')).toBeNull();
  });
});
