// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  loadAvailability: vi.fn(async () => []),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => []),
  loadPlanMode: vi.fn(async () => 'week' as const),
  savePlanMode: vi.fn(async () => {}),
  loadGoalsMode: vi.fn(async (): Promise<'board' | 'timeline'> => 'board'),
  saveGoalsMode: vi.fn(async () => {}),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAvailability: vi.fn(async () => {}),
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

describe('Unblock deep-links to the blocked step', () => {
  it('opens the project focused on the first blocked leaf, in document order', async () => {
    const store = await mountBoard(fullyBlocked);

    fireEvent.click(screen.getByRole('button', { name: 'Unblock' }));

    const s = store.getState();
    expect(s.view).toBe('project');
    expect(s.openGoalId).toBe('g1');
    expect(s.focusNodeId).toBe('n1');
    expect(s.openStepId).toBe('n1');
  });

  it('shows the blocked step count and its reason on the card', async () => {
    await mountBoard(fullyBlocked);

    const card = screen.getByRole('group', { name: /^Blocked Project —/ });
    expect(within(card).getByText('2 tasks blocked')).toBeTruthy();
    expect(within(card).getByText(/waiting on the grader/)).toBeTruthy();
  });
});
