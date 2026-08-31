// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, Habit, Task } from '../db/types';

/**
 * A task captured with no project and no date used to reach Today only if the
 * free-time offer happened to have room for it. The Loose tasks section is the
 * page owning that work: capped, deduplicated against everything already on
 * screen, completable in place.
 */

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: Habit[]; tasks: Task[]; sessions: never[] }> =>
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
vi.mock('../db/db', () => dbMocks);
vi.mock('../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

/** Wednesday 10:00, so "today" still has room and the clock decides nothing. */
const TODAY = '2026-07-15';

const project: Goal = {
  id: 'g1', title: 'Thesis', column: 0,
  nodes: [{ id: 'n1', title: 'Draft the intro', estimateMin: 60 }],
};

async function mountToday(over: {
  goals?: Goal[];
  tasks?: Task[];
  habits?: Habit[];
  onOpenSettings?: () => void;
} = {}) {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(over.goals ?? [project]),
    habits: structuredClone(over.habits ?? []),
    tasks: structuredClone(over.tasks ?? []),
    sessions: [],
  });
  const store = await import('../state/store');
  await store.initStore();
  const { Today } = await import('./Today');
  render(createElement(Today, {}));
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 15, 10, 0, 0));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the Loose tasks section', () => {
  /**
   * The offer seats PROPOSAL_MAX (5) candidates; the sixth loose task used to
   * fall off the page entirely. It lands here instead — and a dated task is a
   * commitment, never a loose row.
   */
  it('lists what the offer could not seat, and no dated task', async () => {
    await mountToday({
      goals: [],
      tasks: [
        { id: 'now', title: 'Dated work', done: false, goalId: null, date: TODAY },
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `t${i}`, title: `Loose ${i}`, done: false, goalId: null as string | null,
        })),
        { id: 'bare', title: 'Captured bare', done: false, goalId: null },
      ],
    });

    const section = screen.getByLabelText('Loose tasks');
    expect(section.textContent).toContain('Captured bare');
    expect(section.textContent).not.toContain('Dated work');
  });

  it('never lists a task the offer is already showing', async () => {
    await mountToday({
      goals: [],
      tasks: [{ id: 'one', title: 'Only task', done: false, goalId: null }],
    });

    const count = [...document.querySelectorAll('span')]
      .filter((span) => span.textContent === 'Only task').length;
    expect(count).toBe(1);
  });

  it('completes a loose task from its checkbox', async () => {
    const store = await mountToday({
      goals: [],
      tasks: [
        // Six: the offer seats five, so the sixth lands in the loose section.
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `t${i}`, title: `Loose ${i}`, done: false, goalId: null as string | null,
        })),
        { id: 'tick', title: 'Tick me', done: false, goalId: null },
      ],
    });

    const section = screen.getByLabelText('Loose tasks');
    const box = [...section.querySelectorAll('button')]
      .find((b) => b.getAttribute('aria-label')?.includes('Tick me'));
    expect(box).toBeTruthy();
    await act(async () => { box!.click(); });
    const state = store.getState();
    expect(state.tasks.find((t) => t.id === 'tick')?.done).toBe(true);
  });

  it('says nothing when every loose task carries a date', async () => {
    await mountToday({
      goals: [],
      tasks: [{ id: 'later', title: 'Filed ahead', done: false, goalId: null, date: '2026-07-20' }],
    });
    expect(screen.queryByLabelText('Loose tasks')).toBeNull();
  });
});
