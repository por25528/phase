import { describe, it, expect } from 'vitest';
import type { Goal, Task } from '../db/types';
import { hasPlacedWork, showPlanHint } from './planHint';
import { makeBlock } from './blocks';

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

  it('is false for a step committed to a week but never placed', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2026-07-13' }] });
    expect(hasPlacedWork([g], [])).toBe(false);
  });

  /**
   * A sitting carries its own date, so the half-state this guarded against —
   * a start minute with no day — is no longer expressible. What remains is a
   * task committed to a day with nothing on the calendar, which is still not
   * placed work.
   */
  it('is false for a task committed to a day but never placed', () => {
    expect(hasPlacedWork([], [task({ date: '2026-07-15' })])).toBe(false);
  });

  it('is true for a fully placed step', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', blocks: [makeBlock('2026-07-15', 600, 60)] }] });
    expect(hasPlacedWork([g], [])).toBe(true);
  });

  it('is true for a fully placed task', () => {
    expect(hasPlacedWork([], [task({ date: '2026-07-15', blocks: [makeBlock('2026-07-15', 600, 60)] })])).toBe(true);
  });

  it('finds a placed leaf nested below the top level', () => {
    const g = goal({
      nodes: [{
        id: 'p', title: 'Part',
        children: [{ id: 'n1', title: 'Draft', blocks: [makeBlock('2026-07-15', 600, 60)] }],
      }],
    });
    expect(hasPlacedWork([g], [])).toBe(true);
  });

  it('counts a placement in any week, not just a given one', () => {
    const g = goal({ nodes: [{ id: 'n1', title: 'Draft', plannedWeek: '2020-01-06', blocks: [makeBlock('2020-01-08', 540, 60)] }] });
    expect(hasPlacedWork([g], [])).toBe(true);
  });
});

describe('showPlanHint', () => {
  const unplanned = [goal({ nodes: [{ id: 'n1', title: 'Draft' }] })];

  it('shows when there is work and nothing placed yet', () => {
    expect(showPlanHint(unplanned, [])).toBe(true);
  });

  it('retires itself once anything has been placed', () => {
    const placed = [goal({ nodes: [{ id: 'n1', title: 'Draft', blocks: [makeBlock('2026-07-15', 600, 60)] }] })];
    expect(showPlanHint(placed, [])).toBe(false);
  });

  it('stays hidden on an empty install — there is nothing to drag', () => {
    expect(showPlanHint([], [])).toBe(false);
  });

  it('shows for a loose task with no project', () => {
    expect(showPlanHint([], [task()])).toBe(true);
  });
});
