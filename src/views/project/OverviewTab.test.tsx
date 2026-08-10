// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityWindow, Goal, GoalNode, Session } from '../../db/types';
import { goalEffort, fmtMinutes } from '../../lib/effort';
import { todayStr } from '../../lib/dates';
import { goalHealth, HEALTH_WORD } from '../../lib/health';
import { weekOf } from '../../lib/plan';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: Session[] }> => ({
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

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

const leaf = (id: string, over: Partial<GoalNode> = {}): GoalNode => ({ id, title: id, ...over });

const WORKING_HOURS: AvailabilityWindow[] = [0, 1, 2, 3, 4]
  .map((dow) => ({ dow, startMin: 540, endMin: 1020 }));

function datedGoal(nodes: GoalNode[]): Goal {
  return {
    id: 'g1',
    title: 'Physics Final',
    start: '2026-08-01',
    deadline: '2026-08-24',
    datesConfirmed: true,
    nodes,
  };
}

type Store = typeof import('../../state/store');

/** Boot a store holding a goal and render OverviewTab against live state. */
async function mountOverview(goal: Goal, availability?: AvailabilityWindow[]): Promise<Store> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(goal)], habits: [], tasks: [], sessions: [],
  });
  if (availability !== undefined) dbMocks.loadAvailability.mockResolvedValueOnce(availability);
  const store = await import('../../state/store');
  await store.initStore();
  const { OverviewTab } = await import('./OverviewTab');
  const Host = () => {
    const current = store.useAppStore();
    const liveGoal = current.goals.find((g) => g.id === goal.id)!;
    return createElement(OverviewTab, { goal: liveGoal });
  };
  render(createElement(Host));
  return store;
}

function section(name: string): HTMLElement {
  return screen.getByRole('heading', { name }).parentElement!;
}

describe('OverviewTab forecast and week load', () => {
  it('offers Schedule for the lead Next item and opens the schedule menu', async () => {
    const goal = datedGoal([
      leaf('lead', { title: 'Lead task', estimateMin: 30 }),
      leaf('later', { title: 'Later task', estimateMin: 15 }),
    ]);
    await mountOverview(goal);

    const schedule = screen.getByRole('button', { name: 'Schedule' });
    expect(schedule).toBeTruthy();
    fireEvent.click(schedule);

    expect(screen.getByRole('menuitem', { name: 'Today' })).toBeTruthy();
  });

  it('keeps the Schedule control outside the lead task button', async () => {
    const goal = datedGoal([
      leaf('lead', { title: 'Lead task', estimateMin: 30 }),
      leaf('later', { title: 'Later task', estimateMin: 15 }),
    ]);
    await mountOverview(goal);

    const openButton = screen.getByRole('button', { name: /Lead task/ });
    const scheduleButton = screen.getByRole('button', { name: 'Schedule' });

    expect(openButton.contains(scheduleButton)).toBe(false);
  });

  it('schedules the lead Next item for today from the menu', async () => {
    vi.setSystemTime(new Date(2026, 7, 11, 8));
    try {
      const goal = datedGoal([leaf('lead', { title: 'Lead task', estimateMin: 30 })]);
      const store = await mountOverview(goal, WORKING_HOURS);

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('menuitem', { name: 'Today' }));
      });

      const node = store.getState().goals[0].nodes.find((item) => item.id === 'lead')!;
      expect(node.blocks?.[0]?.date).toBe(todayStr());
      expect(typeof node.blocks?.[0]?.startMin).toBe('number');
    } finally {
      vi.useRealTimers();
    }
  });

  it('states the health verdict with its reason sentence', async () => {
    vi.setSystemTime(new Date(2026, 7, 11, 12));
    try {
      const goal = datedGoal([leaf('a', { estimateMin: 60 })]);
      await mountOverview(goal, WORKING_HOURS);

      const expected = goalHealth({
        goal,
        effort: goalEffort(goal),
        today: todayStr(),
        windows: WORKING_HOURS,
        blocks: [],
        allDayBlocks: true,
      });
      const forecast = section('Forecast');
      expect(expected.health).toBe('on-track');
      expect(forecast.textContent).toContain(HEALTH_WORD[expected.health]);
      expect(forecast.textContent).toContain(expected.reason);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts committed tasks and formats their open estimate for this week', async () => {
    vi.setSystemTime(new Date(2026, 7, 11, 12));
    try {
      const week = weekOf(todayStr());
      const goal = datedGoal([
        leaf('a', { plannedWeek: week, estimateMin: 60 }),
        leaf('b', { plannedWeek: week, estimateMin: 30 }),
      ]);
      await mountOverview(goal);

      const thisWeek = section('This week');
      expect(thisWeek.textContent).toContain('2 tasks');
      expect(thisWeek.textContent).toContain(fmtMinutes(90));
    } finally {
      vi.useRealTimers();
    }
  });

  it('says when nothing is committed to this week instead of printing zeroes', async () => {
    vi.setSystemTime(new Date(2026, 7, 11, 12));
    try {
      await mountOverview(datedGoal([leaf('a', { estimateMin: 30 })]));

      const thisWeek = section('This week');
      expect(thisWeek.textContent).toContain('Nothing committed to this week yet.');
      expect(thisWeek.textContent).not.toContain('0 tasks');
      expect(thisWeek.textContent).not.toContain('0m');
      expect(section('Forecast').textContent).toContain('No forecast');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not claim a predicted finish date at the current pace', async () => {
    vi.setSystemTime(new Date(2026, 7, 11, 12));
    try {
      const goal = datedGoal([leaf('a', { estimateMin: 60 })]);
      await mountOverview(goal, WORKING_HOURS);

      expect(section('Forecast').textContent).not.toMatch(/at current pace/i);
    } finally {
      vi.useRealTimers();
    }
  });
});
