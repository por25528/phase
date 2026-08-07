// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, Task } from '../../db/types';

/**
 * The header's "N unestimated" used to be inert text: the app naming a hole in
 * its own arithmetic and refusing to say where. This covers the wiring that
 * makes it actionable — that the list names the right work, that pricing an
 * item writes through the ordinary undoable action, and that an item already on
 * the grid is distinguishable from one still in the rail.
 */

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: Task[]; sessions: never[] }> => ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async () => []),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => []),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAvailability: vi.fn(async () => {}),
  saveAllDayBlocks: vi.fn(async () => {}),
  saveSidebarPanels: vi.fn(async () => {}),
  loadPlanMode: vi.fn(async () => 'week' as const),
  savePlanMode: vi.fn(async () => {}),
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

const PROJECT: Goal = {
  id: 'g1',
  title: '6.5840',
  column: 0,
  nodes: [
    { id: 'n1', title: 'Implement AppendEntries', done: false, plannedWeek: '2026-07-27' },
    {
      id: 'n2', title: 'Debug figure-8', done: false,
      plannedWeek: '2026-07-27', plannedDay: '2026-07-28', plannedStartMin: 540,
    },
  ],
};

type Store = typeof import('../../state/store');

async function mountPanel(): Promise<{ store: Store; user: ReturnType<typeof userEvent.setup> }> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(PROJECT)], habits: [], tasks: [], sessions: [],
  });
  const store = await import('../../state/store');
  await store.initStore();
  const { UnestimatedPanel } = await import('./UnestimatedPanel');
  const { unestimatedCommitments } = await import('../../lib/unestimated');
  const { plannedLeaves } = await import('../../lib/plan');

  // Subscribed, so rows retire as they are priced — the panel is derived from
  // the store exactly as Plan derives it.
  const Host = () => {
    const { goals } = store.useAppStore();
    const items = unestimatedCommitments(plannedLeaves(goals, '2026-07-27'), []);
    return createElement(UnestimatedPanel, { items, onClose: () => {} });
  };
  render(createElement(Host));
  return { store, user: userEvent.setup() };
}

const estimateOf = (store: Store, id: string): number | undefined =>
  store.getState().goals[0].nodes.find((n) => n.id === id)?.estimateMin;

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('pricing the week’s unestimated work', () => {
  it('lists every unestimated commitment', async () => {
    await mountPanel();
    expect(screen.getByText('Implement AppendEntries')).toBeTruthy();
    expect(screen.getByText('Debug figure-8')).toBeTruthy();
  });

  it('marks the ones already on the grid', async () => {
    await mountPanel();
    // An unestimated block is drawn at the default slot length, so it looks
    // scheduled while contributing nothing to plannedMin. Only one of these
    // two is on the grid.
    expect(screen.getAllByText('on grid')).toHaveLength(1);
  });

  it('prices an item from a preset, in place', async () => {
    const { store, user } = await mountPanel();
    await user.click(
      screen.getByRole('button', { name: 'Set estimate for "Implement AppendEntries"' }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Set estimate for "Implement AppendEntries" to 1h',
      }),
    );
    expect(estimateOf(store, 'n1')).toBe(60);
  });

  it('drops a row once it has been priced', async () => {
    const { user } = await mountPanel();
    await user.click(
      screen.getByRole('button', { name: 'Set estimate for "Debug figure-8"' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Set estimate for "Debug figure-8" to 30m' }),
    );
    // The list IS the count — a row that stays after being priced would leave
    // the panel and the header disagreeing.
    expect(screen.queryByText('Debug figure-8')).toBeNull();
    expect(screen.getByText('Implement AppendEntries')).toBeTruthy();
  });

  it('leaves the estimate undoable', async () => {
    const { store, user } = await mountPanel();
    await user.click(
      screen.getByRole('button', { name: 'Set estimate for "Implement AppendEntries"' }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Set estimate for "Implement AppendEntries" to 45m',
      }),
    );
    expect(store.getState().pendingUndo).not.toBeNull();

    store.actions.undoLastDelete();
    expect(estimateOf(store, 'n1')).toBeUndefined();
  });

  it('reveals an item in the week when its title is clicked', async () => {
    const { store, user } = await mountPanel();
    await user.click(screen.getByRole('button', { name: /Show "Debug figure-8"/ }));
    expect(store.getState().revealItem).toMatchObject({ kind: 'step', id: 'n2' });
    expect(store.getState().view).toBe('plan');
  });
});
