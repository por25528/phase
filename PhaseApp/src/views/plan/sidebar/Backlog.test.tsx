// @vitest-environment jsdom
import { createElement } from 'react';
import { DndContext } from '@dnd-kit/core';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, Task } from '../../../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: Task[]; sessions: never[] }> => ({ goals: [], habits: [], tasks: [], sessions: [] })),
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
vi.mock('../../../db/db', () => dbMocks);
vi.mock('../../../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const WEEK = '2026-08-10';
const TODAY = '2026-08-12';

const PROJECT: Goal = {
  id: 'g1',
  title: 'Studying Roblox',
  column: 0, // Now — inside PLANNING_HORIZONS, or the rail is empty
  nodes: [
    { id: 'n1', title: 'Break each topic into daily study goals', estimateMin: 45 },
    { id: 'n2', title: 'Estimate time for each study goal', estimateMin: 60 },
  ],
};

const LOOSE: Task = { id: 't1', title: 'Buy a new keyboard', done: false, goalId: null };

type Store = typeof import('../../../state/store');

async function mountRail(
  seed: { goals: Goal[]; tasks: Task[] },
  reveal: { kind: 'step' | 'task'; id: string; nonce: number } | null = null,
): Promise<{ store: Store; user: ReturnType<typeof userEvent.setup> }> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(seed.goals), habits: [], tasks: structuredClone(seed.tasks), sessions: [],
  });
  const store = await import('../../../state/store');
  await store.initStore();
  const { Backlog } = await import('./Backlog');
  render(
    createElement(
      DndContext,
      null,
      createElement(Backlog, {
        weekStart: WEEK, today: TODAY, onFocusItem: () => {}, reveal,
      }),
    ),
  );
  return { store, user: userEvent.setup() };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('the backlog rail', () => {
  it('opens the project from the group header', async () => {
    const { store, user } = await mountRail({ goals: [PROJECT], tasks: [] });
    await user.click(
      screen.getByRole('button', { name: 'Open project “Studying Roblox”' }),
    );
    expect(store.getState().openGoalId).toBe('g1');
  });

  it('leaves the loose-task group inert — it has no project to open', async () => {
    await mountRail({ goals: [], tasks: [LOOSE] });
    expect(screen.getByText('Loose tasks')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open project/ })).toBeNull();
  });

  it('states the rail total as a bare count, never a time', async () => {
    await mountRail({ goals: [PROJECT], tasks: [] });
    // 2 items — no time total: the rail spans every week, the header's "to
    // place" meter covers only this week's committed-unplaced work, and the
    // two can never be reconciled into one figure.
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  // NOTE: an earlier draft asserted `querySelectorAll('svg circle')` was empty
  // to prove the grip glyph is gone. DROPPED in pre-flight review, and do not
  // reinstate it: it passes only because no OTHER circle-bearing icon
  // (IconClock, IconDots, IconCircle, IconSearch) happens to sit in the rail
  // today, so adding one next month breaks a test whose failure message talks
  // about circles. Removing a decorative glyph is a visual fact and Task 12's
  // visual pass covers it.

  it('still deletes a loose task from the row', async () => {
    const { store, user } = await mountRail({ goals: [], tasks: [LOOSE] });
    await user.click(screen.getByRole('button', { name: 'Delete "Buy a new keyboard"' }));
    expect(store.getState().tasks.find((t) => t.id === 't1')).toBeUndefined();
  });

  it('offers no delete on a goal leaf — it is deleted where its tree is visible', async () => {
    await mountRail({ goals: [PROJECT], tasks: [] });
    expect(screen.queryByRole('button', { name: /^Delete "/ })).toBeNull();
  });

  it('parks a step from its row, and offers no park on a loose task', async () => {
    const { store, user } = await mountRail({ goals: [PROJECT], tasks: [LOOSE] });
    await user.click(screen.getByRole('button', { name: 'Park "Estimate time for each study goal"' }));
    const node = store.getState().goals[0].nodes.find((n) => n.id === 'n2');
    expect(node?.status).toBe('parked');
    expect(screen.queryByRole('button', { name: 'Park "Estimate time for each study goal"' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Park "Buy a new keyboard"' })).toBeNull();
  });

  /*
   * A parked step still carrying a `plannedWeek` stays in the rail — the
   * committed-work exception — so the row that parked it is the only place it
   * can be unparked from. The button is a TOGGLE, not a one-way trip.
   */
  it('offers Unpark on a parked-but-committed step, and clears the status', async () => {
    const parked: Goal = {
      ...PROJECT,
      nodes: [{ id: 'n1', title: 'Break each topic into daily study goals', status: 'parked', plannedWeek: WEEK }],
    };
    const { store, user } = await mountRail({ goals: [parked], tasks: [] });
    await user.click(
      screen.getByRole('button', { name: 'Unpark "Break each topic into daily study goals"' }),
    );
    expect(store.getState().goals[0].nodes[0].status).toBeUndefined();
  });

  it('a topic row draws its confidence and offers no Complete', async () => {
    const subject: Goal = {
      id: 'g2', title: 'Algorithms', type: 'study', column: 0,
      nodes: [{ id: 'area', title: 'Topics', topics: true, children: [
        { id: 'weak', title: 'Graphs', confidence: 'shaky', confidenceAt: '2026-08-10' },
      ] }],
    };
    await mountRail({ goals: [PROJECT, subject], tasks: [] });
    expect(screen.getByRole('img', { name: 'Shaky' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Complete "Graphs"' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Park "Graphs"' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Complete "Break each topic into daily study goals"' })).toBeTruthy();
  });

  it('marks exactly one head row per group', async () => {
    await mountRail({ goals: [PROJECT], tasks: [LOOSE] });
    const heads = document.querySelectorAll('[data-backlog-head]');
    expect(heads.length).toBe(2);
    expect(heads[0].textContent).toContain('Break each topic into daily study goals');
  });

  it('a revealed head row keeps the reveal tint', async () => {
    await mountRail({ goals: [PROJECT], tasks: [] }, { kind: 'step', id: 'n1', nonce: 1 });
    const head = document.querySelector('[data-backlog-head]');
    expect(head?.className).toContain('bg-accent-tint');
    expect(head?.className).not.toContain('bg-panel');
  });
});
