// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, GoalNode } from '../db/types';
import { makeBlock } from '../lib/blocks';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: never[] }> => ({ goals: [], habits: [], tasks: [], sessions: [] })),
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
}));
vi.mock('../db/db', () => dbMocks);
vi.mock('../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

// jsdom implements no media queries; `usePrefersReducedMotion` reads one from a
// useState initialiser, so it runs before any effect could guard it.
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

type Store = typeof import('../state/store');

// The reference `mountTree` in GoalTree.selection.test.tsx mounts a fixed
// project; this file's cases need to vary the leaf's `status`/`blockedOn`
// per test, so it takes the node array instead — everything else (the
// db-mock block above, the render wiring, the store subscription) is the
// same helper, copied verbatim.
async function mountTree(nodes: GoalNode[]): Promise<{ store: Store; user: ReturnType<typeof userEvent.setup> }> {
  vi.resetModules();
  const PROJECT: Goal = { id: 'g', title: 'Project', column: 0, nodes };
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(PROJECT)], habits: [], tasks: [], sessions: [],
  });
  const store = await import('../state/store');
  await store.initStore();
  const { GoalTree } = await import('./GoalTree');
  // Subscribed, exactly as the `Project` page does — it reads `goal.nodes` from the
  // store on every render. Passing a captured snapshot instead would freeze the
  // tree, and the selection's pruning is precisely the behaviour that depends
  // on `nodes` changing identity when the data does.
  const TreeHost = () => {
    const { goals } = store.useAppStore();
    return createElement(GoalTree, { nodes: goals[0].nodes });
  };
  render(createElement(TreeHost));
  return { store, user: userEvent.setup() };
}

const row = (title: string): HTMLElement => screen.getByText(title).closest('[data-row]') as HTMLElement;

beforeEach(() => vi.clearAllMocks());
// RTL's automatic cleanup only registers under `globals: true`; without this,
// every render stays in the document and `getByRole` sees the previous tests'.
afterEach(() => cleanup());

describe('a step says where it stands', () => {
  it('shows the status on the box, and a plain click still only toggles done', async () => {
    const { store, user } = await mountTree([{ id: 'a', title: 'A' }]);
    const { findInAll } = await import('../lib/tree');

    // The box is the status control, but click is unchanged: todo → done.
    await user.click(screen.getByRole('checkbox', { name: /Mark "A" as done/ }));
    expect(findInAll(store.getState().goals, 'a')?.status).toBe('done');
  });

  it('cycles todo → doing → blocked → todo on S, never reaching done', async () => {
    const { store, user } = await mountTree([{ id: 'a', title: 'A' }]);
    const { findInAll } = await import('../lib/tree');
    row('A').focus();

    await user.keyboard('s');
    expect(findInAll(store.getState().goals, 'a')?.status).toBe('doing');
    await user.keyboard('s');
    expect(findInAll(store.getState().goals, 'a')?.status).toBe('blocked');
    await user.keyboard('s');
    expect(findInAll(store.getState().goals, 'a')?.status).toBeUndefined();
  });

  it('sends a done step back to todo rather than on to doing', async () => {
    const { store, user } = await mountTree([{ id: 'a', title: 'A', status: 'done' }]);
    const { findInAll } = await import('../lib/tree');
    row('A').focus();
    await user.keyboard('s');
    expect(findInAll(store.getState().goals, 'a')?.status).toBeUndefined();
  });

  it('names the status in the checkbox label so it is not colour-only', async () => {
    await mountTree([{ id: 'a', title: 'A', status: 'blocked', blockedOn: 'the grader' }]);
    expect(screen.getByRole('checkbox', { name: /blocked/i })).toBeTruthy();
  });

  it('shows why a step is blocked', async () => {
    await mountTree([{ id: 'a', title: 'A', status: 'blocked', blockedOn: 'the grader' }]);
    expect(screen.getByText(/the grader/)).toBeTruthy();
  });

  it('leaves S alone while a rename editor is open', async () => {
    const { store, user } = await mountTree([{ id: 'a', title: 'A' }]);
    const { findInAll } = await import('../lib/tree');
    await user.dblClick(screen.getByText('A'));
    await user.keyboard('s');
    expect(findInAll(store.getState().goals, 'a')?.status).toBeUndefined();
  });

  // ⌘S is deep muscle memory for "save" in a packaged Electron app; the S
  // handler must be gated by the same `plain` (no-modifier) flag every other
  // bare-key handler in this component uses, or ⌘S silently cycles status
  // instead of doing nothing.
  it('does not cycle status when S is held with a modifier', async () => {
    const { store, user } = await mountTree([{ id: 'a', title: 'A' }]);
    const { findInAll } = await import('../lib/tree');
    row('A').focus();
    await user.keyboard('{Meta>}s{/Meta}');
    expect(findInAll(store.getState().goals, 'a')?.status).toBeUndefined();
  });

  // The ◐ hover control is gated `!hasKids` in the markup — a container's
  // status is derived, never stored, so it must never render one.
  it('shows the status-cycle control on a leaf but not on a container', async () => {
    await mountTree([
      { id: 'leaf', title: 'Leaf' },
      { id: 'grp', title: 'Group', children: [{ id: 'c1', title: 'Child' }] },
    ]);
    expect(screen.getByRole('button', { name: 'Change status of "Leaf"' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change status of "Group"' })).toBeNull();
  });
});

/**
 * The row now says WHEN, in a fixed column beside the estimate. A node has
 * carried `plannedStartMin`, `plannedDay`, `plannedWeek` and `deadline` for a
 * long time with nowhere on the row to show any of them.
 */
describe('the schedule column', () => {
  it('names the day a task is placed on', async () => {
    const { todayStr } = await import('../lib/dates');
    await mountTree([{ id: 'a', title: 'Problems 1–15', plannedWeek: '2020-01-06', blocks: [makeBlock(todayStr(), 840, 60)] }]);
    expect(screen.getByText(/^Today /)).toBeTruthy();
  });

  it('warns when the day it was placed on has been and gone', async () => {
    await mountTree([{ id: 'a', title: 'Slipped', plannedWeek: '2020-01-06', blocks: [makeBlock('2020-01-07', 540, 60)] }]);
    expect(screen.getByText(/^Jan 7 /).className).toContain('text-warn');
  });

  it('falls through to a deadline when nothing is committed', async () => {
    await mountTree([{ id: 'a', title: 'Exam', deadline: '2099-08-24' }]);
    expect(screen.getByText('Due Aug 24')).toBeTruthy();
  });
});
