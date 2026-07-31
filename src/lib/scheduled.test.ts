import { describe, it, expect } from 'vitest';
import type { Goal, Task } from '../db/types';
import { scheduledOn, scheduledByDate, spansOn } from './scheduled';
import { DEFAULT_SLOT_MIN } from './slot';

const DAY = '2026-07-15';

function goal(over: Partial<Goal> = {}): Goal {
  return { id: 'g1', title: 'Thesis', nodes: [], ...over };
}
const task = (over: Partial<Task> = {}): Task =>
  ({ id: 't1', title: 'Email', done: false, goalId: null, ...over }) as Task;

describe('scheduledOn', () => {
  it('returns a scheduled leaf with its computed span', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', plannedDay: DAY, plannedStartMin: 600, estimateMin: 90 }] });
    expect(scheduledOn([g], [], DAY)).toEqual([{
      kind: 'step', id: 'n1', goalId: 'g1', goalTitle: 'Thesis', title: 'Draft',
      done: false, date: DAY, startMin: 600, endMin: 690, estimated: true,
    }]);
  });

  it('falls back to DEFAULT_SLOT_MIN and flags the block as unestimated', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', plannedDay: DAY, plannedStartMin: 600 }] });
    const [item] = scheduledOn([g], [], DAY);
    expect(item.endMin).toBe(600 + DEFAULT_SLOT_MIN);
    expect(item.estimated).toBe(false);
  });

  it('ignores a leaf with a day but no start minute', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', plannedDay: DAY }] });
    expect(scheduledOn([g], [], DAY)).toEqual([]);
  });

  it('ignores a leaf planned on another day', () => {
    const other = goal({ nodes: [{ id: 'n1', title: 'x', plannedWeek: '2026-07-13', plannedDay: '2026-07-16', plannedStartMin: 600 }] });
    expect(scheduledOn([other], [], DAY)).toEqual([]);
  });

  it('ignores leaves belonging to archived (completed) projects', () => {
    const archived = goal({ id: 'g2', completedAt: '2026-07-01', nodes: [{ id: 'n2', title: 'y', plannedWeek: '2026-07-13', plannedDay: DAY, plannedStartMin: 600 }] });
    expect(scheduledOn([archived], [], DAY)).toEqual([]);
  });

  it.each([
    ['zero', 0],
    ['negative', -30],
    ['NaN', NaN],
  ])('treats a %s estimateMin as unestimated and falls back to DEFAULT_SLOT_MIN', (_label, estimateMin) => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', plannedDay: DAY, plannedStartMin: 600, estimateMin }] });
    const [item] = scheduledOn([g], [], DAY);
    expect(item.estimated).toBe(false);
    expect(item.endMin).toBe(600 + DEFAULT_SLOT_MIN);
  });

  it('rounds a fractional estimateMin and still counts it as a real estimate', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', plannedDay: DAY, plannedStartMin: 600, estimateMin: 90.7 }] });
    const [item] = scheduledOn([g], [], DAY);
    expect(item.estimated).toBe(true);
    expect(item.endMin).toBe(600 + 91);
  });

  it('includes a scheduled task and sorts everything by start minute', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', plannedDay: DAY, plannedStartMin: 660, estimateMin: 30 }] });
    const t = task({ date: DAY, startMin: 540, estimateMin: 30 });
    expect(scheduledOn([g], [t], DAY).map((i) => i.id)).toEqual(['t1', 'n1']);
  });

  it('ignores a task with a date but no start minute', () => {
    expect(scheduledOn([], [task({ date: DAY })], DAY)).toEqual([]);
  });

  it('falls back to DEFAULT_SLOT_MIN and flags a task with no estimate as unestimated', () => {
    const t = task({ date: DAY, startMin: 540 });
    const [item] = scheduledOn([], [t], DAY);
    expect(item.estimated).toBe(false);
    expect(item.endMin).toBe(540 + DEFAULT_SLOT_MIN);
  });

  it('keeps done work — history still occupies its slot', () => {
    const t = task({ date: DAY, startMin: 540, estimateMin: 30, done: true });
    expect(scheduledOn([], [t], DAY)[0].done).toBe(true);
  });
});

describe('spansOn', () => {
  it('returns bare spans for everything scheduled that day', () => {
    const t = task({ date: DAY, startMin: 540, estimateMin: 60 });
    expect(spansOn([], [t], DAY)).toEqual([{ startMin: 540, endMin: 600 }]);
  });

  it('omits the excluded id so a block can move within its own gap', () => {
    const t = task({ date: DAY, startMin: 540, estimateMin: 60 });
    expect(spansOn([], [t], DAY, 't1')).toEqual([]);
  });
});

/**
 * The bucketing pass has to be indistinguishable from calling `scheduledOn`
 * once per day — it exists purely to stop the Plan view scanning the whole
 * dataset fourteen times per render, not to change any answer.
 */
describe('scheduledByDate', () => {
  const WEEK = ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16'];

  const goals: Goal[] = [
    {
      id: 'g1', title: '6.1200', nodes: [
        { id: 'a', title: 'Pset', plannedWeek: '2026-07-13', plannedDay: '2026-07-14', plannedStartMin: 600, estimateMin: 60 },
        { id: 'grp', title: 'Exam prep', children: [
          { id: 'b', title: 'Review', plannedWeek: '2026-07-13', plannedDay: '2026-07-14', plannedStartMin: 540 },
        ] },
        { id: 'unplaced', title: 'Later' },
      ],
    },
    {
      id: 'g2', title: 'Archived', completedAt: '2026-07-01', nodes: [
        { id: 'z', title: 'Old', plannedWeek: '2026-07-13', plannedDay: '2026-07-14', plannedStartMin: 700 },
      ],
    },
  ];
  const tasks: Task[] = [
    { id: 't1', title: 'Deck', date: '2026-07-14', startMin: 800, done: false, goalId: null },
    { id: 't2', title: 'Offsite', date: '2026-07-20', startMin: 540, done: false, goalId: null }, // outside the range
    { id: 't3', title: 'No time', date: '2026-07-15', done: false, goalId: null },
  ];

  it('agrees with scheduledOn for every day in the range', () => {
    const byDate = scheduledByDate(goals, tasks, WEEK);
    for (const date of WEEK) {
      expect(byDate.get(date)).toEqual(scheduledOn(goals, tasks, date));
    }
  });

  it('gives every requested date an entry, so callers need no null check', () => {
    const byDate = scheduledByDate(goals, tasks, WEEK);
    expect([...byDate.keys()]).toEqual(WEEK);
    expect(byDate.get('2026-07-16')).toEqual([]);
  });

  it('ignores work outside the requested range', () => {
    const byDate = scheduledByDate(goals, tasks, WEEK);
    expect([...byDate.values()].flat().map((i) => i.id)).not.toContain('t2');
  });

  it('drops archived projects and half-placed work, like scheduledOn', () => {
    const ids = [...scheduledByDate(goals, tasks, WEEK).values()].flat().map((i) => i.id);
    expect(ids).not.toContain('z');        // archived project
    expect(ids).not.toContain('unplaced'); // no day
    expect(ids).not.toContain('t3');       // day but no start minute
  });
});
