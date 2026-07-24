import { describe, expect, it } from 'vitest';
import type { PlannedLeaf } from '../../lib/plan';
import type { Task } from '../../db/types';
import {
  canDragTask,
  canRescheduleDraggedTask,
  plannerOpenCount,
  resolvePlannerDrop,
  type PlannerDragData,
} from './planner';

const WEEK = '2026-07-20';

const stepDrag: PlannerDragData = {
  kind: 'step',
  goalId: 'g1',
  nodeId: 'n1',
  title: 'Draft brief',
};

const taskDrag: PlannerDragData = {
  kind: 'task',
  taskId: 't1',
  title: 'Call supplier',
};

function leaf(done = false): PlannedLeaf {
  return {
    goalId: 'g1',
    goalTitle: 'Launch',
    nodeId: 'n1',
    title: 'Draft brief',
    done,
    plannedWeek: WEEK,
  };
}

function task(done = false): Task {
  return {
    id: 't1',
    title: 'Call supplier',
    date: '2026-07-23',
    done,
    goalId: null,
  };
}

describe('resolvePlannerDrop', () => {
  it('preserves rail, Any day, and dated routing for project steps', () => {
    expect(resolvePlannerDrop(stepDrag, 'rail', WEEK)).toEqual({
      kind: 'unplan-step',
      goalId: 'g1',
      nodeId: 'n1',
    });
    expect(resolvePlannerDrop(stepDrag, 'anyday', WEEK)).toEqual({
      kind: 'plan-step',
      goalId: 'g1',
      nodeId: 'n1',
      week: WEEK,
    });
    expect(resolvePlannerDrop(stepDrag, 'day:2026-07-25', WEEK)).toEqual({
      kind: 'plan-step',
      goalId: 'g1',
      nodeId: 'n1',
      week: WEEK,
      day: '2026-07-25',
    });
  });

  it('reschedules a task only when dropped on a valid day in the displayed week', () => {
    expect(resolvePlannerDrop(taskDrag, 'day:2026-07-24', WEEK)).toEqual({
      kind: 'reschedule-task',
      taskId: 't1',
      date: '2026-07-24',
    });

    expect(resolvePlannerDrop(taskDrag, 'anyday', WEEK)).toBeNull();
    expect(resolvePlannerDrop(taskDrag, 'rail', WEEK)).toBeNull();
    expect(resolvePlannerDrop(taskDrag, 'day:not-a-date', WEEK)).toBeNull();
    expect(resolvePlannerDrop(taskDrag, 'day:2026-07-27', WEEK)).toBeNull();
  });

  it('rejects missing, malformed, and unknown drag or destination data', () => {
    expect(resolvePlannerDrop(undefined, 'day:2026-07-23', WEEK)).toBeNull();
    expect(resolvePlannerDrop(stepDrag, undefined, WEEK)).toBeNull();
    expect(resolvePlannerDrop({ kind: 'task', title: 'Missing id' }, 'day:2026-07-23', WEEK)).toBeNull();
    expect(resolvePlannerDrop({ kind: 'other', id: 'x' }, 'day:2026-07-23', WEEK)).toBeNull();
    expect(resolvePlannerDrop(stepDrag, 'unknown-zone', WEEK)).toBeNull();
    expect(resolvePlannerDrop(stepDrag, 'day:2026-07-23', 'not-a-date')).toBeNull();
  });
});

describe('planner task presentation', () => {
  it('counts only open tasks and open project leaves as open weekly work', () => {
    expect(plannerOpenCount([leaf(), leaf(true)], [task(), task(true)])).toBe(2);
  });

  it('keeps completed tasks visible but prevents dragging them', () => {
    expect(canDragTask(task())).toBe(true);
    expect(canDragTask(task(true))).toBe(false);
  });

  it('reschedules only a task that still exists and remains open', () => {
    expect(canRescheduleDraggedTask([task()], 't1')).toBe(true);
    expect(canRescheduleDraggedTask([task(true)], 't1')).toBe(false);
    expect(canRescheduleDraggedTask([task()], 'deleted')).toBe(false);
  });
});
