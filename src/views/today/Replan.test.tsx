// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityWindow, Goal, GoalNode, Task } from '../../db/types';
import { makeBlock } from '../../lib/blocks';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: Task[]; sessions: never[] }> => ({
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
  loadPlanMode: vi.fn(async (): Promise<'week' | 'month'> => 'week'),
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

// A Wednesday, with Mon–Fri 09:00–11:00 available.
const TODAY = new Date(2026, 7, 12, 8, 0);
const HOURS: AvailabilityWindow[] = [0, 1, 2, 3, 4].map((dow) => ({ dow, startMin: 540, endMin: 660 }));

const leaf = (id: string, over: Partial<GoalNode> = {}): GoalNode => ({ id, title: id, ...over });

async function mount(goals: Goal[], tasks: Task[] = []) {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({ goals: structuredClone(goals), habits: [], tasks, sessions: [] });
  dbMocks.loadAvailability.mockResolvedValueOnce(HOURS);
  const store = await import('../../state/store');
  await store.initStore();
  const { Today } = await import('../Today');
  const Host = () => { store.useAppStore(); return createElement(Today); };
  render(createElement(Host));
  return store;
}

const slippedGoal: Goal = {
  id: 'g',
  title: 'Physics Final',
  nodes: [
    leaf('a', { title: 'Problems 1–15', plannedWeek: '2026-08-10', estimateMin: 60, blocks: [makeBlock('2026-08-10', 540, 60)] }),
    leaf('b', { title: 'Problems 16–30', plannedWeek: '2026-08-10', estimateMin: 60, blocks: [makeBlock('2026-08-11', 540, 60)] }),
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('recovering a day that slipped', () => {
  it('says what is unfinished, above everything else on the surface', async () => {
    await mount([slippedGoal]);
    expect(screen.getByText('2 tasks unfinished')).toBeTruthy();
    expect(screen.getByText('2h')).toBeTruthy();
  });

  it('says nothing at all when nothing slipped', async () => {
    await mount([{ id: 'g', title: 'Fine', nodes: [leaf('a')] }]);
    expect(screen.queryByText(/unfinished/)).toBeNull();
  });

  /** Nothing moves silently: the button opens a preview, not a write. */
  it('moves nothing until the preview is accepted', async () => {
    const store = await mount([slippedGoal]);

    fireEvent.click(screen.getByRole('button', { name: 'Replan' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(store.getState().goals[0].nodes[0].blocks?.[0].date).toBe('2026-08-10');
  });

  it('shows where each task came from and where it would go', async () => {
    await mount([slippedGoal]);
    fireEvent.click(screen.getByRole('button', { name: 'Replan' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Problems 1–15');
    expect(dialog.textContent).toContain('Aug 10');
    expect(dialog.textContent).toContain('Aug 12');
  });

  it('applies every move in one go, and one undo takes it all back', async () => {
    const store = await mount([slippedGoal]);
    fireEvent.click(screen.getByRole('button', { name: 'Replan' }));
    fireEvent.click(screen.getByRole('button', { name: /^Move 2 tasks$/ }));

    const after = store.getState().goals[0].nodes;
    expect(after[0].blocks?.[0].date).toBe('2026-08-12');
    expect(after[1].blocks?.[0].date).toBe('2026-08-12');
    expect(store.getState().pendingUndo?.label).toBe('Replanned 2 tasks');

    store.actions.undoLastDelete();
    expect(store.getState().goals[0].nodes[0].blocks?.[0].date).toBe('2026-08-10');
  });

  /**
   * Each proposal takes its slot out of the pool the next one sees, so the
   * preview and the write agree about where things land.
   */
  it('never proposes two tasks the same slot', async () => {
    const store = await mount([slippedGoal]);
    fireEvent.click(screen.getByRole('button', { name: 'Replan' }));
    fireEvent.click(screen.getByRole('button', { name: /^Move 2 tasks$/ }));

    const [a, b] = store.getState().goals[0].nodes;
    expect(a.blocks?.[0].startMin).not.toBe(b.blocks?.[0].startMin);
  });

  /**
   * An item quietly dropped from a recovery flow is the same work slipping
   * again, one layer deeper.
   */
  it('names the work that will not fit, and changes nothing about it', async () => {
    const store = await mount([{
      id: 'g',
      title: 'Big',
      nodes: [leaf('marathon', { title: 'Marathon', plannedWeek: '2026-08-10', estimateMin: 600, blocks: [makeBlock('2026-08-10', 540, 600)] })],
    }]);

    fireEvent.click(screen.getByRole('button', { name: 'Replan' }));

    expect(screen.getByText(/won’t fit in the next two weeks/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Move nothing$/ })).toHaveProperty('disabled', true);
    expect(store.getState().goals[0].nodes[0].blocks?.[0].date).toBe('2026-08-10');
  });

  it('leaves everything alone when the preview is dismissed', async () => {
    const store = await mount([slippedGoal]);
    fireEvent.click(screen.getByRole('button', { name: 'Replan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave it where it is' }));

    expect(store.getState().goals[0].nodes[0].blocks?.[0].date).toBe('2026-08-10');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
