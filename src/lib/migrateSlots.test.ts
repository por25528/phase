import { describe, it, expect } from 'vitest';
import type { AvailabilityWindow, Goal, Task } from '../db/types';
import { migrateSlots, describeMigration } from './migrateSlots';

const WED = '2026-07-15';   // Wednesday, dow 2
const WEEK = '2026-07-13';
const WINDOWS: AvailabilityWindow[] = [{ dow: 2, startMin: 540, endMin: 1080 }];

const goal = (nodes: Goal['nodes'], over: Partial<Goal> = {}): Goal =>
  ({ id: 'g1', title: 'Thesis', nodes, ...over });

describe('migrateSlots', () => {
  it('places an open day-pinned step at the start of its window', () => {
    const g = goal([{ id: 'n1', title: 'Draft', plannedWeek: WEEK, plannedDay: WED, estimateMin: 90 }]);
    const { goals, report } = migrateSlots([g], [], WINDOWS, true);
    expect(goals[0].nodes[0].plannedStartMin).toBe(540);
    expect(report.scheduledSteps).toBe(1);
  });

  it('stacks a second step after the first instead of overlapping it', () => {
    const g = goal([
      { id: 'n1', title: 'A', plannedWeek: WEEK, plannedDay: WED, estimateMin: 90 },
      { id: 'n2', title: 'B', plannedWeek: WEEK, plannedDay: WED, estimateMin: 60 },
    ]);
    const { goals } = migrateSlots([g], [], WINDOWS, true);
    expect(goals[0].nodes.map((n) => n.plannedStartMin)).toEqual([540, 630]);
  });

  it('returns an old Any-day step (week but no day) to the sidebar', () => {
    const g = goal([{ id: 'n1', title: 'Draft', plannedWeek: WEEK }]);
    const { goals, report } = migrateSlots([g], [], WINDOWS, true);
    expect(goals[0].nodes[0].plannedWeek).toBeUndefined();
    expect(goals[0].nodes[0].plannedDay).toBeUndefined();
    expect(report.sidebarSteps).toBe(1);
  });

  it('returns a step that will not fit its day to the sidebar', () => {
    const g = goal([{ id: 'n1', title: 'Huge', plannedWeek: WEEK, plannedDay: WED, estimateMin: 600 }]);
    const { goals, report } = migrateSlots([g], [], WINDOWS, true);
    expect(goals[0].nodes[0].plannedWeek).toBeUndefined();
    expect(goals[0].nodes[0].plannedStartMin).toBeUndefined();
    expect(report.sidebarSteps).toBe(1);
  });

  it('leaves done steps untouched', () => {
    const g = goal([{ id: 'n1', title: 'Done', done: true, plannedWeek: WEEK, plannedDay: WED }]);
    const { goals, report } = migrateSlots([g], [], WINDOWS, true);
    expect(goals[0].nodes[0]).toEqual({ id: 'n1', title: 'Done', done: true, plannedWeek: WEEK, plannedDay: WED });
    expect(report.scheduledSteps).toBe(0);
  });

  it('leaves unplanned steps alone', () => {
    const g = goal([{ id: 'n1', title: 'Someday' }]);
    expect(migrateSlots([g], [], WINDOWS, true).goals[0].nodes[0].plannedStartMin).toBeUndefined();
  });

  it('places an open dated task', () => {
    const t: Task = { id: 't1', title: 'Email', date: WED, done: false, goalId: null, estimateMin: 15 };
    const { tasks, report } = migrateSlots([], [t], WINDOWS, true);
    expect(tasks[0].startMin).toBe(540);
    expect(report.scheduledTasks).toBe(1);
  });

  it('drops the date of a task that will not fit, sending it to the sidebar', () => {
    const t: Task = { id: 't1', title: 'Huge', date: WED, done: false, goalId: null, estimateMin: 600 };
    const { tasks, report } = migrateSlots([], [t], WINDOWS, true);
    expect('date' in tasks[0]).toBe(false);
    expect(report.sidebarTasks).toBe(1);
  });

  it('schedules steps before tasks, so steps win the earlier slots', () => {
    const g = goal([{ id: 'n1', title: 'Step', plannedWeek: WEEK, plannedDay: WED, estimateMin: 60 }]);
    const t: Task = { id: 't1', title: 'Task', date: WED, done: false, goalId: null, estimateMin: 60 };
    const { goals, tasks } = migrateSlots([g], [t], WINDOWS, true);
    expect(goals[0].nodes[0].plannedStartMin).toBe(540);
    expect(tasks[0].startMin).toBe(600);
  });

  it('sends a step to the sidebar when the day is off entirely', () => {
    const g = goal([{ id: 'n1', title: 'Sat', plannedWeek: WEEK, plannedDay: '2026-07-18', estimateMin: 30 }]);
    expect(migrateSlots([g], [], WINDOWS, true).report.sidebarSteps).toBe(1);
  });

  it('is idempotent — a second run changes nothing', () => {
    const g = goal([
      { id: 'n1', title: 'A', plannedWeek: WEEK, plannedDay: WED, estimateMin: 90 },
      { id: 'n2', title: 'B', plannedWeek: WEEK, plannedDay: WED, estimateMin: 60 },
    ]);
    const t: Task = { id: 't1', title: 'Email', date: WED, done: false, goalId: null, estimateMin: 15 };
    const first = migrateSlots([g], [t], WINDOWS, true);
    const second = migrateSlots(first.goals, first.tasks, WINDOWS, true);
    expect(second.goals).toEqual(first.goals);
    expect(second.tasks).toEqual(first.tasks);
    expect(second.report).toEqual({ scheduledSteps: 0, scheduledTasks: 0, sidebarSteps: 0, sidebarTasks: 0 });
  });

  // Guards the span-registration branch: an item that ALREADY has both a day and
  // a start minute is skipped for PLACEMENT, but its span must still be registered
  // as occupied — otherwise the next item competing for that day is placed on top
  // of it, silently double-booking work the user already committed to.
  //
  // The idempotence test above does NOT pin this: there, every item is already
  // migrated, so nothing new is ever placed and a missing registration has no
  // observable effect. This test mixes an already-migrated item with a new one on
  // the same day, which is the only shape that exposes the bug.
  it('does not place new work on top of an already-migrated item', () => {
    const g = goal([
      // Already migrated, and occupies the entire 540..1080 window.
      { id: 'n1', title: 'Already placed', plannedWeek: WEEK, plannedDay: WED, plannedStartMin: 540, estimateMin: 540 },
      // Brand new, same day — there is no room left for it.
      { id: 'n2', title: 'New step', plannedWeek: WEEK, plannedDay: WED, estimateMin: 30 },
    ]);
    const { goals, report } = migrateSlots([g], [], WINDOWS, true);

    expect(goals[0].nodes[0].plannedStartMin).toBe(540); // untouched
    expect(goals[0].nodes[1].plannedStartMin).toBeUndefined();
    expect(goals[0].nodes[1].plannedDay).toBeUndefined();
    expect(report.sidebarSteps).toBe(1);
    expect(report.scheduledSteps).toBe(0);
  });

  it('does not mutate its inputs', () => {
    const g = goal([{ id: 'n1', title: 'Draft', plannedWeek: WEEK, plannedDay: WED, estimateMin: 90 }]);
    const snapshot = structuredClone(g);
    migrateSlots([g], [], WINDOWS, true);
    expect(g).toEqual(snapshot);
  });
});

describe('describeMigration', () => {
  it('returns null when nothing moved', () => {
    expect(describeMigration({ scheduledSteps: 0, scheduledTasks: 0, sidebarSteps: 0, sidebarTasks: 0 })).toBeNull();
  });
  it('reports placements and returns together', () => {
    expect(describeMigration({ scheduledSteps: 2, scheduledTasks: 1, sidebarSteps: 1, sidebarTasks: 0 }))
      .toBe('3 items placed on the calendar · 1 returned to the sidebar');
  });
  it('uses the singular for one item', () => {
    expect(describeMigration({ scheduledSteps: 1, scheduledTasks: 0, sidebarSteps: 0, sidebarTasks: 0 }))
      .toBe('1 item placed on the calendar');
  });
});
