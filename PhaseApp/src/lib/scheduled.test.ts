import { describe, it, expect } from 'vitest';
import type { Goal, Task } from '../db/types';
import { scheduledOn, scheduledByDate, spansOn } from './scheduled';
import { DEFAULT_SLOT_MIN } from './slot';
import { makeBlock } from './blocks';

const DAY = '2026-07-15';

function goal(over: Partial<Goal> = {}): Goal {
  return { id: 'g1', title: 'Thesis', nodes: [], ...over };
}
const task = (over: Partial<Task> = {}): Task =>
  ({ id: 't1', title: 'Email', done: false, goalId: null, ...over }) as Task;

describe('scheduledOn', () => {
  it('returns a scheduled leaf with its computed span', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', estimateMin: 90, blocks: [makeBlock(DAY, 600, 90)] }] });
    expect(scheduledOn([g], [], DAY)).toEqual([{
      kind: 'step', id: 'n1', blockId: expect.any(String),
      goalId: 'g1', goalTitle: 'Thesis', title: 'Draft',
      done: false, date: DAY, startMin: 600, endMin: 690, estimated: true,
    }]);
  });

  it('falls back to DEFAULT_SLOT_MIN and flags the block as unestimated', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', blocks: [makeBlock(DAY, 600, 60)] }] });
    const [item] = scheduledOn([g], [], DAY);
    expect(item.endMin).toBe(600 + DEFAULT_SLOT_MIN);
    expect(item.estimated).toBe(false);
  });

  /**
   * A week commitment is not a placement. The rail lists it as "to place"; the
   * grid draws nothing, because there is no hour to draw it at.
   */
  it('ignores a leaf committed to a week but never placed', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13' }] });
    expect(scheduledOn([g], [], DAY)).toEqual([]);
  });

  it('ignores a leaf planned on another day', () => {
    const other = goal({ nodes: [{ id: 'n1', title: 'x', plannedWeek: '2026-07-13', blocks: [makeBlock('2026-07-16', 600, 60)] }] });
    expect(scheduledOn([other], [], DAY)).toEqual([]);
  });

  it('ignores leaves belonging to archived (completed) projects', () => {
    const archived = goal({ id: 'g2', completedAt: '2026-07-01', nodes: [{ id: 'n2', title: 'y', plannedWeek: '2026-07-13', blocks: [makeBlock(DAY, 600, 60)] }] });
    expect(scheduledOn([archived], [], DAY)).toEqual([]);
  });

  it.each([
    ['zero', 0],
    ['negative', -30],
    ['NaN', NaN],
  ])('treats a %s estimateMin as unestimated and falls back to DEFAULT_SLOT_MIN', (_label, estimateMin) => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', estimateMin, blocks: [makeBlock(DAY, 600, 60)] }] });
    const [item] = scheduledOn([g], [], DAY);
    expect(item.estimated).toBe(false);
    expect(item.endMin).toBe(600 + DEFAULT_SLOT_MIN);
  });

  /**
   * A fractional estimate is still a real estimate, so the block is drawn solid
   * rather than dashed. Its HEIGHT no longer comes from it: a sitting owns its
   * own `minutes`, which is why resizing one stopped re-pricing the task.
   */
  it('counts a fractional estimateMin as real, and still draws the sitting’s own length', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', estimateMin: 90.7, blocks: [makeBlock(DAY, 600, 90)] }] });
    const [item] = scheduledOn([g], [], DAY);
    expect(item.estimated).toBe(true);
    expect(item.endMin).toBe(690);
  });

  it('includes a scheduled task and sorts everything by start minute', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', estimateMin: 30, blocks: [makeBlock(DAY, 660, 30)] }] });
    const t = task({ date: DAY, estimateMin: 30, blocks: [makeBlock(DAY, 540, 30)] });
    expect(scheduledOn([g], [t], DAY).map((i) => i.id)).toEqual(['t1', 'n1']);
  });

  it('ignores a task with a date but no start minute', () => {
    expect(scheduledOn([], [task({ date: DAY })], DAY)).toEqual([]);
  });

  it('falls back to DEFAULT_SLOT_MIN and flags a task with no estimate as unestimated', () => {
    const t = task({ date: DAY, blocks: [makeBlock(DAY, 540, 60)] });
    const [item] = scheduledOn([], [t], DAY);
    expect(item.estimated).toBe(false);
    expect(item.endMin).toBe(540 + DEFAULT_SLOT_MIN);
  });

  it('keeps done work — history still occupies its slot', () => {
    const t = task({ date: DAY, estimateMin: 30, done: true, blocks: [makeBlock(DAY, 540, 30)] });
    expect(scheduledOn([], [t], DAY)[0].done).toBe(true);
  });
});

describe('spansOn', () => {
  it('returns bare spans for everything scheduled that day', () => {
    const t = task({ date: DAY, estimateMin: 60, blocks: [makeBlock(DAY, 540, 60)] });
    expect(spansOn([], [t], DAY)).toEqual([{ startMin: 540, endMin: 600 }]);
  });

  /**
   * By SITTING, not by task. A block being moved must not collide with itself —
   * but it must still respect its own task's OTHER sittings, which are real
   * occupancy on the day it is being dropped onto.
   */
  it('omits the excluded sitting so a block can move within its own gap', () => {
    const t = task({ date: DAY, estimateMin: 60, blocks: [makeBlock(DAY, 540, 60)] });
    expect(spansOn([], [t], DAY, t.blocks![0].id)).toEqual([]);
  });

  it('keeps a task’s other sittings in the way', () => {
    const t = task({
      date: DAY,
      estimateMin: 60,
      blocks: [makeBlock(DAY, 540, 60), makeBlock(DAY, 660, 60)],
    });
    expect(spansOn([], [t], DAY, t.blocks![0].id)).toEqual([{ startMin: 660, endMin: 720 }]);
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
        { id: 'a', title: 'Pset', plannedWeek: '2026-07-13', estimateMin: 60, blocks: [makeBlock('2026-07-14', 600, 60)] },
        { id: 'grp', title: 'Exam prep', children: [
          { id: 'b', title: 'Review', plannedWeek: '2026-07-13', blocks: [makeBlock('2026-07-14', 540, 60)] },
        ] },
        { id: 'unplaced', title: 'Later' },
      ],
    },
    {
      id: 'g2', title: 'Archived', completedAt: '2026-07-01', nodes: [
        { id: 'z', title: 'Old', plannedWeek: '2026-07-13', blocks: [makeBlock('2026-07-14', 700, 60)] },
      ],
    },
  ];
  const tasks: Task[] = [
    { id: 't1', title: 'Deck', date: '2026-07-14', done: false, goalId: null, blocks: [makeBlock('2026-07-14', 800, 60)] },
    { id: 't2', title: 'Offsite', date: '2026-07-20', done: false, goalId: null, blocks: [makeBlock('2026-07-20', 540, 60)] }, // outside the range
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
