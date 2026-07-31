// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, GoalNode, Session } from '../db/types';

/**
 * What the drawer's progress strip says, driven through the real DOM.
 *
 * Three things converge on this one line and each of them used to be silent or
 * misleading:
 *   - a project with no deadline rendered the literal "No project schedule",
 *   - the percentage never disclosed whether it was weighted by estimate,
 *   - logged time had no producer, so no calibration could ever be shown.
 */

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: Session[] }> => ({ goals: [], habits: [], tasks: [], sessions: [] })),
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
  persist: vi.fn(async () => {}),
  exportState: vi.fn(),
  importStateFromFile: vi.fn(),
  isSlotMigrationDone: vi.fn(async () => true),
  saveSlotMigrationSnapshot: vi.fn(async () => {}),
  loadSlotMigrationSnapshot: vi.fn(async () => null),
  markSlotMigrationDone: vi.fn(async () => {}),
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

type Store = typeof import('../state/store');

async function mountDrawer(goal: Goal, sessions: Session[] = []): Promise<Store> {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: [structuredClone(goal)], habits: [], tasks: [], sessions,
  });
  const store = await import('../state/store');
  await store.initStore();
  const { GoalDrawer } = await import('./GoalDrawer');
  const Host = () => {
    const { goals, actions } = store.useAppStore();
    return createElement(GoalDrawer, { goal: goals[0], actions });
  };
  render(createElement(Host));
  return store;
}

/** Days before today, as a local 'YYYY-MM-DD' — the shape `doneAt` carries. */
async function daysAgo(n: number): Promise<string> {
  const { todayStr, addDays } = await import('../lib/dates');
  return addDays(todayStr(), -n);
}

const openLeaf = (id: string, estimateMin?: number): GoalNode => ({
  id, title: id, done: false, ...(estimateMin ? { estimateMin } : {}),
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('a project with no schedule', () => {
  it('reports velocity instead of "No project schedule"', async () => {
    const recent = await daysAgo(3);
    await mountDrawer({
      id: 'g', title: 'Open-ended', nodes: [
        { id: 'a', title: 'a', done: true, doneAt: recent },
        { id: 'b', title: 'b', done: true, doneAt: recent },
        { id: 'c', title: 'c', done: true, doneAt: recent },
        openLeaf('d'), openLeaf('e'), openLeaf('f'),
      ],
    });

    expect(screen.queryByText(/No project schedule/)).toBeNull();
    expect(screen.getByText(/3 done in 14 days · 3 left/)).toBeTruthy();
  });

  it('names a stall, which a deadline-based pace line cannot see', async () => {
    const old = await daysAgo(60);
    await mountDrawer({
      id: 'g', title: 'Stalled', nodes: [
        { id: 'a', title: 'a', done: true, doneAt: old },
        openLeaf('b'), openLeaf('c'),
      ],
    });
    expect(screen.getByText(/nothing finished in 14 days · 2 steps open/)).toBeTruthy();
  });

  it('adds remaining effort when every open step is estimated', async () => {
    const recent = await daysAgo(2);
    await mountDrawer({
      id: 'g', title: 'Estimated', nodes: [
        { id: 'a', title: 'a', done: true, doneAt: recent, estimateMin: 60 },
        { id: 'b', title: 'b', done: true, doneAt: recent, estimateMin: 60 },
        { id: 'c', title: 'c', done: true, doneAt: recent, estimateMin: 60 },
        openLeaf('d', 120), openLeaf('e', 90),
      ],
    });
    expect(screen.getByText(/~3\.5h of work/)).toBeTruthy();
  });

  it('falls back to a useful message when the project has no steps at all', async () => {
    await mountDrawer({ id: 'g', title: 'Empty', nodes: [] });
    expect(screen.queryByText(/No project schedule/)).toBeNull();
    expect(screen.getByText(/no steps yet/)).toBeTruthy();
  });
});

describe('disclosing how the percentage was computed', () => {
  it('says the roll-up is weighted when every step is estimated', async () => {
    await mountDrawer({
      id: 'g', title: 'W', nodes: [
        { id: 'a', title: 'a', done: true, estimateMin: 20 },
        openLeaf('b', 360),
      ],
    });
    expect(screen.getByText(/1\/2 steps, weighted by estimate/)).toBeTruthy();
    // 20 of 380 minutes, not the 50% an equal-weight mean would report.
    expect(screen.getByText('5%')).toBeTruthy();
  });

  it('shows a bare step count when the roll-up fell back to equal weight', async () => {
    await mountDrawer({
      id: 'g', title: 'E', nodes: [
        { id: 'a', title: 'a', done: true, estimateMin: 20 },
        openLeaf('b'),
      ],
    });
    const counter = screen.getByText(/1\/2 steps/);
    expect(counter.textContent).not.toMatch(/weighted/);
    expect(screen.getByText('50%')).toBeTruthy();
  });
});

describe('estimate calibration', () => {
  const calibrated: Goal = {
    id: 'g', title: 'C',
    nodes: Array.from({ length: 5 }, (_, i) => ({
      id: `n${i}`, title: `n${i}`, done: true, estimateMin: 60,
    })),
  };
  const sessionsFor = (minutes: number): Session[] =>
    Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`, goalId: 'g', nodeId: `n${i}`, date: '2026-07-28', minutes, note: '',
    }));

  it('reports how estimates have compared to logged time', async () => {
    await mountDrawer(calibrated, sessionsFor(90));
    expect(screen.getByText(/estimates run about 1\.5× short/)).toBeTruthy();
  });

  it('stays silent without enough history', async () => {
    await mountDrawer(calibrated, sessionsFor(90).slice(0, 2));
    expect(screen.queryByText(/estimates run about/)).toBeNull();
  });

  it('never rewrites the estimate it comments on', async () => {
    const store = await mountDrawer(calibrated, sessionsFor(90));
    // Advisory only. The whole point is that the user's number stands and the
    // observation sits beside it.
    for (const node of store.getState().goals[0].nodes) {
      expect(node.estimateMin).toBe(60);
    }
  });
});
