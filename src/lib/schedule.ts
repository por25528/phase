import type { Goal } from '../db/types';

export type GoalWithSpan = Goal & { start: string; deadline: string };
export type TrustedGoalSchedule = GoalWithSpan & { datesConfirmed: true };

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function hasGoalSpan(goal: Goal): goal is GoalWithSpan {
  return typeof goal.start === 'string'
    && LOCAL_DATE.test(goal.start)
    && typeof goal.deadline === 'string'
    && LOCAL_DATE.test(goal.deadline);
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
