import type { AvailabilityWindow, BusyBlock, Goal } from '../db/types';
import { capacityBefore } from './capacity';
import { fmtMinutes, type GoalEffort } from './effort';
import { isFullyBlocked } from './plan';
import { hasTrustedSchedule } from './schedule';

/**
 * Whether a goal can still be finished by its date.
 *
 * This replaces "behind pace", which compared completed percentage against
 * elapsed calendar percentage and so called a goal behind for the crime of
 * being planned to finish in the last week — the way most work actually goes.
 * Elapsed time is not a forecast. What the user needs to know is whether the
 * hours that remain can hold the work that remains, and the app already knows
 * both numbers.
 *
 * Every verdict is deterministic and explains itself. `no-forecast` is a
 * first-class answer, not a fallback: refusing to guess is more useful than a
 * confident label built on a missing deadline or unpriced work.
 */
export type Health = 'on-track' | 'tight' | 'at-risk' | 'blocked' | 'no-forecast';

export interface HealthVerdict {
  health: Health;
  /** One sentence, always — a label with no reason is a label nobody trusts. */
  reason: string;
}

export const HEALTH_WORD: Record<Health, string> = {
  'on-track': 'On track',
  tight: 'Tight',
  'at-risk': 'At risk',
  blocked: 'Blocked',
  'no-forecast': 'No forecast',
};

/**
 * The buffer below which "it fits" stops being reassuring. 15% of the work
 * remaining, per spec §8 — an estimate that is 15% optimistic is an ordinary
 * estimate, so a plan with less slack than that is one bad afternoon from
 * missing.
 */
export const TIGHT_BUFFER = 0.15;

export interface HealthInput {
  goal: Goal;
  effort: GoalEffort;
  today: string;
  /**
   * The availability model, taken whole rather than pre-summed by the caller.
   *
   * Capacity used to be a number passed in, and an empty `windows` array then
   * summed to zero free minutes — which reads as "nothing fits" and put every
   * goal of a user who had never opened working hours At risk on day one. Zero
   * capacity because the deadline is tomorrow evening is a risk; zero because
   * the app was never told when this person works is a missing model. Only the
   * function holding the windows can tell those apart, so it holds them.
   */
  windows: AvailabilityWindow[];
  blocks: BusyBlock[];
  allDayBlocks: boolean;
}

export function goalHealth({
  goal,
  effort,
  today,
  windows,
  blocks,
  allDayBlocks,
}: HealthInput): HealthVerdict {
  if (effort.total === 0) {
    return { health: 'no-forecast', reason: 'No tasks yet — break the goal into actions to forecast it' };
  }
  if (effort.done === effort.total) {
    return { health: 'on-track', reason: 'Every task is done' };
  }

  /*
   * Blocked outranks the arithmetic. A goal whose every open task is waiting on
   * something else has no actionable path, and saying "on track" because the
   * hours technically exist would be the most misleading answer available —
   * those hours cannot be spent on this.
   */
  if (isFullyBlocked(goal)) {
    return { health: 'blocked', reason: 'Every open task is blocked — nothing here can be started' };
  }

  if (!hasTrustedSchedule(goal)) {
    return {
      health: 'no-forecast',
      reason: 'No confirmed deadline — add one to see whether this fits',
    };
  }
  if (goal.deadline! < today) {
    return { health: 'at-risk', reason: `Deadline passed and ${effort.total - effort.done} tasks are still open` };
  }
  if (windows.length === 0) {
    return {
      health: 'no-forecast',
      reason: 'No working hours set — set them in Plan to forecast against real time',
    };
  }
  // Capacity is measured from the START of today, not the current minute. A
  // goal forecast is a question about days: a verdict that decayed as the
  // afternoon wore on would look like the plan rotting while you worked.
  const capacityMin = capacityBefore(goal.deadline, windows, blocks, { date: today, minute: 0 }, allDayBlocks);
  if (capacityMin === null) {
    return { health: 'no-forecast', reason: 'The deadline is too far out to forecast against' };
  }

  /*
   * Unestimated work caps the verdict at `tight`, whatever the sums say.
   * `remainingMin` is a floor while anything is unpriced, so "fits with room to
   * spare" is a claim about a number known to be incomplete. It does NOT force
   * `at-risk`: the work might be trivial, and crying risk over missing data is
   * how a forecast gets ignored.
   */
  const unpriced = effort.unestimated > 0;
  const need = effort.remainingMin;

  if (need > capacityMin) {
    return {
      health: 'at-risk',
      reason: `${fmtMinutes(need)} of work against ${fmtMinutes(capacityMin)} free before the deadline`,
    };
  }

  const buffer = capacityMin - need;
  if (unpriced) {
    return {
      health: 'tight',
      reason: `${effort.unestimated} task${effort.unestimated === 1 ? '' : 's'} still unestimated, so the ${fmtMinutes(need)} figure can only grow`,
    };
  }
  if (need > 0 && buffer < need * TIGHT_BUFFER) {
    return {
      health: 'tight',
      reason: `Only ${fmtMinutes(buffer)} spare after ${fmtMinutes(need)} of work`,
    };
  }
  return {
    health: 'on-track',
    reason: `${fmtMinutes(need)} of work fits in ${fmtMinutes(capacityMin)} free, with ${fmtMinutes(buffer)} spare`,
  };
}
