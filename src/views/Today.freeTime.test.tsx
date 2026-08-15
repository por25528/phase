// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityWindow, Goal, Habit, Task } from '../db/types';
import { blocksOf } from '../lib/blocks';
import { sectionLabel } from '../components/sectionLabel';

/**
 * Today's zones were each conditional on something carrying today's date, so a
 * user with three live projects and an uncommitted week got one grey sentence
 * and a blank page. The free-time offer is the page answering on the day it
 * used to go quiet — and answering means writing a block, not linking to Plan.
 */

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: Habit[]; tasks: Task[]; sessions: never[] }> =>
    ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async (): Promise<AvailabilityWindow[]> => []),
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
const WORKDAY: AvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
  dow, startMin: 9 * 60, endMin: 17 * 60,
}));

const project: Goal = {
  id: 'g1', title: 'Thesis', column: 0,
  nodes: [{ id: 'n1', title: 'Draft the intro', estimateMin: 60 }],
};

async function mountToday(over: {
  goals?: Goal[];
  tasks?: Task[];
  habits?: Habit[];
  availability?: AvailabilityWindow[];
  onOpenSettings?: () => void;
} = {}) {
  vi.resetModules();
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(over.goals ?? [project]),
    habits: structuredClone(over.habits ?? []),
    tasks: structuredClone(over.tasks ?? []),
    sessions: [],
  });
  dbMocks.loadAvailability.mockResolvedValueOnce(over.availability ?? WORKDAY);
  const store = await import('../state/store');
  await store.initStore();
  const { Today } = await import('./Today');
  render(createElement(Today, { onOpenSettings: over.onOpenSettings ?? (() => {}) }));
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

describe('the free-time offer', () => {
  it('shows committed work once even when it is also eligible for the offer', async () => {
    await mountToday({
      goals: [{
        id: 'g1', title: 'Thesis', column: 0,
        nodes: [
          { id: 'n1', title: 'Draft the intro', plannedWeek: '2026-07-13' },
          { id: 'n2', title: 'Revise the intro', plannedWeek: '2026-07-13' },
        ],
      }],
    });

    const countTitle = (title: string) => [...document.querySelectorAll('span')]
      .filter((span) => span.textContent === title).length;
    expect(countTitle('Draft the intro')).toBe(1);
    expect(countTitle('Revise the intro')).toBe(1);
  });

  it('offers a project’s next action when the day is uncommitted', async () => {
    await mountToday();

    expect(screen.getByText('7h free today')).toBeTruthy(); // 10:00 → 17:00
    expect(screen.getByRole('button', { name: 'Plan “Draft the intro” today' })).toBeTruthy();
    // The Now zone stays silent: two messages both saying "nothing" is the
    // apologetic page this replaces.
    expect(screen.queryByText(/Nothing committed to today/)).toBeNull();
  });

  it('books the step at the next free minute, and the row leaves', async () => {
    const store = await mountToday();

    await act(async () => {
      screen.getByRole('button', { name: 'Plan “Draft the intro” today' }).click();
    });

    const [block] = blocksOf(store.getState().goals[0].nodes[0]);
    expect(block).toMatchObject({ date: TODAY, startMin: 10 * 60, minutes: 60 });
    // Placed work is not backlog, so the offer drops it — and the item is now
    // upstairs in Now.
    expect(screen.queryByRole('button', { name: 'Plan “Draft the intro” today' })).toBeNull();
    expect(screen.getByText('Draft the intro')).toBeTruthy();
  });

  /**
   * The row IS the button, so there is no way to touch this zone without
   * booking something. A press you did not mean used to cost a trip to Plan.
   */
  it('a booking made by accident can be taken back', async () => {
    const store = await mountToday();

    await act(async () => {
      screen.getByRole('button', { name: 'Plan “Draft the intro” today' }).click();
    });
    expect(store.getState().pendingUndo?.label).toBe('Scheduled "Draft the intro"');

    await act(async () => {
      store.actions.undoLastDelete();
    });

    // Unplaced again, so `backlogGroups` re-includes it and the offer returns.
    expect(blocksOf(store.getState().goals[0].nodes[0])).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Plan “Draft the intro” today' })).toBeTruthy();
  });

  it('books a loose task too', async () => {
    const store = await mountToday({
      goals: [],
      tasks: [{ id: 't1', title: 'Renew T pass', done: false, goalId: null, estimateMin: 30 }],
    });

    await act(async () => {
      screen.getByRole('button', { name: 'Plan “Renew T pass” today' }).click();
    });

    expect(blocksOf(store.getState().tasks[0])).toHaveLength(1);
  });

  /**
   * The Sunday-evening case. The window has closed, so the offer names the day
   * it will actually book rather than pretending there is time left.
   */
  it('rolls to the next open day once today’s window has closed', async () => {
    vi.setSystemTime(new Date(2026, 6, 15, 19, 0, 0));
    const store = await mountToday();

    expect(screen.getByText('No time left today — tomorrow has 8h free')).toBeTruthy();
    await act(async () => {
      screen.getByRole('button', { name: 'Plan “Draft the intro” tomorrow' }).click();
    });

    expect(blocksOf(store.getState().goals[0].nodes[0])[0]).toMatchObject({
      date: '2026-07-16', startMin: 9 * 60,
    });
  });

  it('says nobody set working hours rather than claiming there is no time', async () => {
    const onOpenSettings = vi.fn();
    await mountToday({ availability: [], onOpenSettings });

    expect(screen.getByText(/No working hours set/)).toBeTruthy();
    screen.getByRole('button', { name: 'Set your working hours' }).click();
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('offers nothing when there is nothing left to place', async () => {
    await mountToday({ goals: [] });

    expect(screen.queryByLabelText('Free time')).toBeNull();
    expect(screen.getByText(/Nothing committed to today/)).toBeTruthy();
  });
});

describe('the shared primary', () => {
  it("shows the advisor's primary as the top item with honest time copy", async () => {
    const store = await mountToday();

    const { executionAdvice } = await import('../lib/executionAdvisor');
    const { weekOf } = await import('../lib/plan');
    const s = store.getState();
    const advice = executionAdvice({
      goals: s.goals, tasks: s.tasks, sessions: s.sessions,
      availability: s.availability, blocks: [], allDayBlocks: s.allDayBlocks,
      today: TODAY, week: weekOf(TODAY), now: { date: TODAY, minute: 10 * 60 },
    });
    expect(advice.kind).toBe('work');
    if (advice.kind !== 'work') return;
    expect(advice.primary.key).toBe('step:n1');

    // The top row is that exact item, wearing the plan action and the honest
    // planned-estimate language — never "likely".
    expect(screen.getByRole('button', { name: 'Plan “Draft the intro” today' })).toBeTruthy();
    expect(screen.getByText('Planned 60m')).toBeTruthy();
  });

  it('keeps the primary out of the lower free-time list', async () => {
    await mountToday({
      goals: [
        project,
        { id: 'g2', title: 'Startup', column: 0, nodes: [{ id: 'n2', title: 'Pitch deck', estimateMin: 30 }] },
      ],
    });

    const countTitle = (title: string) => [...document.querySelectorAll('span')]
      .filter((span) => span.textContent === title).length;
    expect(countTitle('Draft the intro')).toBe(1);
    expect(countTitle('Pitch deck')).toBe(1);
  });

  it('Start session starts a focus draft for that exact ref', async () => {
    const store = await mountToday();

    await act(async () => {
      screen.getByRole('button', { name: 'Start session on “Draft the intro”' }).click();
    });

    expect(store.getState().activeFocusSession?.ref).toEqual({
      kind: 'step', id: 'n1', goalId: 'g1',
    });
    // Time is logged later, at completion. Starting a session completes nothing.
    expect(store.getState().sessions).toHaveLength(0);
    expect(store.getState().goals[0].nodes[0].status).toBeUndefined();
  });

  it('a habit never becomes the primary', async () => {
    await mountToday({
      goals: [],
      habits: [{ id: 'h1', title: 'Stretch', cadence: 'daily', weeklyTarget: 7, goalId: null, checkins: [] }],
    });

    expect(screen.getByText(/Nothing committed to today/)).toBeTruthy();
    expect(screen.queryByText('Stretch')).toBeNull();
  });

  /**
   * The one action the surface exists to offer used to render as `text-meta
   * text-muted` — eleven-pixel grey text, quieter than the row it sat on.
   */
  it('renders Start session as a button rather than as metadata', async () => {
    await mountToday();

    const btn = screen.getByRole('button', { name: 'Start session on “Draft the intro”' });
    expect(btn.className).toContain('border');
    expect(btn.className).not.toContain('text-muted');
  });

  /** Three labels, three left edges, two colours. One of each now. */
  it('sits every section label on its rows’ axis, in the one label style', async () => {
    await mountToday({
      goals: [{
        id: 'g1', title: 'Thesis', column: 0,
        nodes: [
          { id: 'n1', title: 'Draft the intro', plannedWeek: '2026-07-13' },
          { id: 'n2', title: 'Revise the intro', plannedWeek: '2026-07-13' },
        ],
      }],
    });

    const label = screen.getByText('Rest of today');
    expect(label.className).toContain('px-[8px]');
    expect(label.className).toContain(sectionLabel);
  });
});

/**
 * The rule `GoalTree` already produced, arriving late on the one surface that
 * never got it: a plain row click OPENS, and the mutation lives on a control
 * you can see.
 *
 * Two sections of this page already agree — Rest of today and Carried over both
 * open on click, and Carried over puts its booking on a separate verb. The
 * offer rows were the last place where the largest click target on the page ran
 * the one action that writes a block, which is why that path had to arm an undo
 * for a press the user never knew they had made.
 */
describe('an offer row opens; a verb books', () => {
  const twoProjects: Goal[] = [
    { id: 'g1', title: 'Thesis', column: 0, nodes: [{ id: 'n1', title: 'Draft the intro', estimateMin: 60 }] },
    { id: 'g2', title: 'Grant', column: 0, nodes: [{ id: 'n2', title: 'Chase the referee', estimateMin: 30 }] },
  ];

  /** Every block on every node, so "did anything get booked?" is one question. */
  const blockCount = (store: Awaited<ReturnType<typeof mountToday>>) =>
    store.getState().goals.flatMap((g) => g.nodes).flatMap((n) => blocksOf(n)).length;

  it('opens the task when the primary offer row is clicked, and books nothing', async () => {
    const store = await mountToday();

    await act(async () => {
      // Title + subtitle, which is what `TaskRow` composes when no explicit
      // `ariaLabel` is passed — the same name Rest of today and Carried over
      // rows already carry. That sameness is the point of the change.
      screen.getByRole('button', { name: 'Draft the introThesis' }).click();
    });

    expect(blockCount(store)).toBe(0);
    expect(store.getState().openGoalId).toBe('g1');
  });

  it('opens the task when a Free time row is clicked, and books nothing', async () => {
    const store = await mountToday({ goals: twoProjects });

    await act(async () => {
      screen.getByRole('button', { name: 'Chase the refereeGrant' }).click();
    });

    expect(blockCount(store)).toBe(0);
    expect(store.getState().openGoalId).toBe('g2');
  });

  /**
   * The day stops living only in the heading. `dayLabel` is already computed
   * for the accessible name, so a screen reader was told which day the click
   * booked and a sighted reader was not.
   */
  it('names the day on the verb, capitalised the way the carry-over verb is', async () => {
    await mountToday();

    const verb = screen.getByRole('button', { name: 'Plan “Draft the intro” today' });
    expect(verb.textContent).toBe('Today');
  });

  it('still books through the verb', async () => {
    const store = await mountToday();

    await act(async () => {
      screen.getByRole('button', { name: 'Plan “Draft the intro” today' }).click();
    });

    expect(blockCount(store)).toBe(1);
  });
});
