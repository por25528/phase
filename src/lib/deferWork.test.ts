import { describe, expect, it } from 'vitest';
import type { Goal, GoalNode, Task } from '../db/types';
import { deferOpenWork } from './deferWork';

// today is Thu 2026-07-23; this week's Monday is 2026-07-20, so next week is
// 2026-07-27.
const TODAY = '2026-07-23';
const THIS_WEEK = '2026-07-20';
const NEXT_WEEK = '2026-07-27';

function goal(id: string, nodes: GoalNode[] = [], overrides: Partial<Goal> = {}): Goal {
  return { id, title: `Goal ${id}`, nodes, column: 0, ...overrides };
}

function task(id: string, date: string, overrides: Partial<Task> = {}): Task {
  return { id, title: `Task ${id}`, date, done: false, goalId: null, ...overrides };
}

describe('deferOpenWork', () => {
  it('moves overdue tasks to the target week, leaving today/future/done alone', () => {
    const tasks = [
      task('overdue', '2026-07-21'),
      task('today', TODAY),
      task('future', '2026-07-24'),
      task('done-overdue', '2026-07-19', { done: true, doneAt: '2026-07-19' }),
    ];

    const result = deferOpenWork([], tasks, TODAY, NEXT_WEEK);

    expect(result.count).toBe(1);
    const byId = new Map(result.tasks.map((t) => [t.id, t.date]));
    expect(byId.get('overdue')).toBe(NEXT_WEEK);
    expect(byId.get('today')).toBe(TODAY);
    expect(byId.get('future')).toBe('2026-07-24');
    expect(byId.get('done-overdue')).toBe('2026-07-19');
  });

  it('replans slipped steps onto the target week and clears the day pin', () => {
    const goals = [
      goal('g', [
        { id: 'slipped', title: 'Slipped', plannedWeek: '2026-07-13', plannedDay: '2026-07-15' },
        { id: 'thisweek', title: 'This week', plannedWeek: THIS_WEEK },
      ]),
    ];

    const result = deferOpenWork(goals, [], TODAY, NEXT_WEEK);

    expect(result.count).toBe(1);
    const nodes = result.goals[0].nodes;
    const slipped = nodes.find((n) => n.id === 'slipped')!;
    expect(slipped.plannedWeek).toBe(NEXT_WEEK);
    expect(slipped.plannedDay).toBeUndefined();
    // A step already committed to this week is not a carry-over.
    expect(nodes.find((n) => n.id === 'thisweek')!.plannedWeek).toBe(THIS_WEEK);
  });

  it('recurses into containers to find a slipped leaf', () => {
    const goals = [
      goal('g', [
        {
          id: 'branch',
          title: 'Branch',
          children: [
            { id: 'deep', title: 'Deep slipped', plannedWeek: '2026-07-06' },
          ],
        },
      ]),
    ];

    const result = deferOpenWork(goals, [], TODAY, NEXT_WEEK);

    expect(result.count).toBe(1);
    expect(result.goals[0].nodes[0].children![0].plannedWeek).toBe(NEXT_WEEK);
  });

  it('never sweeps a due step — it is a commitment, not a carry-over', () => {
    const goals = [
      goal('g', [
        { id: 'due', title: 'Due and slipped', deadline: '2026-07-22', plannedWeek: '2026-07-13' },
      ]),
    ];

    const result = deferOpenWork(goals, [], TODAY, NEXT_WEEK);

    expect(result.count).toBe(0);
    expect(result.goals[0].nodes[0].plannedWeek).toBe('2026-07-13');
  });

  it('returns the untouched arrays and count 0 when nothing is open', () => {
    const goals = [goal('g', [{ id: 'a', title: 'A', plannedWeek: THIS_WEEK }])];
    const tasks = [task('t', TODAY)];

    const result = deferOpenWork(goals, tasks, TODAY, NEXT_WEEK);

    expect(result.count).toBe(0);
    expect(result.goals).toBe(goals);
    expect(result.tasks).toBe(tasks);
  });

  it('ignores carry-overs on completed projects, matching Today', () => {
    const goals = [
      goal('done', [{ id: 'x', title: 'X', plannedWeek: '2026-07-13' }], { completedAt: TODAY }),
    ];

    const result = deferOpenWork(goals, [], TODAY, NEXT_WEEK);

    expect(result.count).toBe(0);
  });

  // Regression guard: replanNodes already clears plannedDay and plannedStartMin
  // together (see the comment above it) to hold the "never present without
  // plannedDay" invariant. This nails that shape down so a future edit that
  // clears only one of the two gets caught here.
  //
  // The brief's original literal dates ('2026-07-15' plannedWeek against a
  // '2026-07-15' today) don't actually slip — that plannedWeek's Monday
  // equals currentWeek, so dailyWork's `plannedWeek < currentWeek` carry-over
  // test excludes it and deferOpenWork is a no-op. Using this file's TODAY/
  // THIS_WEEK constants with a plannedWeek from the week before makes it a
  // genuine carry-over, and still exercises plannedDay/plannedStartMin.
  it('drops a start minute when deferring a placed step to another week', () => {
    const goals: Goal[] = [
      goal('g', [
        { id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', plannedDay: '2026-07-15', plannedStartMin: 600 },
      ]),
    ];
    const { goals: next } = deferOpenWork(goals, [], TODAY, NEXT_WEEK);
    const node = next[0].nodes[0];
    expect(node.plannedWeek).toBe(NEXT_WEEK);
    expect('plannedDay' in node).toBe(false);
    expect('plannedStartMin' in node).toBe(false);
  });
});
