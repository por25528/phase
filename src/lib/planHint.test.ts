import { describe, it, expect } from 'vitest';
import type { Goal, Task } from '../db/types';
import { hasPlacedWork, showPlanHint } from './planHint';

function goal(over: Partial<Goal> = {}): Goal {
  return { id: 'g1', title: 'Thesis', nodes: [], ...over };
}
function task(over: Partial<Task> = {}): Task {
  return { id: 't1', title: 'Email', done: false, goalId: null, ...over } as Task;
}

describe('hasPlacedWork', () => {
  it('is false for work that exists but has never been scheduled', () => {
    expect(hasPlacedWork([goal({ nodes: [{ id: 'n1', title: 'Draft' }] })], [task()])).toBe(false);
  });

  it('is false for a step with a day but no start minute — not on the grid', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedDay: '2026-07-15' }] });
    expect(hasPlacedWork([g], [])).toBe(false);
  });

  it('is false for a task with a start minute but no day', () => {
    expect(hasPlacedWork([], [task({ startMin: 600 })])).toBe(false);
  });

  it('is true for a fully placed step', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedDay: '2026-07-15', plannedStartMin: 600 }] });
    expect(hasPlacedWork([g], [])).toBe(true);
  });

  it('is true for a fully placed task', () => {
    expect(hasPlacedWork([], [task({ date: '2026-07-15', startMin: 600 })])).toBe(true);
  });

  it('finds a placed leaf nested below the top level', () => {
    const g = goal({
      nodes: [{
        id: 'p', title: 'Part',
        children: [{ id: 'n1', title: 'Draft', plannedDay: '2026-07-15', plannedStartMin: 600 }],
      }],
    });
    expect(hasPlacedWork([g], [])).toBe(true);
  });

  it('counts a placement in any week, not just a given one', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2020-01-06', plannedDay: '2020-01-08', plannedStartMin: 540 }] });
    expect(hasPlacedWork([g], [])).toBe(true);
  });
});

describe('showPlanHint', () => {
  const unplanned = [goal({ nodes: [{ id: 'n1', title: 'Draft' }] })];

  it('shows when there is work, working hours, and nothing placed yet', () => {
    expect(showPlanHint(unplanned, [], true)).toBe(true);
  });

  it('retires itself once anything has been placed', () => {
    const placed = [goal({ nodes: [{ id: 'n1', title: 'Draft', plannedDay: '2026-07-15', plannedStartMin: 600 }] })];
    expect(showPlanHint(placed, [], true)).toBe(false);
  });

  it('stays hidden with no working hours — the drop it describes cannot succeed', () => {
    expect(showPlanHint(unplanned, [], false)).toBe(false);
  });

  it('stays hidden on an empty install — there is nothing to drag', () => {
    expect(showPlanHint([], [], true)).toBe(false);
  });

  it('shows for a loose task with no project', () => {
    expect(showPlanHint([], [task()], true)).toBe(true);
  });
});
