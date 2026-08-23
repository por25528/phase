import type { Goal, GoalNode, PlanReview, PlanReviewEntry, Session, WorkBlock } from '../db/types';
import { blocksOf, isPlaced, sortedBlocks } from './blocks';
import { weekDates, addDays } from './dates';
import { behindPaceHint, behindPaceLabel } from './pace';
import { goalPct } from './pct';
import { expectedPct, behindPaceBy, daysBetween } from './timeline';
import { leafCount } from './board';
import { isPlanningHorizon } from './horizons';
import { findInAll } from './tree';
import { hasTrustedSchedule, needsDateConfirmation, isValidLocalDate } from './schedule';
import { checkpointWithin, CHECKPOINT_SOON_DAYS, nextCheckpoint } from './checkpoints';
import { isDone, stepStatus } from './status';

// One shared threshold so cards, the insight bar, and the planner never
// disagree about what "behind" means.
export const PACE_THRESHOLD_PTS = 10;

export function weekOf(date: string): string {
  return weekDates(date)[0];
}

export type PlanOpeningStep = 'recap' | 'plan';

export function planOpeningStep(review: PlanReview | null): PlanOpeningStep {
  return review && review.entries.length > 0 && !review.reviewed ? 'recap' : 'plan';
}

export interface PlannedLeaf {
  goalId: string;
  goalTitle: string;
  nodeId: string;
  title: string;
  done: boolean;
  plannedWeek: string;
  /**
   * The leaf's sittings, carried whole.
   *
   * This used to be a `plannedDay` and a `plannedStartMin` — one placement — so
   * a leaf could be billed to exactly one day. `weekCapacity` bills each block
   * to ITS day now, which is the arithmetic multi-sitting work always needed:
   * two hours on Tuesday and two on Thursday is not four hours on Tuesday.
   *
   * `status` is still deliberately absent. Blocked-but-scheduled work is booked
   * time, and dropping status at this projection boundary is what guarantees
   * capacity cannot start disagreeing with the calendar about it.
   */
  blocks: readonly WorkBlock[];
  estimateMin?: number;
}

export function walkLeaves(g: Goal, visit: (n: GoalNode) => void): void {
  function walk(nodes: GoalNode[]): void {
    for (const n of nodes) {
      if (n.children && n.children.length) walk(n.children);
      else visit(n);
    }
  }
  walk(g.nodes);
}

/**
 * `children: []` counts as a LEAF — matching `walkLeaves` directly above, and
 * `leafCount`, `nodePct` and `firstOpenLeaf` elsewhere.
 *
 * The bare `!n.children` test made this the lone dissenter: an empty array is
 * truthy, so a node whose last child had been deleted (`removeNode` splices and
 * leaves `[]` behind) recursed into nothing and reported the project as having
 * no leaves at all. The card then rendered "Next · Pset 1" and a "Needs a first
 * step" badge simultaneously, over a step plainly listed below it, and the
 * Focus summary counted the project under "needs a first step".
 */
function hasLeaf(nodes: GoalNode[]): boolean {
  for (const n of nodes) {
    if (!n.children || n.children.length === 0) return true;
    if (hasLeaf(n.children)) return true;
  }
  return false;
}

function asPlanned(g: Goal, n: GoalNode): PlannedLeaf {
  return {
    goalId: g.id, goalTitle: g.title, nodeId: n.id, title: n.title,
    done: isDone(n), plannedWeek: n.plannedWeek!, blocks: sortedBlocks(n),
    estimateMin: n.estimateMin,
  };
}

// Active (non-archived) projects. Completed projects are excluded from every
// planning selector below, so a finished project never surfaces a no-op control
// in Today or the planner (spec §2.5).
export function activeGoals(goals: Goal[]): Goal[] {
  return goals.filter((g) => !g.completedAt);
}

// All leaves planned for `week` (done and not), day-pinned first in day order.
/**
 * The leaves that belong to `week`: committed to it, OR placed in it.
 *
 * The second half is new and is what multi-sitting work requires. A leaf
 * committed to last week whose remaining sitting sits on this Wednesday IS this
 * week's work — it is drawn on this grid, and a capacity figure that ignored it
 * would be smaller than the calendar beside it.
 */
export function plannedLeaves(goals: Goal[], week: string): PlannedLeaf[] {
  const out: PlannedLeaf[] = [];
  const dates = new Set(weekDates(week));
  for (const g of goals) {
    if (g.completedAt) continue;
    walkLeaves(g, (n) => {
      if (n.plannedWeek === week || blocksOf(n).some((b) => dates.has(b.date))) {
        out.push(asPlanned(g, n));
      }
    });
  }
  return out.sort((a, b) => (a.blocks[0]?.date ?? '9999').localeCompare(b.blocks[0]?.date ?? '9999'));
}

export interface PlannedGoalGroup {
  goalId: string;
  goalTitle: string;
  leaves: PlannedLeaf[];
}

// Group a day's planned leaves by their project, preserving first-seen order, so
// a day column can stack steps under a per-project heading rather than blurring
// several projects together (planner grouping).
export function groupPlannedByGoal(leaves: PlannedLeaf[]): PlannedGoalGroup[] {
  const order: string[] = [];
  const map = new Map<string, PlannedGoalGroup>();
  for (const l of leaves) {
    let grp = map.get(l.goalId);
    if (!grp) {
      grp = { goalId: l.goalId, goalTitle: l.goalTitle, leaves: [] };
      map.set(l.goalId, grp);
      order.push(l.goalId);
    }
    grp.leaves.push(l);
  }
  return order.map((id) => map.get(id)!);
}

// Open leaves available to plan for `week` — the week planner's left rail (T9).
// Under the calendar-grid model, a leaf is genuinely placed only once it has
// ALL of `plannedWeek === week`, a `plannedDay`, AND a `plannedStartMin` (see
// scheduledOn). Anything else is backlog: a leaf planned for a different week
// (a carry-over) still counts as available, and — the case the old predicate
// got wrong — a leaf already committed to this week but missing a day or a
// start minute is backlog too, not invisible.
export function unplannedOpenLeaves(g: Goal, week: string): GoalNode[] {
  const out: GoalNode[] = [];
  walkLeaves(g, (n) => {
    if (!isDone(n) && (n.plannedWeek !== week || !isPlaced(n))) out.push(n);
  });
  return out;
}

export interface RailTreeNode {
  id: string;
  title: string;
  isLeaf: boolean;
  children: RailTreeNode[];
}

// The planner rail's display tree for a project: the same backlog leaves as
// `unplannedOpenLeaves` (whose flat count powers the section header) — open and
// not genuinely placed on the grid in `week` — but with their container
// ancestors kept as sub-headings so subgoals show in context. A leaf committed
// to this week but missing a day or a start minute still belongs here; only a
// leaf with `plannedWeek === week` AND a `plannedDay` AND a `plannedStartMin`
// is actually on the grid and drops out. A container with no visible
// descendant is dropped, so an all-done or fully-placed branch never leaves an
// empty heading behind.
export function railTree(g: Goal, week: string): RailTreeNode[] {
  function build(nodes: GoalNode[]): RailTreeNode[] {
    const out: RailTreeNode[] = [];
    for (const n of nodes) {
      if (n.children && n.children.length) {
        const children = build(n.children);
        if (children.length > 0) out.push({ id: n.id, title: n.title, isLeaf: false, children });
      } else if (!isDone(n) && (n.plannedWeek !== week || !isPlaced(n))) {
        out.push({ id: n.id, title: n.title, isLeaf: true, children: [] });
      }
    }
    return out;
  }
  return build(g.nodes);
}

export type PaceState = 'behind' | 'quiet-ahead' | 'on-pace' | 'no-schedule' | 'needs-breakdown' | 'complete';

// Schedule pace is an ATTENTION signal, not a performance score: pct averages
// unweighted nodes, so treat the verdict as "worth a look", never "the truth".
export function paceStatus(g: Goal, today: string): PaceState {
  if (!hasLeaf(g.nodes)) return 'needs-breakdown';
  const leaves = leafCount(g.nodes);
  if (leaves.total === 0) return 'needs-breakdown';
  if (leaves.done === leaves.total) return 'complete';
  if (!hasTrustedSchedule(g)) return 'no-schedule';
  // Round pct first, then the diff — mirrors the card badge derivation exactly.
  const pct = Math.round(goalPct(g));
  const diff = Math.round(expectedPct(g.start, g.deadline, today) - pct);
  if (diff >= PACE_THRESHOLD_PTS) return 'behind';
  if (-diff >= PACE_THRESHOLD_PTS) return 'quiet-ahead';
  return 'on-pace';
}

// ── Shared date predicates ────────────────────────────────────────────────────
// One source of truth for the thresholds the board and the Timeline roadmap both
// lean on, so a card badge and a roadmap warning can never drift apart.
export const DUE_SOON_DAYS = 14;

export function deadlineBefore(date: string, today: string): boolean {
  return date < today;
}

function hasOpenLeaf(g: Goal): boolean {
  let open = false;
  walkLeaves(g, (n) => { if (!isDone(n)) open = true; });
  return open;
}

/**
 * Open work exists, but none of it can be worked — every open leaf is
 * 'blocked'. A project with zero open leaves (all done) is NOT fully
 * blocked, and a project with one blocked leaf beside one workable one isn't
 * either: `cardPrimaryAction` withholds "Plan next step" for this ONLY.
 */
export function isFullyBlocked(g: Goal): boolean {
  let open = 0;
  let blocked = 0;
  walkLeaves(g, (n) => {
    const s = stepStatus(n);
    if (s === 'done') return;
    open++;
    if (s === 'blocked') blocked++;
  });
  return open > 0 && open === blocked;
}

function hasPlannedOpenLeafThisWeek(g: Goal, today: string): boolean {
  const week = weekOf(today);
  let planned = false;
  walkLeaves(g, (n) => { if (!isDone(n) && n.plannedWeek === week) planned = true; });
  return planned;
}

function hasOverdueLeaf(g: Goal, today: string): boolean {
  let overdue = false;
  walkLeaves(g, (n) => { if (!isDone(n) && n.deadline && deadlineBefore(n.deadline, today)) overdue = true; });
  return overdue;
}

// An open leaf exists, but nothing unfinished is planned for this week — the
// shared condition behind `not-planned` and (given open leaves) `checkpoint-soon`.
export function hasUnplannedOpenLeafThisWeek(g: Goal, today: string): boolean {
  return hasOpenLeaf(g) && !hasPlannedOpenLeafThisWeek(g, today);
}

// ── Project attention ─────────────────────────────────────────────────────────
// The single project-level authority (spec §2.4), layered over paceStatus.
export type ProjectAttention =
  | 'completed'
  | 'ready-to-complete'
  | 'overdue'
  | 'needs-breakdown'
  | 'behind'
  | 'due-soon'
  | 'checkpoint-soon'
  | 'not-planned'
  | 'on-track';

// States 3–7 (precedence order). `not-planned` is Now-only; the others apply to
// any committed horizon — the caller has already screened out Later/Someday.
function activeWorkState(g: Goal, today: string, pace: PaceState, col: number): ProjectAttention {
  if (pace === 'needs-breakdown') return 'needs-breakdown';
  if (pace === 'behind') return 'behind';
  if (g.datesConfirmed === true && g.deadline && g.deadline <= addDays(today, DUE_SOON_DAYS)) return 'due-soon';
  if (checkpointWithin(g, CHECKPOINT_SOON_DAYS, today) && !hasPlannedOpenLeafThisWeek(g, today)) return 'checkpoint-soon';
  if (col === 0 && hasUnplannedOpenLeafThisWeek(g, today)) return 'not-planned';
  return 'on-track';
}

export function projectAttention(g: Goal, today: string): ProjectAttention {
  if (g.completedAt) return 'completed';
  const pace = paceStatus(g, today);
  if (pace === 'complete') return 'ready-to-complete';
  if ((g.datesConfirmed === true && g.deadline && deadlineBefore(g.deadline, today)) || hasOverdueLeaf(g, today)) return 'overdue';
  // Horizon gating: active-work signals surface only on Now (0) and Next (1);
  // Later/Someday stay quiet. Same boundary the calendar rail draws from —
  // `PLANNING_HORIZONS` is the one definition, so a project cannot be quiet
  // here and loud there.
  const col = g.column ?? 0;
  if (!isPlanningHorizon(col)) return 'on-track';
  return activeWorkState(g, today, pace, col);
}

// Planner sort: projects ordered by projectAttention precedence (the single
// authority), board order breaking ties. Completed and ready-to-complete
// projects are dropped — nothing to plan.
const ATTENTION_ORDER: ProjectAttention[] = [
  'overdue', 'needs-breakdown', 'behind', 'due-soon', 'checkpoint-soon', 'not-planned', 'on-track',
];
const ATTENTION_RANK = Object.fromEntries(
  ATTENTION_ORDER.map((s, i) => [s, i]),
) as Record<ProjectAttention, number>;

export function attentionRank(goals: Goal[], today: string): Goal[] {
  return goals
    .map((g, i) => ({ g, a: projectAttention(g, today), i }))
    .filter((x) => x.a !== 'completed' && x.a !== 'ready-to-complete')
    .sort((a, b) => (ATTENTION_RANK[a.a] - ATTENTION_RANK[b.a]) || (a.i - b.i))
    .map((x) => x.g);
}

// ── Focus summary ─────────────────────────────────────────────────────────────
// The board's four signals (spec §2.3). Each carries its match set so the view
// can emphasise the right cards without re-deriving any attention predicate.
export const NOW_WIP_LIMIT = 3;

export interface FocusSummary {
  slots: { used: number; limit: number; goalIds: string[] };
  needsFirstStep: { count: number; goalIds: string[] };
  behind: { count: number; goalIds: string[] };
  plannedRemaining: { count: number; goalIds: string[] };
  blocked: { count: number; goalIds: string[] };
}

export function focusSummary(goals: Goal[], today: string, limit: number = NOW_WIP_LIMIT): FocusSummary {
  const active = activeGoals(goals);
  const week = weekOf(today);

  const slots = active.filter((g) => (g.column ?? 0) === 0).map((g) => g.id);
  const needsFirstStep = active
    .filter((g) => (g.column ?? 0) === 0 && projectAttention(g, today) === 'needs-breakdown')
    .map((g) => g.id);
  const behind = active
    .filter((g) => projectAttention(g, today) === 'behind')
    .map((g) => g.id);
  // Horizon-gated like every neighbouring signal: a parked project's blocked
  // steps are dropped from the rail (backlog.ts) and its card withholds
  // 'unblock' (cardPrimaryAction), so the Focus bar must not be the one place
  // left loud about it.
  const blocked = active
    .filter((g) => isPlanningHorizon(g.column ?? 0) && isFullyBlocked(g))
    .map((g) => g.id);

  // Open leaves planned for this week, and which projects still own one.
  let plannedCount = 0;
  const plannedIds: string[] = [];
  for (const g of active) {
    let has = false;
    walkLeaves(g, (n) => { if (!isDone(n) && n.plannedWeek === week) { plannedCount++; has = true; } });
    if (has) plannedIds.push(g.id);
  }

  return {
    slots: { used: slots.length, limit, goalIds: slots },
    needsFirstStep: { count: needsFirstStep.length, goalIds: needsFirstStep },
    behind: { count: behind.length, goalIds: behind },
    plannedRemaining: { count: plannedCount, goalIds: plannedIds },
    blocked: { count: blocked.length, goalIds: blocked },
  };
}

// ── Card derivations ──────────────────────────────────────────────────────────
// Pure view-model for a board card (spec §2.4). The component maps these to JSX;
// all the date/leaf reasoning lives here so a card can never disagree with the
// attention authority.

export interface MeaningfulDate {
  date: string;
  kind: 'deadline' | 'checkpoint';
  past: boolean;
}

// The one date a card leads with: for trusted schedules, the soonest upcoming
// checkpoint before the deadline or the deadline itself. Unconfirmed schedules
// may surface an upcoming checkpoint, but never their legacy project deadline.
export function nearestMeaningfulDate(g: Goal, today: string): MeaningfulDate | null {
  const confirmedDeadline = g.datesConfirmed === true ? g.deadline : undefined;
  const upcoming = nextCheckpoint(g, today);
  if (upcoming && (!confirmedDeadline || upcoming.date < confirmedDeadline)) {
    return { date: upcoming.date, kind: 'checkpoint', past: false };
  }
  if (confirmedDeadline) {
    return { date: confirmedDeadline, kind: 'deadline', past: deadlineBefore(confirmedDeadline, today) };
  }
  return null;
}

export interface NextAction {
  kind: 'planned' | 'open' | 'needs-breakdown' | 'complete';
  title: string;
  /**
   * The leaf this names, when it names one. Absent for the three sentences
   * that describe a STATE rather than a task — no tasks yet, all complete,
   * everything blocked — which is what lets a caller show the line only when
   * there is something to point at.
   */
  nodeId?: string;
}

// The single "what's next" line: a leaf already planned for this week wins, then
// the first workable leaf (a 'doing' one preferred over 'todo'), then the
// breakdown/complete prompts. Preference order mirrors how the planner surfaces
// work. Both functions exclude blocked leaves, so neither will name one, but
// their preferences diverge: `nextOpenAction` additionally prefers a leaf
// committed to this week, while `firstOpenLeaf` stays doing-then-todo in tree
// order.
export function nextOpenAction(g: Goal, today: string): NextAction {
  const leaves = leafCount(g.nodes);
  if (leaves.total === 0) return { kind: 'needs-breakdown', title: 'No tasks yet — break the goal into actions' };
  if (leaves.done === leaves.total) return { kind: 'complete', title: 'All tasks complete' };
  const week = weekOf(today);
  const doing: GoalNode[] = [];
  const todo: GoalNode[] = [];
  walkLeaves(g, (n) => {
    const status = stepStatus(n);
    if (status === 'doing') doing.push(n);
    else if (status === 'todo') todo.push(n);
  });
  const workable = [...doing, ...todo];
  if (isFullyBlocked(g)) {
    // Open work exists (checked above) but every leaf is blocked. Naming one
    // would contradict `firstOpenLeaf`, which refuses on principle; "needs
    // breakdown" would lie (steps already exist) and "complete" would lie
    // worse. 'open' is the least dishonest kind left — the real "unblock this"
    // verdict is a later task's job, not this one's to invent.
    return { kind: 'open', title: 'All open tasks are blocked' };
  }
  if (workable.length === 0) {
    // Open work exists and is not all blocked, yet nothing is doing/todo —
    // so something is parked. Same 'open' verdict as above, one word longer:
    // "unblock" is not the instruction when the thing set aside was set aside
    // on purpose.
    return { kind: 'open', title: 'All open tasks are blocked or parked' };
  }
  const planned = workable.find((n) => n.plannedWeek === week);
  const pick = planned ?? doing[0] ?? todo[0];
  return { kind: planned ? 'planned' : 'open', title: pick.title, nodeId: pick.id };
}

export interface AttentionBadge {
  label: string;
  tone: 'warn' | 'warn-strong' | 'accent' | 'plan' | 'step';
  /** Tooltip spelling out the arithmetic, where the label has any. */
  hint?: string;
}

// The single badge a card shows, straight off projectAttention. `on-track`
// (and the terminal states, which never render as board cards) carry no badge.
export function attentionBadge(g: Goal, today: string): AttentionBadge | null {
  const attention = projectAttention(g, today);
  if (attention === 'completed') return null;
  if (attention === 'ready-to-complete') return { label: 'Ready to complete', tone: 'accent' };
  if (attention === 'overdue') return { label: 'Overdue', tone: 'warn-strong' };
  if (needsDateConfirmation(g)) return { label: 'Dates unconfirmed', tone: 'step' };

  switch (attention) {
    case 'needs-breakdown':
      return { label: 'Needs a first task', tone: 'step' };
    case 'behind': {
      if (!hasTrustedSchedule(g)) return null;
      const done = Math.round(goalPct(g));
      const pts = Math.round(behindPaceBy(done, g.start, g.deadline, today));
      // "Behind 44%" read as "44% behind schedule"; the number is percentage
      // POINTS below the linear-pace expectation. Same wording as BehindChip,
      // which the Timeline already uses.
      return {
        label: behindPaceLabel(pts),
        tone: 'warn',
        hint: behindPaceHint(done, done + pts),
      };
    }
    case 'due-soon':
      if (!g.deadline) return null;
      return { label: `Due in ${daysBetween(today, g.deadline)}d`, tone: 'warn' };
    case 'checkpoint-soon': {
      const soon = nextCheckpoint(g, today);
      if (!soon) return null; // unreachable given the state, but keep total
      return { label: `Checkpoint in ${daysBetween(today, soon.date)}d`, tone: 'warn' };
    }
    case 'not-planned':
      return { label: 'Not planned this week', tone: 'plan' };
    default:
      return null; // on-track, completed
  }
}

export type CardActionKind = 'plan' | 'define' | 'complete' | 'unblock' | 'none';

// The card's primary verb follows the verdict: break it down, complete it, or
// plan the next step.
//
// "Plan next step" is offered only where the calendar can actually receive the
// work — the Now and Next horizons the rail draws from. This read `>= 3`
// (Someday alone) back when the rail listed every horizon; both moved to 2
// together. A deferred project's untouched steps are not in the rail, so
// `planNextStepFor` finds no target, falls through to its "nothing left to
// plan" branch and lands you on a calendar with nothing highlighted — a button
// whose only effect is a view change, which reads as "already planned".
export function cardPrimaryAction(g: Goal, today: string): CardActionKind {
  switch (projectAttention(g, today)) {
    case 'needs-breakdown': return 'define';
    case 'ready-to-complete': return 'complete';
    case 'completed': return 'none';
    default:
      if (!isPlanningHorizon(g.column)) return 'none';
      // Withheld for a stated reason, exactly as a parked project withholds it.
      return isFullyBlocked(g) ? 'unblock' : 'plan';
  }
}

export interface WeekRecapResult {
  planned: number;
  nowComplete: PlanReviewEntry[];
  unfinished: PlanReviewEntry[];
  removed: PlanReviewEntry[];
}

// Join the immutable snapshot against live nodes. Completion is computed NOW
// ("4 of last week's 6 commitments are now complete") — there is no completedAt.
export function weekRecap(review: PlanReview, goals: Goal[]): WeekRecapResult {
  const nowComplete: PlanReviewEntry[] = [];
  const unfinished: PlanReviewEntry[] = [];
  const removed: PlanReviewEntry[] = [];
  for (const e of review.entries) {
    const node = findInAll(goals, e.nodeId);
    if (!node) removed.push(e);
    else if (isDone(node)) nowComplete.push(e);
    else unfinished.push(e);
  }
  return { planned: review.entries.length, nowComplete, unfinished, removed };
}

export interface LoggedTime {
  minutes: number;
  sessions: number;
}

// Total logged minutes and session count within the week starting `weekMonday`.
// The weekly recap uses it to set the plan against reality ("you planned N and
// logged Xh"), bridging the deliberate gap that time never touches the pct.
export function loggedTimeForWeek(sessions: Session[], weekMonday: string): LoggedTime {
  if (!isValidLocalDate(weekMonday)) return { minutes: 0, sessions: 0 };
  const start = weekDates(weekMonday)[0];
  const end = addDays(start, 6);
  let minutes = 0;
  let count = 0;
  for (const s of sessions) {
    if (isValidLocalDate(s.date) && s.date >= start && s.date <= end && s.minutes > 0) {
      minutes += s.minutes;
      count += 1;
    }
  }
  return { minutes, sessions: count };
}

// "3h 20m" / "45m" / "2h" — compact duration for the recap line.
export function formatLoggedMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Unchecked day-pinned leaves per day. Currently UNUSED — it has no callers.
// It fed the Today view's mini-calendar dots and the timeline's per-day counts;
// both consumers are gone (see the note at the top of DaysLane.tsx).
export function pinnedDayCounts(goals: Goal[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of goals) {
    walkLeaves(g, (n) => {
      if (isDone(n)) return;
      // One count per SITTING: two hours on Tuesday and two on Thursday is two
      // marks, on two days, from one leaf.
      for (const b of blocksOf(n)) m.set(b.date, (m.get(b.date) ?? 0) + 1);
    });
  }
  return m;
}
