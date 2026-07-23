import type { Goal } from '../db/types';

export type GoalWithSpan = Goal & { start: string; deadline: string };
export type TrustedGoalSchedule = GoalWithSpan & { datesConfirmed: true };

export function hasGoalSpan(goal: Goal): goal is GoalWithSpan {
  return typeof goal.start === 'string' && typeof goal.deadline === 'string';
}

export function needsDateConfirmation(goal: Goal): boolean {
  return goal.datesConfirmed !== true && Boolean(goal.start || goal.deadline);
}

export function hasTrustedSchedule(goal: Goal): goal is TrustedGoalSchedule {
  return goal.datesConfirmed === true && hasGoalSpan(goal);
}

export function projectDateError(start?: string, deadline?: string): string | null {
  if (start && deadline && start > deadline) return 'Start must be on or before the deadline.';
  return null;
}
