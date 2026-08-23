// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal } from '../../db/types';

/**
 * "Unblock" used to be byte-identical to "Open project" — it opened the
 * project and left the blocked step to be found by hand. It should instead
 * deep-link to the first blocked leaf, reusing `openProject`'s existing
 * node-focus mechanism (the same one the command palette and "Plan next
 * step" already use).
 */

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: never[] }> =>
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
}));
vi.mock('../../db/db', () => dbMocks);
vi.mock('../../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const fullyBlocked: Goal = {
  id: 'g1', title: 'Blocked Project', column: 0,
  start: '2026-01-01', deadline: '2026-12-31',
  nodes: [
    { id: 'n1', title: 'First step', status: 'blocked', blockedOn: 'waiting on the grader' },
    { id: 'n2', title: 'Second step', status: 'blocked' },
  ],
  datesConfirmed: true,
};

async function mountBoard(goal: Goal) {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(goal)], habits: [], tasks: [], sessions: [],
  });
  const store = await import('../../state/store');
  await store.initStore();
  const { Goals } = await import('../Goals');
  render(createElement(Goals));
  return store;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

/**
 * The deep link into a blocked task used to be an `Unblock` button in the
 * card's action footer — one of three overlapping routes to the same place,
 * beside `Open goal` and the card body itself. The footer is gone; the link
 * lives on Today, where exceptions belong, and `attentionItems` carries the
 * node id so it lands on the reason rather than at the top of the tree.
 */
describe('a fully blocked goal', () => {
  it('offers no footer button duplicating the card body', async () => {
    await mountBoard(fullyBlocked);

    expect(screen.queryByRole('button', { name: 'Unblock' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open goal' })).toBeNull();
  });

  it('opens on its first blocked task from Today’s Attention row', async () => {
    const store = await mountBoard(fullyBlocked);
    const { attentionItems } = await import('../../lib/todaySurface');

    const [exception] = attentionItems(
      store.getState().goals,
      { commitments: [], carryOvers: [], completedToday: [] },
      '2026-06-01',
    );

    expect(exception).toMatchObject({ kind: 'blocked', goalId: 'g1', nodeId: 'n1' });
    store.actions.openProject(exception.goalId!, exception.nodeId);
    expect(store.getState().openStepId).toBe('n1');
  });

  it('shows the blocked task count and its reason on the card', async () => {
    await mountBoard(fullyBlocked);

    const card = screen.getByRole('group', { name: /^Blocked Project —/ });
    expect(within(card).getByText('2 tasks blocked')).toBeTruthy();
    expect(within(card).getByText(/waiting on the grader/)).toBeTruthy();
  });
});
