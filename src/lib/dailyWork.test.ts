import { describe, expect, it } from 'vitest';
import type { Goal, GoalNode, Task } from '../db/types';
import { buildDailyWork, tasksForWeek } from './dailyWork';

const TODAY = '2026-07-23';
const WEEK = '2026-07-20';

function goal(
  id: string,
  nodes: GoalNode[] = [],
  overrides: Partial<Goal> = {},
): Goal {
  return {
    id,
    title: `Goal ${id}`,
    nodes,
    column: 0,
    ...overrides,
  };
}

function task(
  id: string,
  date: string,
  overrides: Partial<Task> = {},
): Task {
  return {
    id,
    title: `Task ${id}`,
    date,
    done: false,
    goalId: null,
    ...overrides,
  };
}

describe('buildDailyWork commitments', () => {
  it('orders sources by precedence and de-duplicates a due planned step', () => {
    const goals = [
      goal('g', [
        {
          id: 'due',
          title: 'Due and pinned',
          deadline: TODAY,
          plannedWeek: WEEK,
          plannedDay: TODAY,
        },
        { id: 'pinned', title: 'Pinned', plannedWeek: WEEK, plannedDay: TODAY },
        { id: 'week', title: 'Week', plannedWeek: WEEK },
        { id: 'slipped', title: 'Slipped pin', plannedWeek: WEEK, plannedDay: '2026-07-22' },
        { id: 'future', title: 'Future pin', plannedWeek: WEEK, plannedDay: '2026-07-24' },
      ]),
    ];
    const tasks = [task('today', TODAY), task('tomorrow', '2026-07-24')];

    const result = buildDailyWork(goals, tasks, TODAY);

    expect(result.commitments.map(({ key, source, due }) => ({ key, source, due }))).toEqual([
      { key: 'step:due', source: 'due', due: true },
      { key: 'task:today', source: 'task-today', due: false },
      { key: 'step:pinned', source: 'pinned-today', due: false },
      { key: 'step:week', source: 'this-week', due: false },
      { key: 'step:slipped', source: 'this-week', due: false },
    ]);
  });

  it('adapts task and step context without preserving a dangling task goal id', () => {
    const goals = [
      goal('known', [
        {
          id: 'step',
          title: 'Step',
          deadline: TODAY,
          plannedWeek: WEEK,
          plannedDay: TODAY,
        },
      ]),
    ];
    const tasks = [
      task('known-task', TODAY, { goalId: 'known' }),
      task('dangling', TODAY, { goalId: 'missing' }),
    ];

    const result = buildDailyWork(goals, tasks, TODAY);

    expect(result.commitments).toEqual([
      {
        key: 'step:step',
        kind: 'step',
        id: 'step',
        title: 'Step',
        goalId: 'known',
        goalTitle: 'Goal known',
        due: true,
        done: false,
        source: 'due',
        plannedDay: TODAY,
        scheduledDate: TODAY,
      },
      {
        key: 'task:known-task',
        kind: 'task',
        id: 'known-task',
        title: 'Task known-task',
        goalId: 'known',
        goalTitle: 'Goal known',
        due: false,
        done: false,
        source: 'task-today',
        scheduledDate: TODAY,
      },
      {
        key: 'task:dangling',
        kind: 'task',
        id: 'dangling',
        title: 'Task dangling',
        goalId: null,
        due: false,
        done: false,
        source: 'task-today',
        scheduledDate: TODAY,
      },
    ]);
  });
});

describe('buildDailyWork carryovers and completion', () => {
  it('includes overdue tasks and stale plans but never repeats a due commitment', () => {
    const goals = [
      goal('g', [
        { id: 'stale', title: 'Stale', plannedWeek: '2026-07-13' },
        {
          id: 'stale-due',
          title: 'Stale and due',
          deadline: '2026-07-22',
          plannedWeek: '2026-07-13',
        },
        {
          id: 'slipped',
          title: 'Slipped this week',
          plannedWeek: WEEK,
          plannedDay: '2026-07-22',
        },
      ]),
    ];
    const tasks = [task('yesterday', '2026-07-22')];

    const result = buildDailyWork(goals, tasks, TODAY);

    expect(result.carryOvers.map(({ key, source }) => ({ key, source }))).toEqual([
      { key: 'task:yesterday', source: 'carry-over' },
      { key: 'step:stale', source: 'carry-over' },
    ]);
    expect(result.carryOvers.some((item) => item.id === 'stale-due')).toBe(false);
    expect(result.carryOvers.some((item) => item.id === 'slipped')).toBe(false);
  });

  it('uses doneAt exactly and does not infer legacy completion dates', () => {
    const goals = [
      goal('g', [
        { id: 'today', title: 'Done today', done: true, doneAt: TODAY },
        { id: 'legacy', title: 'Legacy done', done: true },
        { id: 'yesterday', title: 'Done yesterday', done: true, doneAt: '2026-07-22' },
        {
          id: 'container',
          title: 'Container',
          doneAt: TODAY,
          children: [{ id: 'nested', title: 'Nested today', done: true, doneAt: TODAY }],
        },
      ]),
    ];
    const tasks = [
      task('today', TODAY, { done: true, doneAt: TODAY }),
      task('legacy', TODAY, { done: true }),
      task('yesterday', TODAY, { done: true, doneAt: '2026-07-22' }),
    ];

    const result = buildDailyWork(goals, tasks, TODAY);

    expect(result.completedToday.map((item) => item.key)).toEqual([
      'task:today',
      'step:today',
      'step:nested',
    ]);
    expect(result.completedToday.every((item) => item.source === 'completed-today')).toBe(true);
  });
});

describe('buildDailyWork suggestions', () => {
  it('uses only active Now projects and excludes ineligible leaf dates', () => {
    const goals = [
      goal('now', [
        { id: 'eligible', title: 'Eligible' },
        { id: 'due', title: 'Already due', deadline: TODAY },
        { id: 'far', title: 'Too far away', start: '2026-08-23' },
        { id: 'planned', title: 'Already planned', plannedWeek: WEEK },
        { id: 'done', title: 'Already done', done: true },
      ]),
      goal('next', [{ id: 'next-leaf', title: 'Next' }], { column: 1 }),
      goal('later', [{ id: 'later-leaf', title: 'Later' }], { column: 2 }),
      goal('someday', [{ id: 'someday-leaf', title: 'Someday' }], { column: 3 }),
      goal('completed', [{ id: 'completed-leaf', title: 'Completed project' }], {
        completedAt: TODAY,
      }),
      goal('future-project', [{ id: 'future-project-leaf', title: 'Future project' }], {
        start: '2026-07-24',
      }),
    ];

    const result = buildDailyWork(goals, [], TODAY);

    expect(result.suggestions.map((item) => item.key)).toEqual(['step:eligible']);
  });

  it('ranks active spans, then undated leaves, then starts within 30 days, preserving tree order', () => {
    const activeThenUndated = [
      goal('ranked', [
        { id: 'future-a', title: 'Future A', start: '2026-08-01' },
        {
          id: 'branch',
          title: 'Branch',
          children: [
            { id: 'undated-a', title: 'Undated A', children: [] },
            {
              id: 'active-a',
              title: 'Active A',
              start: '2026-07-01',
              deadline: '2026-07-31',
            },
          ],
        },
        { id: 'active-b', title: 'Active B', start: '2026-07-20', deadline: '2026-08-20' },
        { id: 'undated-b', title: 'Undated B' },
      ]),
    ];
    const undatedThenFuture = [
      goal('ranked', [
        { id: 'future-a', title: 'Future A', start: '2026-08-01' },
        { id: 'undated-a', title: 'Undated A' },
        { id: 'future-b', title: 'Future B', start: '2026-07-30' },
      ]),
    ];

    const first = buildDailyWork(activeThenUndated, [], TODAY);
    const second = buildDailyWork(undatedThenFuture, [], TODAY);

    expect(first.suggestions.map((item) => item.id)).toEqual(['active-a', 'active-b']);
    expect(second.suggestions.map((item) => item.id)).toEqual(['undated-a', 'future-a']);
  });

  it('round-robins projects for at most two rounds and four total suggestions', () => {
    const goals = [
      goal('a', [
        { id: 'a1', title: 'A1' },
        { id: 'a2', title: 'A2' },
        { id: 'a3', title: 'A3' },
      ]),
      goal('b', [
        { id: 'b1', title: 'B1' },
        { id: 'b2', title: 'B2' },
      ]),
      goal('c', [{ id: 'c1', title: 'C1' }]),
    ];

    const result = buildDailyWork(goals, [], TODAY);

    expect(result.suggestions.map((item) => item.goalId)).toEqual(['a', 'b', 'c', 'a']);
    expect(result.suggestions).toHaveLength(4);
  });

  it('puts projects with a milestone in the next 14 days first', () => {
    const goals = [
      goal('plain', [{ id: 'plain-leaf', title: 'Plain' }]),
      goal('milestone', [{ id: 'milestone-leaf', title: 'Milestone' }], {
        milestones: [{ id: 'm', title: 'Marker', date: '2026-08-06' }],
      }),
      goal('past-milestone', [{ id: 'past-leaf', title: 'Past' }], {
        milestones: [{ id: 'old', title: 'Old', date: '2026-07-22' }],
      }),
    ];

    const result = buildDailyWork(goals, [], TODAY);

    expect(result.suggestions.map((item) => item.goalId)).toEqual([
      'milestone',
      'plain',
      'past-milestone',
    ]);
  });
});

describe('tasksForWeek', () => {
  it('includes open and completed tasks in the inclusive week sorted by date then title', () => {
    const tasks = [
      task('sun-z', '2026-07-26', { title: 'Zulu', done: true, doneAt: '2026-07-26' }),
      task('before', '2026-07-19'),
      task('mon-b', WEEK, { title: 'Beta' }),
      task('after', '2026-07-27'),
      task('mon-a', WEEK, { title: 'Alpha', done: true, doneAt: WEEK }),
    ];

    const result = tasksForWeek(tasks, '2026-07-23');

    expect(result.map((item) => item.id)).toEqual(['mon-a', 'mon-b', 'sun-z']);
    expect(result).not.toBe(tasks);
    expect(tasks.map((item) => item.id)).toEqual(['sun-z', 'before', 'mon-b', 'after', 'mon-a']);
  });
});
