import { describe, it, expect } from 'vitest';
import type { Goal, Task } from '../db/types';
import { scheduledOn, spansOn } from './scheduled';
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

  it('ignores leaves on other days and archived projects', () => {
    const other = goal({ nodes: [{ id: 'n1', title: 'x', plannedWeek: '2026-07-13', plannedDay: '2026-07-16', plannedStartMin: 600 }] });
    const archived = goal({ id: 'g2', completedAt: '2026-07-01', nodes: [{ id: 'n2', title: 'y', plannedWeek: '2026-07-13', plannedDay: DAY, plannedStartMin: 600 }] });
    expect(scheduledOn([other, archived], [], DAY)).toEqual([]);
  });

  it('includes a scheduled task and sorts everything by start minute', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13', plannedDay: DAY, plannedStartMin: 660, estimateMin: 30 }] });
    const t = task({ date: DAY, startMin: 540, estimateMin: 30 });
    expect(scheduledOn([g], [t], DAY).map((i) => i.id)).toEqual(['t1', 'n1']);
  });

  it('ignores a task with a date but no start minute', () => {
    expect(scheduledOn([], [task({ date: DAY })], DAY)).toEqual([]);
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
