import type { Goal } from '../db/types';

export type GoalWithSpan = Goal & { start: string; deadline: string };
export type TrustedGoalSchedule = GoalWithSpan & { datesConfirmed: true };

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !LOCAL_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function hasGoalSpan(goal: Goal): goal is GoalWithSpan {
  return isValidLocalDate(goal.start)
    && isValidLocalDate(goal.deadline)
    && goal.start <= goal.deadline;
}

export function needsDateConfirmation(goal: Goal): boolean {
  return goal.datesConfirmed !== true && Boolean(goal.start || goal.deadline);
}

export function hasTrustedSchedule(goal: Goal): goal is TrustedGoalSchedule {
  return goal.datesConfirmed === true && hasGoalSpan(goal);
}

export function goalDateDraftIsDirty(
  goal: Pick<Goal, 'start' | 'deadline'>,
  draftStart: string,
  draftDeadline: string,
): boolean {
  return draftStart !== (goal.start ?? '') || draftDeadline !== (goal.deadline ?? '');
}

// Active projects whose unconfirmed dates are internally valid — the set a single
// "Confirm all" pass can safely stamp. A project whose start is after its deadline
// is left out so it still surfaces for manual review. Mirrors the per-project guard
// in confirmGoalDates, so the bulk action can never confirm what a single click won't.
export function confirmableDateGoalIds(goals: Goal[]): string[] {
  return goals
    .filter((g) => (
      !g.completedAt
      && needsDateConfirmation(g)
      && projectDateError(g.start, g.deadline) === null
    ))
    .map((g) => g.id);
}

export function projectDateError(start?: unknown, deadline?: unknown): string | null {
  if (start !== undefined && !isValidLocalDate(start)) return 'Start must be a valid date.';
  if (deadline !== undefined && !isValidLocalDate(deadline)) return 'Deadline must be a valid date.';
  if (start !== undefined && deadline !== undefined && start > deadline) {
    return 'Start must be on or before the deadline.';
  }
  return null;
}
