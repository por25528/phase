import { describe, it, expect } from 'vitest';
import type { AvailabilityWindow, Goal, Task } from '../db/types';
import { PLAN_DAY_HORIZON, PROPOSAL_MAX, nextFreeDay, offerHeading, proposalRows, todayPlan } from './todayPlan';
import { makeBlock } from './blocks';

// Wednesday. weekDates() orders dow 0 = Mon, so Wednesday is dow 2.
const TODAY = '2026-07-15';
const WEEK = '2026-07-13';

/** 09:00–17:00, every day, so the calendar is not the thing under test. */
const ALWAYS: AvailabilityWindow[] = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
  dow, startMin: 9 * 60, endMin: 17 * 60,
}));

/** Weekdays only — the shape that makes a Sunday evening roll to Monday. */
const WEEKDAYS: AvailabilityWindow[] = [0, 1, 2, 3, 4].map((dow) => ({
  dow, startMin: 9 * 60, endMin: 17 * 60,
}));

function goal(over: Partial<Goal> = {}): Goal {
  return { id: 'g1', title: 'Thesis', nodes: [], ...over };
}
function task(over: Partial<Task> = {}): Task {
  return { id: 't1', title: 'Email', done: false, goalId: null, ...over } as Task;
}

function plan(over: {
  goals?: Goal[];
  tasks?: Task[];
  availability?: AvailabilityWindow[];
  today?: string;
  minute?: number;
} = {}) {
  return todayPlan({
    goals: over.goals ?? [goal({ nodes: [{ id: 'n1', title: 'Draft' }] })],
    tasks: over.tasks ?? [],
    availability: over.availability ?? ALWAYS,
    blocks: [],
    allDayBlocks: false,
    today: over.today ?? TODAY,
    week: WEEK,
    now: { date: over.today ?? TODAY, minute: over.minute ?? 10 * 60 },
  });
}

describe('nextFreeDay', () => {
  it('is today while today still has time left', () => {
    expect(nextFreeDay(TODAY, ALWAYS, [], false, { date: TODAY, minute: 10 * 60 }))
      .toEqual({ date: TODAY, freeMin: 7 * 60 });
  });

  /**
   * The Sunday-evening case, which is what the surface was silent through.
   * `remainingWindow` already returns null for a window that has closed, so
   * rolling forward needs no special case — only the scan.
   */
  it('rolls to tomorrow once today’s window has closed', () => {
    expect(nextFreeDay(TODAY, ALWAYS, [], false, { date: TODAY, minute: 19 * 60 }))
      .toEqual({ date: '2026-07-16', freeMin: 8 * 60 });
  });

  it('skips days with no working hours at all', () => {
    // Friday 19:00 → Saturday and Sunday are off → Monday.
    const friday = '2026-07-17';
    expect(nextFreeDay(friday, WEEKDAYS, [], false, { date: friday, minute: 19 * 60 }))
      .toEqual({ date: '2026-07-20', freeMin: 8 * 60 });
  });

  it('subtracts busy time from the day it reports', () => {
    const busy = [{ date: TODAY, startMin: 11 * 60, endMin: 12 * 60, title: 'Standup', allDay: false }];
    expect(nextFreeDay(TODAY, ALWAYS, busy, false, { date: TODAY, minute: 10 * 60 }))
      .toEqual({ date: TODAY, freeMin: 6 * 60 });
  });

  it('is null when nothing inside the horizon is free', () => {
    expect(nextFreeDay(TODAY, [], [], false, { date: TODAY, minute: 10 * 60 })).toBeNull();
  });

  /**
   * Today is a Wednesday and the only window is Wednesdays, so the next one
   * lands exactly `PLAN_DAY_HORIZON` days out — one day past the last day the
   * scan looks at. A week booked solid is not an empty page; it does not need
   * an offer.
   */
  it('does not look past the horizon', () => {
    expect(PLAN_DAY_HORIZON).toBe(7);
    expect(nextFreeDay(TODAY, [{ dow: 2, startMin: 9 * 60, endMin: 17 * 60 }], [], false,
      { date: TODAY, minute: 19 * 60 })).toBeNull();
  });
});

describe('todayPlan', () => {
  it('refuses to guess when working hours were never set', () => {
    expect(plan({ availability: [] })).toEqual({ kind: 'no-hours' });
  });

  /**
   * `no-hours` outranks having nothing to offer: "Phase does not know when you
   * work" is actionable and "nothing to do" is not, and only one of them is
   * true when availability is empty.
   */
  it('reports no-hours even with no candidates', () => {
    expect(plan({ availability: [], goals: [] })).toEqual({ kind: 'no-hours' });
  });

  it('offers today’s free time when the day is still open', () => {
    const p = plan();
    expect(p.kind).toBe('offer');
    if (p.kind !== 'offer') return;
    expect(p.date).toBe(TODAY);
    expect(p.today).toBe(true);
    expect(p.freeMin).toBe(7 * 60);
    expect(p.rows.map((r) => r.id)).toEqual(['n1']);
  });

  it('offers the next open day once today has closed', () => {
    const p = plan({ minute: 19 * 60 });
    expect(p.kind).toBe('offer');
    if (p.kind !== 'offer') return;
    expect(p.date).toBe('2026-07-16');
    expect(p.today).toBe(false);
  });

  it('offers nothing when there is nothing left to place', () => {
    expect(plan({ goals: [] })).toEqual({ kind: 'none' });
  });

  it('offers nothing when the horizon holds no free time', () => {
    expect(plan({ availability: [{ dow: 2, startMin: 9 * 60, endMin: 17 * 60 }], minute: 19 * 60 }))
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
    availability: ALWAYS,
    blocks: [],
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
    const sameProject = after.find((r) => r.goalTitle === target.goalTitle);
    expect(sameProject).toBeTruthy();
    expect(sameProject!.key).not.toBe(target.key);
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
  it('names today’s free time', () => {
    expect(offerHeading({ date: TODAY, today: true, freeMin: 200 }, TODAY)).toBe('3h 20m free today');
  });

  it('says tomorrow by name', () => {
    expect(offerHeading({ date: '2026-07-16', today: false, freeMin: 480 }, TODAY))
      .toBe('No time left today — tomorrow has 8h free');
  });

  it('dates anything further out', () => {
    expect(offerHeading({ date: '2026-07-20', today: false, freeMin: 480 }, TODAY))
      .toBe('No time left today — Jul 20 has 8h free');
  });
});
