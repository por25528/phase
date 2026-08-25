// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, Habit, Task } from '../db/types';
import { blocksOf } from '../lib/blocks';
import { ruleTag } from '../components/sectionLabel';

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

    expect(screen.getByText('10h open today')).toBeTruthy(); // 10:00 → 20:00
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
   * The late-evening case. The ordinary day has closed, so the offer names the
   * day it will actually book rather than pretending there is room left.
   */
  it('rolls to the next open day once the ordinary day has closed', async () => {
    vi.setSystemTime(new Date(2026, 6, 15, 21, 0, 0));
    const store = await mountToday();

    expect(screen.getByText('Today is booked — tomorrow has 12h open')).toBeTruthy();
    await act(async () => {
      screen.getByRole('button', { name: 'Plan “Draft the intro” tomorrow' }).click();
    });

    expect(blocksOf(store.getState().goals[0].nodes[0])[0]).toMatchObject({
      date: '2026-07-16', startMin: 8 * 60, // ORDINARY_DAY.startMin
    });
  });

  /*
   * There used to be a "No working hours set" notice here, with a button into
   * Settings. Nothing asks when you work, so the state is unreachable — and
   * the only thing that can turn the offer away now is a horizon with no run
   * long enough in it, which hides the section rather than explaining itself.
   */
  it('has no working-hours notice left to show', async () => {
    await mountToday();
    expect(screen.queryByText(/No working hours set/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set your working hours' })).toBeNull();
  });

  it('offers nothing when there is nothing left to place', async () => {
    await mountToday({ goals: [] });

    expect(screen.queryByLabelText('Free time')).toBeNull();
    expect(screen.getByText(/Nothing committed to today/)).toBeTruthy();
  });

  /**
   * "Loose tasks" is one group but not one project, so the page used to ration
   * nine open tasks down to a single row on an otherwise empty screen. Each
   * loose task is its own candidate now, filling up to the PROPOSAL_MAX cap.
   */
  it('surfaces several loose tasks, not one, when the day is empty', async () => {
    await mountToday({
      goals: [],
      tasks: Array.from({ length: 9 }, (_, i) => ({
        id: `t${i}`, title: `Loose ${i}`, done: false, goalId: null, estimateMin: 30,
      })),
    });

    const shown = Array.from({ length: 9 }, (_, i) => `Loose ${i}`).filter((title) =>
      [...document.querySelectorAll('span')].some((span) => span.textContent === title),
    );
    // PROPOSAL_MAX (5) rows, never one and never all nine.
    expect(shown).toHaveLength(5);
  });
});

describe('the shared primary', () => {
  it("shows the advisor's primary as the top item with honest time copy", async () => {
    const store = await mountToday();

    const { executionAdvice } = await import('../lib/executionAdvisor');
    const { weekOf } = await import('../lib/plan');
    const { spansOn } = await import('../lib/scheduled');
    const s = store.getState();
    const advice = executionAdvice({
      goals: s.goals, tasks: s.tasks, sessions: s.sessions,
      blocks: [], placedOn: (date: string) => spansOn(s.goals, s.tasks, date),
      allDayBlocks: s.allDayBlocks,
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
   * text-muted` — eleven-pixel grey text, quieter than the row it sat on. It
   * then spent a spell as `rowBtn`, which fixed that and left a second problem:
   * `Replan`, a carry-over's `Today` and this one were three identical outlined
   * buttons, so the page ranked none of them. It is the FILLED one now, and the
   * only one on the surface — which is the whole of what `rowBtnPrimary` says.
   */
  it('renders Start session as the surface’s one filled button', async () => {
    await mountToday();

    const btn = screen.getByRole('button', { name: 'Start session on “Draft the intro”' });
    expect(btn.className).toContain('bg-ink');
    expect(btn.className).not.toContain('text-muted');
    // A second filled button would rank two things first, which ranks neither.
    const filled = screen.getAllByRole('button').filter((b) => b.className.includes('bg-ink'));
    expect(filled).toEqual([btn]);
  });

  /**
   * Three labels, three left edges, two colours once. Then one voice floating
   * over a rule. Now the label IS the rule: a tinted cell at its left end,
   * flush with the frame's own border, with the rows inset past it.
   */
  it('sets every section label into the rule rather than over it', async () => {
    await mountToday({
      goals: [{
        id: 'g1', title: 'Thesis', column: 0,
        nodes: [
          { id: 'n1', title: 'Draft the intro', plannedWeek: '2026-07-13' },
          { id: 'n2', title: 'Revise the intro', plannedWeek: '2026-07-13' },
        ],
      }],
    });

    // The heading element, not the span inside it: `RuleHeader` wraps the
    // label in its own truncation box now, because the goal tree feeds it a
    // user string with no bound. The VOICE and the cell edge stay on the
    // heading, which is what this is about.
    const label = screen.getByText('Rest of today').closest('h2')!;
    expect(label.className).toContain(ruleTag);
    // The cell's own edge is the separation — that is what buys the tag its ink.
    expect(label.className).toContain('border-r');
    expect(label.parentElement!.className).toContain('border-b');
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

/**
 * The row numbers, and the one place the approved mockup had to be overruled.
 *
 * It ran `01`, `02` continuously down the page, across `Next` and `Free time`
 * both. A structural device has to encode something true, and a shared sequence
 * across those two says they are one queue — when `Next` is work you committed
 * to and `Free time` is work `todayPlan` is OFFERING you, which is the entire
 * reason the offer is a separate projection with its own membership rules.
 *
 * So: numbers on the committed work only. `Next` and `Rest of today` share one
 * sequence, because `rest` is literally the committed list with the primary
 * removed and restarting it would print `01` twice for one queue. `Carried
 * over` restarts, because slipped commitments are a different population —
 * `buildDailyWork` keeps the two disjoint on purpose. The offer and `Done
 * today` carry none: an offer is not a commitment, and a record of a finished
 * day makes no claim about order at all.
 */
describe('the row numbers', () => {
  /** The two-digit cell TaskRow draws, or null when the row has no column. */
  function indexOf(title: string): string | null {
    const label = [...document.querySelectorAll('span')].find((s) => s.textContent === title);
    const row = label?.closest('div.group');
    const cell = row?.querySelector('[data-row-index]');
    return cell ? cell.textContent! : null;
  }

  it('runs one sequence across Next and Rest of today', async () => {
    await mountToday({
      goals: [{
        id: 'g1', title: 'Thesis', column: 0,
        nodes: [
          { id: 'n1', title: 'Draft the intro', plannedWeek: '2026-07-13' },
          { id: 'n2', title: 'Revise the intro', plannedWeek: '2026-07-13' },
        ],
      }],
    });

    expect(indexOf('Draft the intro')).toBe('01');
    expect(indexOf('Revise the intro')).toBe('02');
  });

  it('gives the free-time offer a column but never a number', async () => {
    await mountToday({
      goals: [
        { id: 'g1', title: 'Thesis', column: 0, nodes: [
          { id: 'n1', title: 'Draft the intro', plannedWeek: '2026-07-13' },
        ] },
        { id: 'g2', title: 'Startup', column: 0, nodes: [
          { id: 'n2', title: 'Pitch deck', estimateMin: 30 },
        ] },
      ],
    });

    expect(indexOf('Draft the intro')).toBe('01');
    // The column is reserved so the left edge holds; the NUMBER is withheld,
    // which is the claim. Dropping the column too would just misalign it.
    expect(indexOf('Pitch deck')).toBe('');
  });

  it('restarts the count for carried-over work', async () => {
    await mountToday({
      goals: [{
        id: 'g1', title: 'Thesis', column: 0,
        nodes: [
          { id: 'n1', title: 'Draft the intro', plannedWeek: '2026-07-13' },
          { id: 'n2', title: 'Chase the citation', plannedWeek: '2026-07-06' },
        ],
      }],
    });

    expect(indexOf('Draft the intro')).toBe('01');
    expect(indexOf('Chase the citation')).toBe('01');
  });
});
