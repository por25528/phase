// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityWindow, Goal, GoalNode } from '../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: never[] }> => ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async (): Promise<AvailabilityWindow[]> => [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, startMin: 540, endMin: 1080 }))),
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
vi.mock('../db/db', () => dbMocks);
vi.mock('../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

async function renderTree(nodes: GoalNode[]): Promise<void> {
  vi.resetModules();
  const goal: Goal = { id: 'g', title: 'Systems', column: 0, nodes: structuredClone(nodes) };
  dbMocks.loadState.mockResolvedValueOnce({ goals: [goal], habits: [], tasks: [], sessions: [] });
  const store = await import('../state/store');
  await store.initStore();
  store.actions.openProject('g');
  const { GoalTree } = await import('./GoalTree');
  const TreeHost = () => {
    const { goals } = store.useAppStore();
    return createElement(GoalTree, { nodes: goals[0].nodes });
  };
  render(createElement(TreeHost));
}

const row = (title: string) => screen.getByText(title).closest('[data-row]') as HTMLElement;

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('a leaf with metadata', () => {
  it('renders its schedule on the second line, not in a right-edge cell', async () => {
    await renderTree([{ id: 'a', title: 'Ship it', plannedWeek: '2026-08-10' }]);
    const meta = within(row('Ship it')).getByTestId('row-meta-below');
    expect(within(meta).getByRole('button', { name: /Schedule|Scheduled/ })).toBeTruthy();
  });

  it('puts the estimate on that same second line', async () => {
    await renderTree([{ id: 'a', title: 'Ship it', estimateMin: 45 }]);
    const meta = within(row('Ship it')).getByTestId('row-meta-below');
    expect(within(meta).getByText(/45m/)).toBeTruthy();
  });
});

describe('a leaf with nothing to say', () => {
  // The reflow guarantee. jsdom has no layout, so we assert the STRUCTURE that
  // produces it: there is no second-line element, so nothing can appear below
  // the title and push the list down.
  it('renders NO second line at all', async () => {
    await renderTree([{ id: 'a', title: 'Bare task' }]);
    expect(within(row('Bare task')).queryByTestId('row-meta-below')).toBeNull();
  });

  it('carries its schedule control inline, on the line that already exists', async () => {
    await renderTree([{ id: 'a', title: 'Bare task' }]);
    const inline = within(row('Bare task')).getByTestId('row-meta-inline');
    expect(within(inline).getByRole('button', { name: /Schedule/ })).toBeTruthy();
  });

  // The whole point of one component in two positions: hovering a bare row must
  // reveal the SAME controls a populated row shows, not a reduced set.
  //
  // Asserted as "both kinds of control are present in both placements", NOT as
  // string equality of their labels. The labels SHOULD differ — an unset
  // control says `Schedule "X"` / `Set estimate for "X"` while a set one says
  // `Scheduled This week. Change it` / `Estimate for "X": 45m. Change it`,
  // because each names its own state. A test demanding they match would be
  // asserting a bug.
  it('offers the same two controls in both placements', async () => {
    await renderTree([{ id: 'a', title: 'Bare task' }, { id: 'b', title: 'Full task', estimateMin: 45 }]);
    const bare = within(row('Bare task')).getByTestId('row-meta-inline');
    const full = within(row('Full task')).getByTestId('row-meta-below');

    expect(within(bare).getByRole('button', { name: /^Schedule "/ })).toBeTruthy();
    expect(within(bare).getByRole('button', { name: /^Set estimate for "/ })).toBeTruthy();

    expect(within(full).getByRole('button', { name: /^Schedule "/ })).toBeTruthy();
    expect(within(full).getByRole('button', { name: /^Estimate for ".*": 45m/ })).toBeTruthy();

    // Neither placement holds a control the other lacks.
    expect(within(bare).getAllByRole('button')).toHaveLength(within(full).getAllByRole('button').length);
  });
});

describe('a container', () => {
  it('keeps its percentage on line 1 and has no second line', async () => {
    await renderTree([{ id: 'p', title: 'Parent', children: [{ id: 'c', title: 'Child' }] }]);
    const parent = row('Parent');
    expect(within(parent).getByText('0%')).toBeTruthy();
    expect(within(parent).queryByTestId('row-meta-below')).toBeNull();
  });
});
