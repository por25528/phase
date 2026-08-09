import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, Habit, Task } from '../db/types';

/**
 * Render every view once, against a dataset shaped like a real term.
 *
 * `App.test.ts` renders the shell, but hydration starts at 'loading' so it only
 * ever exercises the loading branch — the three views themselves were never
 * rendered by any test, only their pure helpers. That left every JSX change in
 * this directory verified by the type-checker alone, which cannot see a `.map`
 * on an undefined prop, a hook handed the wrong shape, or a component reaching
 * for `window` during render.
 *
 * Deliberately assertion-light: it proves the views mount and produce their
 * headline strings. Behaviour is covered by the `lib/` and store suites, which
 * can make far sharper claims than markup can.
 */

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: Habit[]; tasks: Task[]; sessions: never[] }> => ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async () => [0, 1, 2, 3, 4].map((dow) => ({ dow, startMin: 540, endMin: 1080 }))),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => ['habits', 'stats', 'availability']),
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
}));
vi.mock('../db/db', () => dbMocks);
vi.mock('../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

// vitest runs in `node`, and several components read matchMedia from a useState
// initialiser — which DOES run during SSR. `matches: true` puts the board in its
// wide, four-column layout, so the render covers more than the narrow fallback.
beforeAll(() => {
  const g = globalThis as unknown as { window?: unknown; matchMedia?: unknown };
  const matchMedia = (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });
  if (g.window === undefined) {
    g.window = { matchMedia, addEventListener() {}, removeEventListener() {} };
  }
  g.matchMedia = matchMedia;
});

const TODAY = new Date();
const iso = (offsetDays: number): string => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const GOALS: Goal[] = [
  {
    id: 'g-psets',
    title: '6.1200 Problem Sets',
    column: 0,
    start: iso(-30),
    deadline: iso(60),
    datesConfirmed: true,
    nodes: [
      { id: 'n-p7', title: 'Pset 7', status: 'done', doneAt: iso(-3) },
      {
        id: 'n-p8',
        title: 'Pset 8',
        children: [
          { id: 'n-p8a', title: 'Problems 1–3', deadline: iso(2), estimateMin: 120 },
          { id: 'n-p8b', title: 'Problems 4–6', estimateMin: 90 },
        ],
      },
      { id: 'n-exam', title: '18.06 exam prep', deadline: iso(9) },
      { id: 'm1', title: 'Midterm', checkpoint: true, start: iso(9), deadline: iso(9) },
    ],
    notes: 'Office hours Tue/Thu.',
  },
  {
    id: 'g-startup',
    title: 'Startup — seed round',
    column: 1,
    // Deliberately unconfirmed, so the date-review banner and card render.
    start: iso(-10),
    deadline: iso(45),
    nodes: [{ id: 'n-deck', title: 'Investor deck', estimateMin: 180 }],
  },
  {
    id: 'g-done',
    title: '6.031 (archived)',
    column: 0,
    completedAt: iso(-1),
    nodes: [{ id: 'n-old', title: 'Final project', status: 'done', doneAt: iso(-2) }],
  },
  // No nodes and no dates: the degenerate project every empty-state path keys off.
  { id: 'g-empty', title: 'Someday: learn Rust', column: 3, nodes: [] },
];

const TASKS: Task[] = [
  { id: 't-overdue', title: 'Email advisor', date: iso(-2), done: false, goalId: null },
  { id: 't-placed', title: 'Standup', date: iso(0), startMin: 600, done: false, goalId: 'g-startup', estimateMin: 30 },
  { id: 't-loose', title: 'Renew T pass', done: false, goalId: null },
];

const HABITS: Habit[] = [
  { id: 'h1', title: 'Read a paper', cadence: 'daily', weeklyTarget: 7, goalId: null, checkins: [iso(-1)], createdAt: iso(-20) },
  { id: 'h2', title: 'Gym', cadence: 'weekly', weeklyTarget: 3, goalId: 'g-psets', checkins: [], createdAt: iso(-20) },
];

/**
 * A fresh store module per test, hydrated from the mocked db. Sharing one
 * module across tests re-ran `addGoals` on an already-populated board and
 * rendered every project twice.
 */
async function readyStore() {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(GOALS),
    tasks: structuredClone(TASKS),
    habits: structuredClone(HABITS),
    sessions: [],
  });
  const store = await import('../state/store');
  await store.initStore();
  return store;
}

describe('the three views render against a populated store', () => {
  beforeEach(() => vi.clearAllMocks());

  it('Plan draws the week, the rail and the capacity readout', async () => {
    const store = await readyStore();
    expect(store.getState().hydration).toBe('ready');

    const { Plan } = await import('./Plan');
    const html = renderToStaticMarkup(createElement(Plan));

    expect(html).not.toContain('Loading…');
    expect(html).toContain('To plan');          // the backlog rail
    expect(html).toContain('Investor deck');    // an unplanned step, in the rail
    expect(html).toContain('free');             // the capacity readout
    expect(html).toContain('Read a paper');     // the habits panel
  });

  it('Plan draws a month when the stored preference says month', async () => {
    // Seeded through the db mock rather than by calling the action, so this
    // exercises hydration — the path that actually decides what the user sees
    // on launch.
    dbMocks.loadPlanMode.mockResolvedValueOnce('month' as const);
    const store = await readyStore();
    expect(store.getState().planMode).toBe('month');

    const { Plan } = await import('./Plan');
    const html = renderToStaticMarkup(createElement(Plan));

    // The month's weekday strip, and none of the week grid's hour axis.
    expect(html).toContain('Sun');
    expect(html).not.toContain('8am');
    // Week-only figures must not sit under a month heading.
    expect(html).not.toContain('free');
  });

  it('Projects draws every horizon and the cards in them', async () => {
    await readyStore();
    const { Goals } = await import('./Goals');
    const html = renderToStaticMarkup(createElement(Goals));

    expect(html).toContain('6.1200 Problem Sets');
    expect(html).toContain('Startup');
    expect(html).toContain('Someday: learn Rust');
    // The archived project belongs under Completed, not in a horizon column.
    expect(html).toContain('Completed');
  });

  it('Timeline draws its rows without needing a layout pass', async () => {
    await readyStore();
    const { Timeline } = await import('./Timeline');
    const html = renderToStaticMarkup(createElement(Timeline));

    expect(html).toContain('6.1200 Problem Sets');
  });

  // Timeline stopped being a destination and became a representation of the
  // same page, so the switch has to be part of Goals' own render — not a route
  // App picks between.
  it('Goals draws the timeline instead of the board when that is the stored mode', async () => {
    dbMocks.loadGoalsMode.mockResolvedValueOnce('timeline' as const);
    const store = await readyStore();
    expect(store.getState().goalsMode).toBe('timeline');

    const { Goals } = await import('./Goals');
    const html = renderToStaticMarkup(createElement(Goals));

    expect(html).toContain('6.1200 Problem Sets');
    expect(html).toContain('Timeline scope');   // the timeline's own control
    expect(html).not.toContain('Drop a goal here'); // …and none of the board
  });

  /**
   * Day one, with nothing in the app at all. Empty states are where `.map` on
   * an absent field, a `[0]` on an empty array, or a divide-by-zero surfaces —
   * and they are the first thing a new user sees, so a crash here is the whole
   * product.
   */
  describe('and against a completely empty one', () => {
    async function emptyStore() {
      vi.resetModules();
      dbMocks.loadState.mockResolvedValueOnce({ goals: [], habits: [], tasks: [], sessions: [] });
      const store = await import('../state/store');
      await store.initStore();
      return store;
    }

    it('Plan offers its first-run guidance rather than a blank grid', async () => {
      await emptyStore();
      const { Plan } = await import('./Plan');
      const html = renderToStaticMarkup(createElement(Plan));

      expect(html).toContain('Nothing left to plan');
      expect(html).toContain('No habits yet');
    });

    it('Projects and Timeline render with nothing in them', async () => {
      await emptyStore();
      const { Goals } = await import('./Goals');
      const { Timeline } = await import('./Timeline');

      expect(() => renderToStaticMarkup(createElement(Goals))).not.toThrow();
      expect(() => renderToStaticMarkup(createElement(Timeline))).not.toThrow();
    });
  });
});
