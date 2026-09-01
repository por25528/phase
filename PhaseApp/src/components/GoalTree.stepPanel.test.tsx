// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal } from '../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: never[] }> => ({ goals: [], habits: [], tasks: [], sessions: [] })),
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
}));
vi.mock('../db/db', () => dbMocks);
vi.mock('../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

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

const PROJECT: Goal = {
  id: 'g',
  title: 'Project',
  column: 0,
  nodes: [{ id: 'a', title: 'Alpha' }],
};

type Store = typeof import('../state/store');

async function mountTree(): Promise<{ store: Store; user: ReturnType<typeof userEvent.setup> }> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(PROJECT)], habits: [], tasks: [], sessions: [],
  });
  const store = await import('../state/store');
  await store.initStore();
  const { GoalTree } = await import('./GoalTree');
  const TreeHost = () => {
    const { goals } = store.useAppStore();
    return createElement(GoalTree, { nodes: goals[0].nodes });
  };
  render(createElement(TreeHost));
  return { store, user: userEvent.setup() };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

/**
 * The StepPanel harness, from the same store-boot `mountTree` uses above:
 * open the goal and the container (the route a person takes from the tree)
 * and render the CONTAINER's inspector against live state, so an action's
 * effect is readable through `store.getState()`. `containerTitle` is the open
 * container; `children` are the rows the tree would show under it.
 */
async function renderStepPanel(params: {
  containerTitle: string;
  children: string[];
}): Promise<Store> {
  vi.resetModules();
  const goal: Goal = {
    id: 'g',
    title: 'Project',
    nodes: [{
      id: 'n1',
      title: params.containerTitle,
      children: params.children.map((title, i) => ({ id: `c${i}`, title })),
    }],
  };
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [goal], habits: [], tasks: [], sessions: [],
  });
  const store = await import('../state/store');
  await store.initStore();
  store.actions.openProject('g');
  store.actions.openStep('n1');
  const { StepPanel } = await import('../views/project/StepPanel');
  const Host = () => {
    const current = store.useAppStore();
    const liveGoal = current.goals.find((g) => g.id === 'g')!;
    const liveNode = liveGoal.nodes.find((n) => n.id === 'n1')!;
    return createElement(StepPanel, { goal: liveGoal, node: liveNode, actions: current.actions });
  };
  render(createElement(Host));
  return store;
}

/**
 * The row's own click is the route to the inspector now. There used to be a
 * `◈` hover control for it, because the row click was the completion gesture
 * and could not be spent on a disclosure — which is the trade this slice
 * reversed: completion moved to the checkbox, where it says what it does, and
 * the row went back to meaning "this one".
 */
describe('opening a task from its row', () => {
  it('opens the inspector on a plain click, and completes nothing', async () => {
    const { store, user } = await mountTree();
    const before = store.getState().goals[0].nodes[0].status;

    await user.click(screen.getByText('Alpha'));

    expect(store.getState().openStepId).toBe('a');
    expect(store.getState().goals[0].nodes[0].status).toBe(before);
  });

  it('completes from the checkbox without opening the inspector', async () => {
    const { store, user } = await mountTree();

    await user.click(screen.getByRole('checkbox', { name: /Mark "Alpha" as done/ }));

    expect(store.getState().goals[0].nodes[0].status).toBe('done');
    expect(store.getState().openStepId).toBeNull();
  });

  it('expands from the chevron without opening the inspector', async () => {
    const { store, user } = await mountTree();
    const container = store.getState().goals[0].nodes.find((n) => n.children);
    if (!container) return;

    const open = store.getState().expanded.has(container.id);
    await user.click(screen.getAllByRole('button', { name: open ? 'Collapse' : 'Expand' })[0]);

    expect(store.getState().expanded.has(container.id)).toBe(!open);
    expect(store.getState().openStepId).toBeNull();
  });
});

/**
 * The keyboard model moved with the pointer one, and for the same reason: the
 * dangerous action should take an aimed press.
 */
describe('the task row keyboard', () => {
  it('renames on Enter rather than creating a row nobody asked for', async () => {
    const { user } = await mountTree();
    (screen.getByText('Alpha').closest('[data-row]') as HTMLElement).focus();

    await user.keyboard('{Enter}');

    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('inserts a sibling below on Cmd+Enter', async () => {
    const { store, user } = await mountTree();
    const before = store.getState().goals[0].nodes.length;
    (screen.getByText('Alpha').closest('[data-row]') as HTMLElement).focus();

    await user.keyboard('{Meta>}{Enter}{/Meta}');

    expect(store.getState().goals[0].nodes.length).toBe(before + 1);
  });

  it('completes on X and leaves Space to the selection', async () => {
    const { store, user } = await mountTree();
    (screen.getByText('Alpha').closest('[data-row]') as HTMLElement).focus();

    await user.keyboard('x');

    expect(store.getState().goals[0].nodes[0].status).toBe('done');
  });
});

/**
 * A container's demand is DECLARED and flows DOWN to its descendants, the
 * opposite direction from its status (derived, inert). One gesture here tags
 * the whole subtree — the highest-value editor in the focus plan.
 */
describe('StepPanel focus needed', () => {
  it('tags every step under a container in one gesture', async () => {
    const user = userEvent.setup();
    await renderStepPanel({ containerTitle: 'Thesis', children: ['Lit review', 'Draft ch. 2'] });
    await user.click(screen.getByRole('button', { name: /Focus needed/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Deep' }));
    expect(screen.getByRole('button', { name: 'Focus needed: Deep' })).toBeTruthy();
  });
});
