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
        editable: true,
        source: 'due',
        plannedWeek: WEEK,
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
        editable: true,
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
        editable: true,
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
    expect(result.carryOvers[1].plannedWeek).toBe('2026-07-13');
  });

  it('treats an invalid day as unpinned while preserving an older valid planned week', () => {
    const goals = [
      goal('g', [
        {
          id: 'stale-invalid-day',
          title: 'Stale with malformed pin',
          plannedWeek: '2026-07-13',
          plannedDay: 'not-a-date',
        },
      ]),
    ];

    const result = buildDailyWork(goals, [], TODAY);

    expect(result.commitments).toEqual([]);
    expect(result.carryOvers.map(({ key, source, plannedDay }) => ({
      key,
      source,
      plannedDay,
    }))).toEqual([
      {
        key: 'step:stale-invalid-day',
        source: 'carry-over',
        plannedDay: undefined,
      },
    ]);
    expect(result.suggestions).toEqual([]);
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
    expect(result.completedToday.every((item) => item.editable)).toBe(true);
  });

  it('requires done state but keeps same-day leaves from archived projects', () => {
    const goals = [
      goal('active', [
        { id: 'open-stale', title: 'Open with stale timestamp', done: false, doneAt: TODAY },
      ]),
      goal('archived', [
        { id: 'archived-done', title: 'Archived completion', done: true, doneAt: TODAY },
      ], { completedAt: TODAY }),
    ];
    const tasks = [
      task('open-stale', TODAY, { done: false, doneAt: TODAY, goalId: 'archived' }),
      task('done', TODAY, { done: true, doneAt: TODAY, goalId: 'archived' }),
    ];

    const result = buildDailyWork(goals, tasks, TODAY);

    expect(result.completedToday.map((item) => item.key)).toEqual([
      'task:done',
      'step:archived-done',
    ]);
    expect(result.completedToday).toEqual([
      expect.objectContaining({
        goalId: 'archived',
        goalTitle: 'Goal archived',
        done: true,
        editable: true,
      }),
      expect.objectContaining({
        goalId: 'archived',
        goalTitle: 'Goal archived',
        done: true,
        editable: false,
      }),
    ]);
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

  it('labels each suggestion with why it surfaced', () => {
    const goals = [
      goal('a', [
        { id: 'undated', title: 'Undated' },
        { id: 'inwindow', title: 'In window', start: '2026-07-01', deadline: '2026-08-01' },
      ]),
    ];

    const byId = new Map(
      buildDailyWork(goals, [], TODAY).suggestions.map((s) => [s.id, s.reason]),
    );

    expect(byId.get('inwindow')).toBe('In its window');
    expect(byId.get('undated')).toBe('Next open step');
  });

  it('flags a soon milestone as the reason across that project', () => {
    const goals = [
      goal('m', [{ id: 'leaf', title: 'Leaf' }], {
        milestones: [{ id: 'ms', title: 'Demo', date: '2026-07-30' }],
      }),
    ];

    const result = buildDailyWork(goals, [], TODAY);

    expect(result.suggestions[0].reason).toBe('Milestone soon');
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

  it('treats malformed legacy step and project dates as absent scheduling metadata', () => {
    const projectDates = [
      goal('plain-first', [{ id: 'plain', title: 'Plain' }]),
      goal('bad-project', [{ id: 'bad-project-start', title: 'Bad project start' }], {
        start: 'not-a-date',
        milestones: [{ id: 'bad', title: 'Bad milestone', date: 'not-a-date' }],
      }),
    ];
    const stepDates = [
      goal('bad-deadline-goal', [
        { id: 'bad-deadline', title: 'Bad deadline', deadline: 'not-a-date' },
      ]),
      goal('bad-week-goal', [
        {
          id: 'bad-week',
          title: 'Bad week',
          plannedWeek: 'not-a-date',
          plannedDay: TODAY,
        },
      ]),
      goal('bad-day-goal', [
        {
          id: 'bad-day',
          title: 'Bad day',
          plannedWeek: WEEK,
          plannedDay: 'not-a-date',
        },
      ]),
      goal('bad-start-goal', [
        { id: 'bad-start', title: 'Bad start', start: 'not-a-date' },
      ]),
    ];

    const projectResult = buildDailyWork(projectDates, [], TODAY);
    const stepResult = buildDailyWork(stepDates, [], TODAY);

    expect(projectResult.suggestions.map((item) => item.id)).toEqual([
      'plain',
      'bad-project-start',
    ]);
    expect(stepResult.commitments.map(({ key, source, plannedDay }) => ({
      key,
      source,
      plannedDay,
    }))).toEqual([
      {
        key: 'step:bad-day',
        source: 'this-week',
        plannedDay: undefined,
      },
    ]);
    expect(stepResult.carryOvers).toEqual([]);
    expect(stepResult.suggestions.map((item) => item.id)).toEqual([
      'bad-deadline',
      'bad-week',
      'bad-start',
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

  it('ignores malformed task dates and returns no placements for an invalid week', () => {
    const tasks = [
      task('invalid', 'not-a-date'),
      task('valid', TODAY),
    ];

    expect(tasksForWeek(tasks, WEEK).map((item) => item.id)).toEqual(['valid']);
    expect(tasksForWeek(tasks, 'not-a-date')).toEqual([]);
  });

  it('excludes a task with no date from the week', () => {
    const dated: Task = { id: 't1', title: 'Dated', date: '2026-07-15', done: false, goalId: null };
    const undated: Task = { id: 't2', title: 'Undated', done: false, goalId: null };
    expect(tasksForWeek([dated, undated], '2026-07-13').map((t) => t.id)).toEqual(['t1']);
  });
});

describe('buildDailyWork malformed task dates', () => {
  it('does not schedule malformed tasks but retains valid same-day completion history', () => {
    const tasks = [
      task('open-invalid', 'not-a-date'),
      task('done-invalid', 'not-a-date', { done: true, doneAt: TODAY }),
    ];

    const result = buildDailyWork([], tasks, TODAY);

    expect(result.commitments).toEqual([]);
    expect(result.carryOvers).toEqual([]);
    expect(result.completedToday.map((item) => item.key)).toEqual(['task:done-invalid']);
  });
});
