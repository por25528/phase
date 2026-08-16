// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityWindow, Goal, Session } from '../../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: Session[] }> => ({
    goals: [], habits: [], tasks: [], sessions: [],
  })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async (): Promise<AvailabilityWindow[]> => []),
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
  loadActiveFocusSession: vi.fn(async () => null),
  saveActiveFocusSession: vi.fn(async () => {}),
  loadAssistantAccelerator: vi.fn(async () => 'Command+Space'),
  saveAssistantAccelerator: vi.fn(async () => {}),
  loadStoredTimeLevel: vi.fn(async () => null),
  saveStoredTimeLevel: vi.fn(async () => {}),
  loadStoredFocusLevel: vi.fn(async () => null),
  saveStoredFocusLevel: vi.fn(async () => {}),
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

  it('states health as one object', async () => {
    await renderProjectHeader({ title: 'Systems' });
    const pill = screen.getByTestId('health-pill');
    expect(pill.className).toContain('rounded-[4px]');
    expect(pill.className).toContain('font-semibold');
  });

  it('paints no warning colour on a goal that is not at risk', async () => {
    await renderProjectHeader({ title: 'Systems' });
    expect(screen.getByTestId('health-pill').className).not.toContain('text-warn');
  });
});
