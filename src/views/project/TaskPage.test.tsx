// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const goalSeed: Goal = {
  id: 'g1',
  title: 'Fitness',
  nodes: [
    { id: 'n1', title: 'Run 5k', estimateMin: 45 },
    { id: 'n2', title: 'Book induction', status: 'blocked', blockedOn: 'front desk' },
  ],
};

type Store = typeof import('../../state/store');

/**
 * Boot a store holding `goalSeed`, open the goal and one of its leaves, and
 * render the page against live store state — the same shape `preparePanel`
 * uses in StepPanel.test.tsx, so an action's effect is readable through
 * `store.getState()`.
 */
async function mountTask(nodeId: string): Promise<Store> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(goalSeed)], habits: [], tasks: [], sessions: [],
  });
  const store = await import('../../state/store');
  await store.initStore();
  store.actions.openProject('g1');
  store.actions.openStep(nodeId);
  const { TaskPage } = await import('./TaskPage');
  const Host = () => {
    const current = store.useAppStore();
    const goal = current.goals.find((g) => g.id === 'g1')!;
    const node = goal.nodes.find((n) => n.id === nodeId)!;
    return createElement(TaskPage, {
      goal,
      node,
      backLabel: goal.title,
      onBack: () => current.actions.closeStep(),
    });
  };
  render(createElement(Host));
  return store;
}

describe('TaskPage', () => {
  it('states the task and offers a way back to what contains it', async () => {
    await mountTask('n1');

    expect(screen.getByRole('heading', { name: 'Run 5k' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Fitness/ })).toBeTruthy();
  });

  it('shows the blocked reason without opening the status popover', async () => {
    await mountTask('n2');

    // The reason is what makes a blocked task actionable. Behind the control
    // that set the status, the page could say "Blocked" and never say what by.
    // Plain DOM read: `@testing-library/jest-dom` is NOT installed in this
    // project, so `toHaveValue` does not exist. No test here uses it.
    expect((screen.getByLabelText('Blocked on') as HTMLInputElement).value).toBe('front desk');
  });

  it('completes through toggleLeaf, so the tick arms an undo', async () => {
    const store = await mountTask('n1');

    fireEvent.click(screen.getByRole('button', { name: /^Status: / }));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: /done/i }));
    });

    expect(store.getState().goals[0].nodes[0].status).toBe('done');
    expect(store.getState().pendingUndo).not.toBeNull();
  });

  it('offers rename, indent, outdent and delete — and not the chip verbs', async () => {
    await mountTask('n2');

    fireEvent.click(screen.getByRole('button', { name: /^Actions for / }));

    expect(screen.getByRole('menuitem', { name: /Rename/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Schedule/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Estimate/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Add task/ })).toBeNull();
  });

  it('offers to break the task into subtasks, since no tree row can here', async () => {
    await mountTask('n1');

    expect(screen.getByRole('button', { name: /Break .* into subtasks/ })).toBeTruthy();
  });

  it('edits the estimate in place, without a popover', async () => {
    await mountTask('n1');

    expect(screen.getByText('45m')).toBeTruthy();
  });

  it('offers to schedule a task that has no sitting', async () => {
    await mountTask('n2');

    expect(screen.getByRole('button', { name: 'Schedule: Not scheduled' })).toBeTruthy();
  });
});
