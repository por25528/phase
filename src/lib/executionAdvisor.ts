import type { AvailabilityWindow, BusyBlock, Goal, GoalNode, Session, Task } from '../db/types';
import type { Now } from './capacity';
import { buildDailyWork, type DailyWorkItem } from './dailyWork';
import { nowFocus } from './todaySurface';
import { todayPlan } from './todayPlan';
import { expectedTimeFor, type ExpectedTime, type WorkRef } from './expectedTime';
import { admits, type TimeLevel } from './timeLens';
import { isPlanningHorizon } from './horizons';
import { walkLeaves } from './plan';
import { stepStatus } from './status';

/**
 * The one answer to "what should I do now", projected from the ordering Phase
 * already trusts.
 *
 * This module deliberately contains no ranking of its own. `buildDailyWork`
 * decides what today's commitments are, `nowFocus` decides which of them leads,
 * and `todayPlan` decides what an unbooked day offers — all it does is walk
 * those answers in their existing order and put reason codes on them. A second
 * weighted priority score would be a second opinion about the same day, and two
 * opinions is how the assistant and the Today page start disagreeing.
 *
 * Expected-time evidence is attached AFTER ordering, so what the student's
 * history says about a task's length can inform the label but never the queue.
 */

export type AdviceReason =
  | 'scheduled-now'
  | 'scheduled-next'
  | 'due'
  | 'committed-today'
  | 'committed-week'
  | 'carried-over'
  | 'free-time';

export interface RecommendedWork {
  key: string;
  ref: WorkRef;
  title: string;
  goalTitle?: string;
  lifeId?: string;
  reason: AdviceReason;
  expected: ExpectedTime;
}

export type ExecutionAdvice =
  | {
      kind: 'work';
      primary: RecommendedWork;
      alternatives: RecommendedWork[];
      /**
       * The window in force admitted nothing, so `primary` is the unfiltered
       * head of the queue. The surface says so out loud — "Nothing that short
       * left" is a different sentence from "nothing needs you", and re-sorting
       * to find something shorter would be the second opinion this module
       * refuses.
       */
      beyondWindow?: true;
    }
  /** Availability was never set — the same distinct verdict `todayPlan` keeps. */
  | { kind: 'needs-hours' }
  | { kind: 'clear' };

export interface ExecutionAdviceInput {
  goals: Goal[];
  tasks: Task[];
  sessions: Session[];
  availability: AvailabilityWindow[];
  blocks: BusyBlock[];
  allDayBlocks: boolean;
  today: string; // 'YYYY-MM-DD'
  week: string;  // Monday of the current week
  now: Now;
  /**
   * How long the user says they have. ABSENT means no lens at all, which is
   * what every surface other than the shelf passes: a gap declared in a café
   * must not rewrite the Today page you check on the train home — the same
   * boundary the life switcher holds when the board scopes and the week does
   * not.
   */
  timeLevel?: TimeLevel;
}

/** The most quiet alternatives shown beside the primary. Two is the cap, and the point. */
export const MAX_ALTERNATIVES = 2;

interface Candidate {
  key: string;
  ref: WorkRef;
  title: string;
  goalTitle?: string;
  lifeId?: string;
  reason: AdviceReason;
}

function reasonFor(item: DailyWorkItem, nowMinute: number): AdviceReason {
  if (item.startMin !== undefined) {
    // The same arithmetic `nowFocus` uses to say "now" versus "next".
    const end = item.startMin + (item.estimateMin ?? 60);
    return item.startMin <= nowMinute && nowMinute < end ? 'scheduled-now' : 'scheduled-next';
  }
  switch (item.source) {
    case 'due': return 'due';
    case 'this-week': return 'committed-week';
    case 'carry-over': return 'carried-over';
    default: return 'committed-today';
  }
}

function toCandidate(
  item: DailyWorkItem,
  reason: AdviceReason,
  lifeByGoal: Map<string, string>,
): Candidate {
  const ref: WorkRef = item.kind === 'step'
    ? { kind: 'step', id: item.id, goalId: item.goalId ?? '' }
    : { kind: 'task', id: item.id, goalId: item.goalId };
  const lifeId = item.goalId ? lifeByGoal.get(item.goalId) : undefined;
  return {
    key: item.key,
    ref,
    title: item.title,
    ...(item.goalTitle === undefined ? {} : { goalTitle: item.goalTitle }),
    ...(lifeId === undefined ? {} : { lifeId }),
    reason,
  };
}

/**
 * Every candidate the advisor may name, in canonical order: today's
 * commitments as `buildDailyWork` ordered them, then slipped work, then the
 * free-time offer with everything already shown excluded. Blocked leaves are
 * dropped the way the tree's own queue drops them, and archived or parked
 * projects contribute nothing — `attentionItems`' quiet-project rule, applied
 * to a surface that speaks first.
 */
function orderedCandidates(input: ExecutionAdviceInput): { pool: Candidate[]; noHours: boolean } {
  const { goals, tasks, availability, blocks, allDayBlocks, today, week, now } = input;

  const nodeByid = new Map<string, GoalNode>();
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const lifeByGoal = new Map<string, string>();
  for (const g of goals) {
    if (g.lifeId !== undefined) lifeByGoal.set(g.id, g.lifeId);
    walkLeaves(g, (n) => nodeByid.set(n.id, n));
  }

  const allowed = (item: DailyWorkItem): boolean => {
    if (item.done) return false;
    if (item.kind === 'step') {
      const node = nodeByid.get(item.id);
      const goal = item.goalId ? goalById.get(item.goalId) : undefined;
      if (!node || !goal) return false;
      if (goal.completedAt) return false;
      if (!isPlanningHorizon(goal.column)) return false;
      if (stepStatus(node) === 'blocked') return false;
    }
    return true;
  };

  const sections = buildDailyWork(goals, tasks, today);
  const commitments = sections.commitments.filter(allowed);
  const carryOvers = sections.carryOvers.filter(allowed);

  const pool: Candidate[] = [];
  const seen = new Set<string>();
  const push = (c: Candidate): void => {
    if (seen.has(c.key)) return;
    seen.add(c.key);
    pool.push(c);
  };

  // `nowFocus` decides which commitment leads; the rest keep their order.
  const focus = nowFocus(commitments, now.minute);
  if (focus) push(toCandidate(focus.item, reasonFor(focus.item, now.minute), lifeByGoal));
  for (const item of commitments) push(toCandidate(item, reasonFor(item, now.minute), lifeByGoal));
  for (const item of carryOvers) push(toCandidate(item, 'carried-over', lifeByGoal));

  const plan = todayPlan({
    goals, tasks, availability, blocks, allDayBlocks, today, week, now,
    exclude: seen,
  });
  if (plan.kind === 'offer') {
    for (const row of plan.rows) {
      const ref: WorkRef = row.kind === 'step'
        ? { kind: 'step', id: row.id, goalId: row.goalId ?? '' }
        : { kind: 'task', id: row.id, goalId: row.goalId ?? null };
      const lifeId = row.goalId ? lifeByGoal.get(row.goalId) : undefined;
      push({
        key: row.key,
        ref,
        title: row.title,
        ...(row.goalTitle === '' ? {} : { goalTitle: row.goalTitle }),
        ...(lifeId === undefined ? {} : { lifeId }),
        reason: 'free-time',
      });
    }
  }

  return { pool, noHours: plan.kind === 'no-hours' };
}

function withExpected(c: Candidate, input: ExecutionAdviceInput): RecommendedWork {
  return {
    ...c,
    expected: expectedTimeFor(c.ref, {
      goals: input.goals,
      tasks: input.tasks,
      sessions: input.sessions,
    }),
  };
}

export function executionAdvice(input: ExecutionAdviceInput): ExecutionAdvice {
  const { pool, noHours } = orderedCandidates(input);
  if (pool.length === 0) return noHours ? { kind: 'needs-hours' } : { kind: 'clear' };

  // Evidence is attached to the whole pool because membership depends on it.
  // Both callers memoize this, so the cost is per-change and not per-frame.
  const queue = pool.map((c) => withExpected(c, input));
  const level = input.timeLevel;
  const admitted = level === undefined
    ? queue
    : queue.filter((w) => admits(level, w.reason, w.expected));

  // An emptied lens offers the real head, flagged — never a re-sort.
  const beyondWindow = admitted.length === 0;
  const visible = beyondWindow ? queue.slice(0, 1) : admitted;

  const [primary, ...rest] = visible;
  const alternatives: RecommendedWork[] = rest.slice(0, MAX_ALTERNATIVES);
  if (rest.length > MAX_ALTERNATIVES) {
    /*
     * Alternative two may diversify by life: the first LATER candidate from a
     * life the primary and first alternative do not already cover. It swaps in
     * quietly — the primary and alternative one never move, and no
     * "under-served" claim is made.
     */
    const covered = new Set([primary.lifeId, alternatives[0]?.lifeId]);
    const other = rest.slice(MAX_ALTERNATIVES).find(
      (c) => c.lifeId !== undefined && !covered.has(c.lifeId),
    );
    if (other && alternatives[1] && covered.has(alternatives[1].lifeId)) {
      alternatives[1] = other;
    }
  }

  return {
    kind: 'work',
    primary,
    alternatives,
    ...(beyondWindow ? { beyondWindow: true as const } : {}),
  };
}
