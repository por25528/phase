import type { Task } from '../../db/types';
import type { PlannedLeaf } from '../../lib/plan';
import { weekDates } from '../../lib/dates';
import { isValidLocalDate } from '../../lib/schedule';

export type PlannerDragData =
  | { kind: 'step'; goalId: string; nodeId: string; title: string }
  | { kind: 'task'; taskId: string; title: string };

export type PlannerDropCommand =
  | { kind: 'unplan-step'; goalId: string; nodeId: string }
  | { kind: 'plan-step'; goalId: string; nodeId: string; week: string; day?: string }
  | { kind: 'reschedule-task'; taskId: string; date: string };

export function resolvePlannerDrop(
  data: unknown,
  overId: unknown,
  week: string,
): PlannerDropCommand | null {
  if (!isPlannerDragData(data) || typeof overId !== 'string' || !isValidLocalDate(week)) {
    return null;
  }

  const day = overId.startsWith('day:') ? overId.slice(4) : null;
  const validDay = day != null
    && isValidLocalDate(day)
    && weekDates(week).includes(day);

  if (data.kind === 'task') {
    return validDay
      ? { kind: 'reschedule-task', taskId: data.taskId, date: day }
      : null;
  }

  if (overId === 'rail') {
    return { kind: 'unplan-step', goalId: data.goalId, nodeId: data.nodeId };
  }
  if (overId === 'anyday') {
    return {
      kind: 'plan-step',
      goalId: data.goalId,
      nodeId: data.nodeId,
      week,
    };
  }
  if (validDay) {
    return {
      kind: 'plan-step',
      goalId: data.goalId,
      nodeId: data.nodeId,
      week,
      day,
    };
  }
  return null;
}

// Keyboard planning: map a digit pressed while a rail step is focused to a target
// within `days` (Mon..Sun). '1'–'7' pick that weekday; '0' means "any day this
// week" (planned to the week, no day pin). Anything else isn't a planning key, so
// the caller leaves the event alone.
export function plannerKeyTarget(
  key: string,
  days: string[],
): { day: string | null } | null {
  if (key === '0') return { day: null };
  const n = Number(key);
  if (Number.isInteger(n) && n >= 1 && n <= days.length) return { day: days[n - 1] };
  return null;
}

export function plannerOpenCount(leaves: PlannedLeaf[], tasks: Task[]): number {
  return leaves.filter((leaf) => !leaf.done).length
    + tasks.filter((task) => !task.done).length;
}

export function canDragTask(task: Task): boolean {
  return !task.done;
}

export function canRescheduleDraggedTask(tasks: Task[], taskId: string): boolean {
  return tasks.some((task) => task.id === taskId && !task.done);
}

function isPlannerDragData(value: unknown): value is PlannerDragData {
  if (typeof value !== 'object' || value == null) return false;
  const candidate = value as Partial<PlannerDragData>;
  if (candidate.kind === 'step') {
    return typeof candidate.goalId === 'string'
      && typeof candidate.nodeId === 'string'
      && typeof candidate.title === 'string';
  }
  if (candidate.kind === 'task') {
    return typeof candidate.taskId === 'string'
      && typeof candidate.title === 'string';
  }
  return false;
}
