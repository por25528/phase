import { describe, it, expect } from 'vitest';
import type { Goal, Task } from '../db/types';
import { MIN_SITTING_MIN, PLAN_DAY_HORIZON, PROPOSAL_MAX, dayLabel, dayVerb, nextFreeDay, offerHeading, proposalRows, todayPlan } from './todayPlan';
import type { PlacedSpan } from './slot';
import { backlogGroups } from './backlog';
import { makeBlock } from './blocks';

// Wednesday. weekDates() orders dow 0 = Mon, so Wednesday is dow 2.
const TODAY = '2026-07-15';
const WEEK = '2026-07-13';

/**
 * The ordinary day is 08:00–20:00, every date, and nothing configures it. A
 * day has room unless something is ON it, so these fixtures are placements
 * rather than windows.
 */
const CLEAR = () => [];
const SOLID = () => [{ startMin: 0, endMin: 1440 }];
const solidExcept = (open: string) => (date: string): PlacedSpan[] =>
  (date === open ? [] : [{ startMin: 0, endMin: 1440 }]);

function goal(over: Partial<Goal> = {}): Goal {
  return { id: 'g1', title: 'Thesis', nodes: [], ...over };
}
function task(over: Partial<Task> = {}): Task {
  return { id: 't1', title: 'Email', done: false, goalId: null, ...over } as Task;
}

function plan(over: {
  goals?: Goal[];
  tasks?: Task[];
  placedOn?: (date: string) => PlacedSpan[];
  today?: string;
  minute?: number;
} = {}) {
  return todayPlan({
    goals: over.goals ?? [goal({ nodes: [{ id: 'n1', title: 'Draft' }] })],
    tasks: over.tasks ?? [],
    blocks: [],
    placedOn: over.placedOn ?? CLEAR,
    allDayBlocks: false,
    today: over.today ?? TODAY,
    week: WEEK,
    now: { date: over.today ?? TODAY, minute: over.minute ?? 10 * 60 },
  });
}

describe('nextFreeDay', () => {
  it('is today while today still has a run left in it', () => {
    // 10:00 on a clear day: 10:00–20:00 of the ordinary day is unbooked.
    expect(nextFreeDay(TODAY, [], CLEAR, false, { date: TODAY, minute: 10 * 60 }))
      .toEqual({ date: TODAY, gapMin: 10 * 60 });
  });

  /**
   * The evening case, which is what the surface was silent through.
   * `remainingSpan` inside `longestFreeGap` already returns nothing once the
   * ordinary day has closed, so rolling forward needs no special case — only
   * the scan.
   */
  it('rolls to tomorrow once the ordinary day has closed', () => {
    expect(nextFreeDay(TODAY, [], CLEAR, false, { date: TODAY, minute: 21 * 60 }))
      .toEqual({ date: '2026-07-16', gapMin: 12 * 60 });
  });

  it('rolls past a day booked solid', () => {
    expect(nextFreeDay(TODAY, [], solidExcept('2026-07-17'), false,
      { date: TODAY, minute: 10 * 60 })).toEqual({ date: '2026-07-17', gapMin: 12 * 60 });
  });

  /**
   * A RUN, never a sum. Two clear hours either side of a middle-of-the-day
   * meeting is not four hours you can sit down for, and an offer priced on the
   * total would name a day whose room it cannot actually deliver.
   */
  it('reports the widest run rather than the total free time', () => {
    const busy = [{ date: TODAY, startMin: 11 * 60, endMin: 12 * 60, title: 'Standup', allDay: false }];
    expect(nextFreeDay(TODAY, busy, CLEAR, false, { date: TODAY, minute: 10 * 60 }))
      .toEqual({ date: TODAY, gapMin: 8 * 60 }); // 12:00–20:00 beats 10:00–11:00
  });

  /**
   * A fifteen-minute crack between two meetings is not somewhere to start a
   * project task. An offer you cannot act on is worse than no offer.
   */
  it('refuses a run too short to sit down in', () => {
    const nearlyFull = (): PlacedSpan[] => [
      { startMin: 0, endMin: 12 * 60 },
      { startMin: 12 * 60 + MIN_SITTING_MIN - 1, endMin: 1440 },
    ];
    expect(nextFreeDay(TODAY, [], nearlyFull, false, { date: TODAY, minute: 0 })).toBeNull();
  });

  it('is null when nothing inside the horizon has room', () => {
    expect(nextFreeDay(TODAY, [], SOLID, false, { date: TODAY, minute: 10 * 60 })).toBeNull();
  });

  /**
   * The only clear day lands exactly `PLAN_DAY_HORIZON` days out — one past the
   * last day the scan looks at. A week booked solid is not an empty page; it
   * does not need an offer.
   */
  it('does not look past the horizon', () => {
    expect(PLAN_DAY_HORIZON).toBe(7);
    expect(nextFreeDay(TODAY, [], solidExcept('2026-07-22'), false,
      { date: TODAY, minute: 10 * 60 })).toBeNull();
  });
});

describe('todayPlan', () => {
  /*
   * There used to be a `no-hours` verdict here, checked before the candidates.
   * "Phase does not know when you work" was actionable where "nothing to do"
   * is not — but nothing is ever asked when you work, so the state is
   * unreachable and the only refusal left is a horizon with no room in it.
   */
  it('has no no-hours verdict left to reach', () => {
    expect(plan().kind).toBe('offer');
    expect(plan({ goals: [] })).toEqual({ kind: 'none' });
  });

  it('offers today’s room when the day still has a run in it', () => {
    const p = plan();
    expect(p.kind).toBe('offer');
    if (p.kind !== 'offer') return;
    expect(p.date).toBe(TODAY);
    expect(p.today).toBe(true);
    expect(p.gapMin).toBe(10 * 60); // 10:00 to the ordinary day's 20:00
    expect(p.rows.map((r) => r.id)).toEqual(['n1']);
  });

  it('offers the next open day once today has closed', () => {
    const p = plan({ minute: 21 * 60 });
    expect(p.kind).toBe('offer');
    if (p.kind !== 'offer') return;
    expect(p.date).toBe('2026-07-16');
    expect(p.today).toBe(false);
  });

  it('offers nothing when there is nothing left to place', () => {
    expect(plan({ goals: [] })).toEqual({ kind: 'none' });
  });

  it('offers nothing when the horizon holds no room', () => {
    expect(plan({ placedOn: SOLID }))
      .toEqual({ kind: 'none' });
  });

  it('takes one row per project, not a project’s whole queue', () => {
    const g = goal({
      nodes: [
        { id: 'n1', title: 'Draft' },
        { id: 'n2', title: 'Revise' },
        { id: 'n3', title: 'Submit' },
      ],
    });
    const p = plan({ goals: [g] });
    if (p.kind !== 'offer') throw new Error('expected an offer');
    expect(p.rows.map((r) => r.id)).toEqual(['n1']);
  });

  it('carries the project title and estimate onto the row', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', estimateMin: 45 }] });
    const p = plan({ goals: [g] });
    if (p.kind !== 'offer') throw new Error('expected an offer');
    expect(p.rows[0]).toEqual({
      key: 'step:n1', kind: 'step', id: 'n1', goalId: 'g1',
      title: 'Draft', goalTitle: 'Thesis', estimateMin: 45,
    });
  });

  it('sorts projects by their nearest visible deadline', () => {
    const soon = goal({
      id: 'g2', title: 'Exam', column: 0,
      nodes: [{ id: 'a', title: 'Past papers', deadline: '2026-07-16' }],
    });
    const later = goal({ id: 'g1', title: 'Thesis', column: 0, nodes: [{ id: 'b', title: 'Draft' }] });
    const p = plan({ goals: [later, soon] });
    if (p.kind !== 'offer') throw new Error('expected an offer');
    expect(p.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(p.rows[0].due).toBe('2026-07-16');
  });

  it('caps the list', () => {
    const goals = Array.from({ length: PROPOSAL_MAX + 3 }, (_, i) => goal({
      id: `g${i}`, title: `Project ${i}`, nodes: [{ id: `n${i}`, title: 'Step' }],
    }));
    const p = plan({ goals });
    if (p.kind !== 'offer') throw new Error('expected an offer');
    expect(p.rows).toHaveLength(PROPOSAL_MAX);
  });

  it('includes a loose task', () => {
    const p = plan({ goals: [], tasks: [task({ title: 'Email Ana' })] });
    if (p.kind !== 'offer') throw new Error('expected an offer');
    expect(p.rows).toEqual([
      { key: 'task:t1', kind: 'task', id: 't1', title: 'Email Ana', goalTitle: 'Loose tasks' },
    ]);
  });

  /**
   * The loose bucket is not a project, so the "one row per project" ration —
   * which stops a single project's queue dominating — must not apply to it.
   * Rationing it that way was what put ONE of nine open loose tasks on an
   * otherwise empty page. Each loose task is its own candidate; the cap still
   * holds the line at PROPOSAL_MAX.
   */
  it('offers every loose task, not one, up to the cap', () => {
    const tasks = Array.from({ length: 9 }, (_, i) => task({ id: `t${i}`, title: `Task ${i}` }));
    const p = plan({ goals: [], tasks });
    if (p.kind !== 'offer') throw new Error('expected an offer');
    expect(p.rows).toHaveLength(PROPOSAL_MAX);
    expect(p.rows.every((r) => r.kind === 'task')).toBe(true);
  });

  it('orders loose tasks by their nearest visible due date', () => {
    const tasks = [
      task({ id: 't-far', title: 'Someday', date: undefined }),
      task({ id: 't-soon', title: 'Tomorrow', date: '2026-07-16' }),
      task({ id: 't-mid', title: 'In three days', date: '2026-07-18' }),
    ];
    const p = plan({ goals: [], tasks });
    if (p.kind !== 'offer') throw new Error('expected an offer');
    expect(p.rows.map((r) => r.id)).toEqual(['t-soon', 't-mid', 't-far']);
  });

  /**
   * A real project is still rationed to one row even when many loose tasks are
   * present — only the loose bucket is un-rationed.
   */
  it('still takes one row per real project alongside a full loose bucket', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft' }, { id: 'n2', title: 'Revise' }] });
    const tasks = Array.from({ length: 9 }, (_, i) => task({ id: `t${i}`, title: `Task ${i}` }));
    const p = plan({ goals: [g], tasks });
    if (p.kind !== 'offer') throw new Error('expected an offer');
    expect(p.rows.filter((r) => r.goalId === 'g1')).toHaveLength(1);
    expect(p.rows).toHaveLength(PROPOSAL_MAX);
  });

  /**
   * Inherited from `backlogGroups` and pinned here, because the offer must not
   * be able to drift from the rail: a parked project's untouched work is not
   * something to spend an afternoon on, but its committed work is a number the
   * capacity readout already bills you for.
   */
  it('leaves a parked project’s untouched work out, and keeps its commitment', () => {
    const parked = goal({
      column: 2,
      nodes: [{ id: 'n1', title: 'Someday' }, { id: 'n2', title: 'Promised', plannedWeek: WEEK }],
    });
    const p = plan({ goals: [parked] });
    if (p.kind !== 'offer') throw new Error('expected an offer');
    expect(p.rows.map((r) => r.id)).toEqual(['n2']);
  });

  it('leaves out work that is already on the calendar', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', blocks: [makeBlock(TODAY, 9 * 60, 60)] }] });
    expect(plan({ goals: [g] })).toEqual({ kind: 'none' });
  });
});

describe('todayPlan exclusions', () => {
  const baseInput = {
    goals: [goal({ nodes: [{ id: 'n1', title: 'Draft' }] })],
    tasks: [],
    blocks: [],
    placedOn: CLEAR,
    allDayBlocks: false,
    today: TODAY,
    week: WEEK,
    now: { date: TODAY, minute: 10 * 60 },
  };

  it('drops a row the caller says is already on the page', () => {
    const rows = proposalRows(baseInput.goals, baseInput.tasks, WEEK, TODAY);
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0];
    const after = proposalRows(baseInput.goals, baseInput.tasks, WEEK, TODAY, new Set([first.key]));
    expect(after.map((r) => r.key)).not.toContain(first.key);
  });

  it('falls through to the next item in the same project', () => {
    const goals = [goal({
      nodes: [
        { id: 'n1', title: 'Draft' },
        { id: 'n2', title: 'Revise' },
      ],
    })];
    const all = proposalRows(goals, [], WEEK, TODAY);
    const target = all[0];
    const after = proposalRows(goals, [], WEEK, TODAY, new Set([target.key]));
    const next = backlogGroups(goals, [], WEEK, TODAY)[0].items[1];
    const sameProject = after.find((r) => r.goalTitle === target.goalTitle);
    expect(sameProject).toBeTruthy();
    expect(sameProject!.key).toBe(`${next.kind}:${next.id}`);
  });

  it('fills the proposal cap after excluding a project’s top item', () => {
    const goals = Array.from({ length: PROPOSAL_MAX + 1 }, (_, i) => goal({
      id: `g${i}`, title: `Project ${i}`, nodes: [{ id: `n${i}`, title: `Step ${i}` }],
    }));
    const after = proposalRows(goals, [], WEEK, TODAY, new Set(['step:n0']));

    expect(after).toHaveLength(PROPOSAL_MAX);
    expect(after[0].key).toBe('step:n1');
  });

  it('excludes an already-shown loose task and keeps the rest', () => {
    const tasks = Array.from({ length: 3 }, (_, i) => task({ id: `t${i}`, title: `Task ${i}` }));
    const after = proposalRows([], tasks, WEEK, TODAY, new Set(['task:t0']));
    expect(after.map((r) => r.id)).toEqual(['t1', 't2']);
  });

  it('threads the exclusion through todayPlan', () => {
    const open = todayPlan({ ...baseInput });
    expect(open.kind).toBe('offer');
    const keys = open.kind === 'offer' ? open.rows.map((r) => r.key) : [];
    const filtered = todayPlan({ ...baseInput, exclude: new Set(keys) });
    expect(filtered.kind).toBe('none');
  });
});

describe('offerHeading', () => {
  it('names the run it found on today', () => {
    expect(offerHeading({ date: TODAY, today: true, gapMin: 200 }, TODAY)).toBe('3h 20m open today');
  });

  it('says tomorrow by name', () => {
    expect(offerHeading({ date: '2026-07-16', today: false, gapMin: 480 }, TODAY))
      .toBe('Today is booked — tomorrow has 8h open');
  });

  it('dates anything further out', () => {
    expect(offerHeading({ date: '2026-07-20', today: false, gapMin: 480 }, TODAY))
      .toBe('Today is booked — Jul 20 has 8h open');
  });
});

/**
 * The button form of the same day. It exists so the offer verb and the
 * carry-over verb cannot drift: both say `Today` for the same act.
 */
describe('dayVerb', () => {
  it('capitalises the sentence fragment dayLabel returns', () => {
    expect(dayLabel('2026-07-15', '2026-07-15')).toBe('today');
    expect(dayVerb('2026-07-15', '2026-07-15')).toBe('Today');
    expect(dayVerb('2026-07-16', '2026-07-15')).toBe('Tomorrow');
  });

  it('leaves an already-capitalised date alone', () => {
    expect(dayVerb('2026-08-17', '2026-07-15')).toBe('Aug 17');
  });
});
