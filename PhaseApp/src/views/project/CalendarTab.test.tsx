// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, GoalNode, Session } from '../../db/types';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: Session[] }> => ({
    goals: [], habits: [], tasks: [], sessions: [],
  })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => []),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
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
  loadCycleConfig: vi.fn(async () => ({ workMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4 })),
  saveCycleConfig: vi.fn(async () => {}),
}));
vi.mock('../../db/db', () => dbMocks);
vi.mock('../../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
});

// A Wednesday, Mon–Fri 09:00–18:00.
const NOW = new Date(2026, 7, 12, 8, 0);

const leaf = (id: string, over: Partial<GoalNode> = {}): GoalNode => ({ id, title: id, ...over });

async function mount(goals: Goal[]) {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({ goals: structuredClone(goals), habits: [], tasks: [], sessions: [] });
  const store = await import('../../state/store');
  await store.initStore();
  const { CalendarTab } = await import('./CalendarTab');
  const Host = () => {
    const { goals: live } = store.useAppStore();
    return createElement(CalendarTab, { goal: live[0] });
  };
  render(createElement(Host));
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('the goal calendar', () => {
  it('draws this goal’s sittings on the week', async () => {
    const { makeBlock } = await import('../../lib/blocks');
    await mount([{
      id: 'g', title: 'Physics Final',
      nodes: [leaf('Problems 1–15', { plannedWeek: '2026-08-10', blocks: [makeBlock('2026-08-12', 600, 60)] })],
    }]);

    expect(screen.getAllByText('Problems 1–15').length).toBeGreaterThan(0);
  });

  /**
   * A plan that hides the rest of your week is not a plan, it is a wish. Other
   * goals' work is drawn — subdued — so a collision is visible before it is a
   * refusal.
   */
  it('shows other goals’ work too, for collision context', async () => {
    const { makeBlock } = await import('../../lib/blocks');
    await mount([
      { id: 'g', title: 'Physics Final', nodes: [leaf('Mine', { plannedWeek: '2026-08-10', blocks: [makeBlock('2026-08-12', 600, 60)] })] },
      { id: 'other', title: 'Launch', nodes: [leaf('Theirs', { plannedWeek: '2026-08-10', blocks: [makeBlock('2026-08-12', 780, 60)] })] },
    ]);

    expect(screen.getAllByText('Theirs').length).toBeGreaterThan(0);
  });

  /**
   * Free time is free time. A goal-scoped capacity figure would be a lie the
   * size of everything else the week already holds.
   */
  it('counts every goal’s work in the week’s capacity, not just this one’s', async () => {
    const { makeBlock } = await import('../../lib/blocks');
    await mount([
      { id: 'g', title: 'Physics Final', nodes: [leaf('Mine', { plannedWeek: '2026-08-10', blocks: [makeBlock('2026-08-12', 600, 60)] })] },
      { id: 'other', title: 'Launch', nodes: [leaf('Theirs', { plannedWeek: '2026-08-10', blocks: [makeBlock('2026-08-12', 780, 120)] })] },
    ]);

    // 60 + 120 minutes planned across the week — both goals, one figure.
    // The header states it as a labelled cell now (`Planned` over `3h`), so
    // the assertion reads the cell rather than a joined phrase.
    expect(document.querySelector('[data-fig="planned"]')?.textContent).toContain('3h');
  });

  it('lists this goal’s unplaced work, and only this goal’s', async () => {
    await mount([
      { id: 'g', title: 'Physics Final', nodes: [leaf('Needs a time')] },
      { id: 'other', title: 'Launch', nodes: [leaf('Not mine')] },
    ]);

    expect(screen.getByText('Needs a time')).toBeTruthy();
    expect(screen.queryByText('Not mine')).toBeNull();
  });

  it('places a task from the rail without leaving the tab', async () => {
    const store = await mount([{ id: 'g', title: 'Physics Final', nodes: [leaf('Needs a time')] }]);

    screen.getByRole('button', { name: 'Schedule "Needs a time" today' }).click();

    expect(store.getState().goals[0].nodes[0].blocks?.[0].date).toBe('2026-08-12');
  });

  it('says so when there is nothing left to place', async () => {
    const { makeBlock } = await import('../../lib/blocks');
    await mount([{
      id: 'g', title: 'Physics Final',
      nodes: [leaf('Placed', { plannedWeek: '2026-08-10', blocks: [makeBlock('2026-08-12', 600, 60)] })],
    }]);

    expect(screen.getByText('Everything in this goal has a time.')).toBeTruthy();
  });
});
