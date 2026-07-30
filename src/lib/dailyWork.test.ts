import { describe, expect, it } from 'vitest';
import type { Goal, GoalNode, Task } from '../db/types';
import { buildDailyWork, nowDividerIndex, tasksForWeek } from './dailyWork';
import type { DailyWorkItem } from './dailyWork';

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

// C-1: the Plan grid assigns real clock times, and Today used to know nothing
// about them — it listed a 09:00 standup below an 11:00 booking and showed no
// times at all, which made the default view contradict the flagship feature.
describe('buildDailyWork clock times', () => {
  it('carries a task startMin onto its item', () => {
    const sections = buildDailyWork([], [task('t', TODAY, { startMin: 540 })], TODAY);
    expect(sections.commitments[0].startMin).toBe(540);
  });

  it('carries a pinned step plannedStartMin onto its item', () => {
    const goals = [goal('g', [{
      id: 'n', title: 'Step', done: false,
      plannedWeek: WEEK, plannedDay: TODAY, plannedStartMin: 660,
    }])];
    expect(buildDailyWork(goals, [], TODAY).commitments[0].startMin).toBe(660);
  });

  it('leaves startMin absent when nothing is placed on the grid', () => {
    const sections = buildDailyWork([], [task('t', TODAY)], TODAY);
    expect(sections.commitments[0].startMin).toBeUndefined();
  });

  it('sorts timed commitments chronologically, whatever their source bucket', () => {
    const goals = [goal('g', [
      { id: 'n15', title: '15:00 kernel', done: false, plannedWeek: WEEK, plannedDay: TODAY, plannedStartMin: 900 },
      { id: 'n09', title: '09:00 standup', done: false, plannedWeek: WEEK, plannedDay: TODAY, plannedStartMin: 540 },
    ])];
    const tasks = [
      task('t13', TODAY, { startMin: 780 }),
      task('t11', TODAY, { startMin: 660 }),
    ];

    const titles = buildDailyWork(goals, tasks, TODAY).commitments.map((i) => i.title);
    expect(titles).toEqual(['09:00 standup', 'Task t11', 'Task t13', '15:00 kernel']);
  });

  it('sinks untimed work below every timed item but keeps its bucket order', () => {
    const goals = [goal('g', [
      { id: 'n', title: 'Timed step', done: false, plannedWeek: WEEK, plannedDay: TODAY, plannedStartMin: 900 },
      { id: 'nw', title: 'Anytime this week', done: false, plannedWeek: WEEK },
    ])];
    const tasks = [task('t', TODAY)];

    const items = buildDailyWork(goals, tasks, TODAY).commitments;
    expect(items.map((i) => i.title)).toEqual(['Timed step', 'Task t', 'Anytime this week']);
    expect(items[0].startMin).toBe(900);
    expect(items[1].startMin).toBeUndefined();
  });

  it('breaks a startMin tie by the existing bucket precedence, not by title', () => {
    const goals = [goal('g', [
      { id: 'n', title: 'AAA step', done: false, plannedWeek: WEEK, plannedDay: TODAY, plannedStartMin: 540 },
    ])];
    const tasks = [task('zzz', TODAY, { startMin: 540 })];

    // task-today outranks pinned-today in the bucket order.
    expect(buildDailyWork(goals, tasks, TODAY).commitments.map((i) => i.title))
      .toEqual(['Task zzz', 'AAA step']);
  });
});

describe('nowDividerIndex', () => {
  const at = (m?: number): DailyWorkItem => ({
    key: `k${m}`, kind: 'task', id: `${m}`, title: 't', goalId: null,
    due: false, done: false, editable: true, source: 'task-today',
    ...(m == null ? {} : { startMin: m }),
  });

  it('returns the position of the first item still ahead of now', () => {
    expect(nowDividerIndex([at(540), at(660), at(900)], 700)).toBe(2);
    expect(nowDividerIndex([at(540), at(660), at(900)], 500)).toBe(0);
  });

  it('returns null when every item is in the past', () => {
    expect(nowDividerIndex([at(540), at(660)], 900)).toBeNull();
  });

  it('returns null when nothing is timed — there is no clock to divide on', () => {
    expect(nowDividerIndex([at(), at()], 700)).toBeNull();
  });

  it('never places the divider at the very top, where it would mean nothing', () => {
    expect(nowDividerIndex([at(900)], 100)).toBe(0);
  });

  it('treats an item starting exactly now as still ahead', () => {
    expect(nowDividerIndex([at(540), at(700)], 700)).toBe(1);
  });
});
