import type { BusyBlock, Confidence, Goal, GoalNode, Session, Task } from '../db/types';
import type { Now } from './capacity';
import { buildDailyWork, type DailyWorkItem } from './dailyWork';
import { nowFocus } from './todaySurface';
import { todayPlan } from './todayPlan';
import type { PlacedSpan } from './slot';
import { expectedTimeFor, sameWorkRef, type ExpectedTime, type WorkRef } from './expectedTime';
import { admits, type TimeLevel } from './timeLens';
import { admitsWork, type FocusLevel } from './focusLens';
import { demandIndex, taskDemand, type ResolvedDemand } from './demand';
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
  | 'free-time'
  /** A topic offered for review — the weakest of a subject, nearest exam first. */
  | 'review';

export interface RecommendedWork {
  key: string;
  ref: WorkRef;
  title: string;
  goalTitle?: string;
  lifeId?: string;
  reason: AdviceReason;
  expected: ExpectedTime;
  /** Absent means no claim was made, never a guess — the focus dial admits it. */
  demand?: ResolvedDemand;
  /** A topic, with its confidence when rated. The surface draws a mark, never a tick. */
  topic?: true;
  confidence?: Confidence;
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
      /**
       * The focus level in force admitted nothing, so `primary` is the
       * unfiltered head. Distinct from `beyondWindow` because the two dials
       * fail differently and the copy must say which one did: "Nothing that
       * short left" and "Nothing light left" are different sentences.
       */
      beyondFocus?: true;
    }
  | { kind: 'clear' };

export interface ExecutionAdviceInput {
  goals: Goal[];
  tasks: Task[];
  sessions: Session[];
  blocks: BusyBlock[];
  /** The sittings already on a date. See `TodayPlanInput.placedOn`. */
  placedOn: (date: string) => PlacedSpan[];
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
  /**
   * How much focus is available. ABSENT means no lens, which is what every
   * surface other than the shelf passes — a mood set in a café must not rewrite
   * the Today page you check on the train home.
   */
  focusLevel?: FocusLevel;
  /**
   * Work the user explicitly put at the head — the "do this first" insert.
   * When found in the queue it LEADS, exempt from both lenses (an explicit
   * "this first" is the strongest fact a queue can carry, stronger than the
   * scheduled-now facts the lenses already never filter), and the beyond
   * flags are suppressed: they describe an emptied queue, and this primary
   * was chosen, not defaulted to. A ref not in the queue (completed since,
   * deleted, out of horizon) is silently ignored — same fallback rule as
   * `promoteWork`. A step just created on a project past `PLANNING_HORIZONS`
   * is one such case: the pool is sourced from `backlogGroups`, which drops
   * that project's uncommitted work, so the pin is absent from the queue and
   * quietly ignored — the notice above the card may then name work the card
   * does not lead with.
   */
  pinned?: WorkRef;
}

/**
 * The most quiet alternatives shown beside the primary. Three is the cap, and
 * a cap is the point: the shelf is a card you summon to START something, not
 * the backlog. It was two until 2026-08-23 — the band kept reading as one row
 * once the running work and the focus lens had each taken a slot, and one
 * row is not a choice. The shelf's `HEIGHT` is measured against this.
 */
export const MAX_ALTERNATIVES = 3;

/**
 * How deep the advisor's free-time pool goes. `PROPOSAL_MAX` (5) is Today's
 * cap and is right there — five rows on a page. The advisor cuts its pool
 * twice more (the two lenses, then `MAX_ALTERNATIVES`), and a pool pre-cut
 * to five starves the undated tail, where every loose task sorts. Twelve is
 * headroom, not a display count: nothing renders more rows than before.
 */
export const ADVISOR_POOL_MAX = 12;

interface Candidate {
  key: string;
  ref: WorkRef;
  title: string;
  goalTitle?: string;
  lifeId?: string;
  reason: AdviceReason;
  /** Absent means no claim was made, never a guess — the focus dial admits it. */
  demand?: ResolvedDemand;
  /** A topic, with its confidence when rated. The surface draws a mark, never a tick. */
  topic?: true;
  confidence?: Confidence;
}

/**
 * Present-or-absent, never present-and-undefined: the focus dial admits an
 * untagged item at every level, so a candidate with no claim carries no field.
 */
const withDemand = (d: ResolvedDemand | undefined) => (d === undefined ? {} : { demand: d });

/** The same present-or-absent rule for a topic's two fields. */
const withTopic = (row: { topic?: true; confidence?: Confidence }) => ({
  ...(row.topic ? { topic: true as const } : {}),
  ...(row.confidence === undefined ? {} : { confidence: row.confidence }),
});

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
  demand: ResolvedDemand | undefined,
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
    ...withDemand(demand),
    ...withTopic(item),
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
function orderedCandidates(input: ExecutionAdviceInput): { pool: Candidate[] } {
  const { goals, tasks, blocks, placedOn, allDayBlocks, today, week, now } = input;

  const nodeByid = new Map<string, GoalNode>();
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const demandBy = demandIndex(goals);
  const lifeByGoal = new Map<string, string>();
  for (const g of goals) {
    if (g.lifeId !== undefined) lifeByGoal.set(g.id, g.lifeId);
    walkLeaves(g, (n) => nodeByid.set(n.id, n));
  }

  const demandFor = (item: { kind: 'step' | 'task'; id: string }): ResolvedDemand | undefined => {
    if (item.kind === 'step') return demandBy.get(item.id);
    const t = taskById.get(item.id);
    return t === undefined ? undefined : taskDemand(t);
  };

  const allowed = (item: DailyWorkItem): boolean => {
    if (item.done) return false;
    if (item.kind === 'step') {
      const node = nodeByid.get(item.id);
      const goal = item.goalId ? goalById.get(item.goalId) : undefined;
      if (!node || !goal) return false;
      if (goal.completedAt) return false;
      if (!isPlanningHorizon(goal.column)) return false;
      // The advisor answers "what now"; blocked and parked mean "not now" —
      // dropped here even when the leaf carries a `plannedWeek` for this
      // week. `backlogGroups` keeps that same row because `weekCapacity`
      // bills it: a number you plan against and a thing to do now are
      // different questions.
      const s = stepStatus(node);
      if (s === 'blocked' || s === 'parked') return false;
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
  if (focus) push(toCandidate(focus.item, reasonFor(focus.item, now.minute), lifeByGoal, demandFor(focus.item)));
  for (const item of commitments) push(toCandidate(item, reasonFor(item, now.minute), lifeByGoal, demandFor(item)));
  for (const item of carryOvers) push(toCandidate(item, 'carried-over', lifeByGoal, demandFor(item)));

  const plan = todayPlan({
    goals, tasks, blocks, placedOn, allDayBlocks, today, week, now,
    exclude: seen,
    max: ADVISOR_POOL_MAX,
  });
  if (plan.kind === 'offer') {
    for (const row of plan.rows) {
      // The offer is sourced from `backlogGroups`, which keeps a committed
      // blocked/parked step for the capacity figure billing it — the same
      // exception `allowed` above refuses. The advisor still answers "now",
      // so that row is not something to hand back as free-time work either.
      if (row.kind === 'step') {
        const node = nodeByid.get(row.id);
        const s = node ? stepStatus(node) : undefined;
        if (s === 'blocked' || s === 'parked') continue;
      }
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
        ...withDemand(demandFor(row)),
        ...withTopic(row),
        // A topic is not idle-time filler; it is the subject's weakest point,
        // and the surface names it as such.
        reason: row.topic ? 'review' : 'free-time',
      });
    }
  }

  return { pool };
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
  const { pool } = orderedCandidates(input);
  if (pool.length === 0) return { kind: 'clear' };

  // Evidence is attached to the whole pool because membership depends on it.
  // Both callers memoize this, so the cost is per-change and not per-frame.
  const queue = pool.map((c) => withExpected(c, input));

  const timeLevel = input.timeLevel;
  const inWindow = timeLevel === undefined
    ? queue
    : queue.filter((w) => admits(timeLevel, w.reason, w.expected));

  const focusLevel = input.focusLevel;
  const admitted = focusLevel === undefined
    ? inWindow
    : inWindow.filter((w) => admitsWork(focusLevel, w.reason, w.demand));

  const pinnedWork = input.pinned === undefined
    ? undefined
    : queue.find((w) => sameWorkRef(w.ref, input.pinned!));

  // Attribute the emptiness to the dial that caused it — unless the user
  // pinned the head themselves, in which case nothing was defaulted to.
  // Time is checked first because it is the harder constraint — a gap is a
  // fact about the day, and a shelf that blamed focus for a queue the clock
  // had already emptied would send you to the wrong dial.
  const beyondWindow = pinnedWork === undefined && inWindow.length === 0;
  const beyondFocus = pinnedWork === undefined && !beyondWindow && admitted.length === 0;
  const visible = admitted.length === 0 ? queue.slice(0, 1) : admitted;

  let primary: RecommendedWork;
  let rest: RecommendedWork[];
  if (pinnedWork !== undefined) {
    primary = pinnedWork;
    rest = admitted.filter((w) => !sameWorkRef(w.ref, pinnedWork.ref));
  } else {
    [primary, ...rest] = visible;
  }
  const alternatives: RecommendedWork[] = rest.slice(0, MAX_ALTERNATIVES);
  if (rest.length > MAX_ALTERNATIVES) {
    const last = MAX_ALTERNATIVES - 1;
    const overflow = rest.slice(MAX_ALTERNATIVES);
    /*
     * The LAST alternative slot may be swapped, and two rules compete for it.
     * The loose-task rule wins: a whole bucket absent beats a life
     * under-represented — and a loose task carries no lifeId, so the two
     * rules cannot both be satisfied by one row anyway. Like the life swap:
     * the primary and the earlier alternatives never move, and no claim is
     * made in copy.
     */
    const isLoose = (w: RecommendedWork): boolean =>
      w.ref.kind === 'task' && w.ref.goalId === null;
    const looseVisible = [primary, ...alternatives].some(isLoose);
    const loose = looseVisible ? undefined : overflow.find(isLoose);
    if (loose && alternatives[last]) {
      alternatives[last] = loose;
    } else {
      /*
       * The life-diversity swap, unchanged: the first later candidate from a
       * life the primary and the earlier alternatives do not already cover.
       */
      const covered = new Set([primary.lifeId, ...alternatives.slice(0, last).map((a) => a.lifeId)]);
      const other = overflow.find(
        (c) => c.lifeId !== undefined && !covered.has(c.lifeId),
      );
      if (other && alternatives[last] && covered.has(alternatives[last].lifeId)) {
        alternatives[last] = other;
      }
    }
  }

  return {
    kind: 'work',
    primary,
    alternatives,
    ...(beyondWindow ? { beyondWindow: true as const } : {}),
    ...(beyondFocus ? { beyondFocus: true as const } : {}),
  };
}
