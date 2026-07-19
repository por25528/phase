import type { Goal, GoalNode, PlanReview, PlanReviewEntry } from '../db/types';
import { weekDates, addDays } from './dates';
import { goalPct } from './pct';
import { expectedPct, behindPaceBy, daysBetween } from './timeline';
import { leafCount } from './board';
import { findInAll } from './tree';

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
  plannedDay?: string;
}

function walkLeaves(g: Goal, visit: (n: GoalNode) => void): void {
  function walk(nodes: GoalNode[]): void {
    for (const n of nodes) {
      if (n.children && n.children.length) walk(n.children);
      else visit(n);
    }
  }
  walk(g.nodes);
}

function hasLeaf(nodes: GoalNode[]): boolean {
  for (const n of nodes) {
    if (!n.children) return true;
    if (hasLeaf(n.children)) return true;
  }
  return false;
}

function asPlanned(g: Goal, n: GoalNode): PlannedLeaf {
  return {
    goalId: g.id, goalTitle: g.title, nodeId: n.id, title: n.title,
    done: !!n.done, plannedWeek: n.plannedWeek!, plannedDay: n.plannedDay,
  };
}

// Active (non-archived) projects. Completed projects are excluded from every
// planning selector below, so a finished project never surfaces a no-op control
// in Today or the planner (spec §2.5).
export function activeGoals(goals: Goal[]): Goal[] {
  return goals.filter((g) => !g.completedAt);
}

// All leaves planned for `week` (done and not), day-pinned first in day order.
export function plannedLeaves(goals: Goal[], week: string): PlannedLeaf[] {
  const out: PlannedLeaf[] = [];
  for (const g of goals) {
    if (g.completedAt) continue;
    walkLeaves(g, (n) => { if (n.plannedWeek === week) out.push(asPlanned(g, n)); });
  }
  return out.sort((a, b) => (a.plannedDay ?? '9999').localeCompare(b.plannedDay ?? '9999'));
}

export interface NextUpItem {
  goalId: string;
  goalTitle: string;
  nodeId: string;
  title: string;
  tier: 'pinned-today' | 'week' | 'suggested';
  plannedDay?: string;
}

// Today's list: today's pins, then this week's other visible commitments
// (unpinned, or pinned to a day that already slipped), then suggestions.
// - Future-day pins are hidden until their day.
// - Suggestions come only from NEVER-planned leaves (any plannedWeek —
//   future pin, future week, or carry-over — excludes a leaf), never repeat
//   an emitted node, and skip leaves/goals whose start is in the future.
// - `limit` bounds SUGGESTIONS only; commitments always render in full.
export function nextUp(goals: Goal[], today: string, limit = 7): NextUpItem[] {
  const week = weekOf(today);
  const pinnedToday: NextUpItem[] = [];
  const weekPool: NextUpItem[] = [];
  const suggested: NextUpItem[] = [];

  for (const g of goals) {
    if (g.completedAt) continue;
    walkLeaves(g, (n) => {
      if (n.done || n.plannedWeek !== week) return;
      const item: NextUpItem = {
        goalId: g.id, goalTitle: g.title, nodeId: n.id, title: n.title,
        tier: 'week', plannedDay: n.plannedDay,
      };
      if (n.plannedDay === today) pinnedToday.push({ ...item, tier: 'pinned-today' });
      else if (!n.plannedDay || n.plannedDay < today) weekPool.push(item);
      // else: future-day pin — hidden until its day
    });
  }

  for (const g of goals) {
    if (suggested.length >= limit) break;
    if (g.completedAt) continue;
    if (g.start > today) continue;
    walkLeaves(g, (n) => {
      if (suggested.length >= limit) return;
      if (n.done || n.plannedWeek) return;
      if (n.start && n.start > today) return;
      suggested.push({
        goalId: g.id, goalTitle: g.title, nodeId: n.id, title: n.title, tier: 'suggested',
      });
    });
  }

  return [...pinnedToday, ...weekPool, ...suggested];
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

// Open leaves not committed to `week` — the week planner's left rail (T9). A leaf
// planned to a different week (a carry-over) still counts as available to plan.
export function unplannedOpenLeaves(g: Goal, week: string): GoalNode[] {
  const out: GoalNode[] = [];
  walkLeaves(g, (n) => { if (!n.done && n.plannedWeek !== week) out.push(n); });
  return out;
}

// Unchecked leaves whose plan slipped past its week — the "Needs a decision" list.
export function carryOvers(goals: Goal[], today: string): PlannedLeaf[] {
  const week = weekOf(today);
  const out: PlannedLeaf[] = [];
  for (const g of goals) {
    if (g.completedAt) continue;
    walkLeaves(g, (n) => {
      if (!n.done && n.plannedWeek && n.plannedWeek < week) out.push(asPlanned(g, n));
    });
  }
  return out;
}

export type PaceState = 'behind' | 'quiet-ahead' | 'on-pace' | 'needs-breakdown' | 'complete';

// Schedule pace is an ATTENTION signal, not a performance score: pct averages
// unweighted nodes, so treat the verdict as "worth a look", never "the truth".
export function paceStatus(g: Goal, today: string): PaceState {
  if (!hasLeaf(g.nodes)) return 'needs-breakdown';
  const leaves = leafCount(g.nodes);
  if (leaves.total === 0) return 'needs-breakdown';
  if (leaves.done === leaves.total) return 'complete';
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
export const MILESTONE_SOON_DAYS = 14; // separate constant, same value — tunable apart

export function deadlineBefore(date: string, today: string): boolean {
  return date < today;
}

// A milestone falls within today..today+days, inclusive.
export function milestoneWithin(g: Goal, days: number, today: string): boolean {
  const end = addDays(today, days);
  return (g.milestones ?? []).some((m) => m.date >= today && m.date <= end);
}

function hasOpenLeaf(g: Goal): boolean {
  let open = false;
  walkLeaves(g, (n) => { if (!n.done) open = true; });
  return open;
}

function hasPlannedOpenLeafThisWeek(g: Goal, today: string): boolean {
  const week = weekOf(today);
  let planned = false;
  walkLeaves(g, (n) => { if (!n.done && n.plannedWeek === week) planned = true; });
  return planned;
}

function hasOverdueLeaf(g: Goal, today: string): boolean {
  let overdue = false;
  walkLeaves(g, (n) => { if (!n.done && n.deadline && deadlineBefore(n.deadline, today)) overdue = true; });
  return overdue;
}

// An open leaf exists, but nothing unfinished is planned for this week — the
// shared condition behind `not-planned` and (given open leaves) `milestone-soon`.
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
  | 'milestone-soon'
  | 'not-planned'
  | 'on-track';

// States 3–7 (precedence order). `not-planned` is Now-only; the others apply to
// any committed horizon — the caller has already screened out Later/Someday.
function activeWorkState(g: Goal, today: string, pace: PaceState, col: number): ProjectAttention {
  if (pace === 'needs-breakdown') return 'needs-breakdown';
  if (pace === 'behind') return 'behind';
  if (g.deadline <= addDays(today, DUE_SOON_DAYS)) return 'due-soon';
  if (milestoneWithin(g, MILESTONE_SOON_DAYS, today) && !hasPlannedOpenLeafThisWeek(g, today)) return 'milestone-soon';
  if (col === 0 && hasUnplannedOpenLeafThisWeek(g, today)) return 'not-planned';
  return 'on-track';
}

export function projectAttention(g: Goal, today: string): ProjectAttention {
  if (g.completedAt) return 'completed';
  const pace = paceStatus(g, today);
  if (pace === 'complete') return 'ready-to-complete';
  if (deadlineBefore(g.deadline, today) || hasOverdueLeaf(g, today)) return 'overdue';
  // Horizon gating: active-work signals surface only on Now (0) and Next (1);
  // Later/Someday stay quiet.
  const col = g.column ?? 0;
  if (col > 1) return 'on-track';
  return activeWorkState(g, today, pace, col);
}

// Planner sort: projects ordered by projectAttention precedence (the single
// authority), board order breaking ties. Completed and ready-to-complete
// projects are dropped — nothing to plan.
const ATTENTION_ORDER: ProjectAttention[] = [
  'overdue', 'needs-breakdown', 'behind', 'due-soon', 'milestone-soon', 'not-planned', 'on-track',
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
}

export function focusSummary(goals: Goal[], today: string): FocusSummary {
  const active = activeGoals(goals);
  const week = weekOf(today);

  const slots = active.filter((g) => (g.column ?? 0) === 0).map((g) => g.id);
  const needsFirstStep = active
    .filter((g) => (g.column ?? 0) === 0 && projectAttention(g, today) === 'needs-breakdown')
    .map((g) => g.id);
  const behind = active
    .filter((g) => projectAttention(g, today) === 'behind')
    .map((g) => g.id);

  // Open leaves planned for this week, and which projects still own one.
  let plannedCount = 0;
  const plannedIds: string[] = [];
  for (const g of active) {
    let has = false;
    walkLeaves(g, (n) => { if (!n.done && n.plannedWeek === week) { plannedCount++; has = true; } });
    if (has) plannedIds.push(g.id);
  }

  return {
    slots: { used: slots.length, limit: NOW_WIP_LIMIT, goalIds: slots },
    needsFirstStep: { count: needsFirstStep.length, goalIds: needsFirstStep },
    behind: { count: behind.length, goalIds: behind },
    plannedRemaining: { count: plannedCount, goalIds: plannedIds },
  };
}

// ── Card derivations ──────────────────────────────────────────────────────────
// Pure view-model for a board card (spec §2.4). The component maps these to JSX;
// all the date/leaf reasoning lives here so a card can never disagree with the
// attention authority.

export interface MeaningfulDate {
  date: string;
  kind: 'deadline' | 'milestone';
  past: boolean;
}

// The one date a card leads with: the soonest upcoming milestone that still
// lands before the deadline, else the deadline itself. `past` flags an overdue
// deadline (nothing upcoming and the deadline already behind us).
export function nearestMeaningfulDate(g: Goal, today: string): MeaningfulDate {
  const upcoming = (g.milestones ?? [])
    .filter((m) => m.date >= today && m.date < g.deadline)
    .map((m) => m.date)
    .sort();
  if (upcoming.length > 0) return { date: upcoming[0], kind: 'milestone', past: false };
  return { date: g.deadline, kind: 'deadline', past: deadlineBefore(g.deadline, today) };
}

export interface NextAction {
  kind: 'planned' | 'open' | 'needs-breakdown' | 'complete';
  title: string;
}

// The single "what's next" line: a leaf already planned for this week wins, then
// the first open leaf, then the breakdown/complete prompts. Preference order
// mirrors how the planner surfaces work.
export function nextOpenAction(g: Goal, today: string): NextAction {
  const leaves = leafCount(g.nodes);
  if (leaves.total === 0) return { kind: 'needs-breakdown', title: 'No steps yet — break the project into actions' };
  if (leaves.done === leaves.total) return { kind: 'complete', title: 'All steps complete' };
  const week = weekOf(today);
  const open: GoalNode[] = [];
  walkLeaves(g, (n) => { if (!n.done) open.push(n); });
  const planned = open.find((n) => n.plannedWeek === week);
  const pick = planned ?? open[0];
  return { kind: planned ? 'planned' : 'open', title: pick.title };
}

export interface AttentionBadge {
  label: string;
  tone: 'warn' | 'warn-strong' | 'accent' | 'plan' | 'step';
}

// The single badge a card shows, straight off projectAttention. `on-track`
// (and the terminal states, which never render as board cards) carry no badge.
export function attentionBadge(g: Goal, today: string): AttentionBadge | null {
  switch (projectAttention(g, today)) {
    case 'overdue':
      return { label: 'Overdue', tone: 'warn-strong' };
    case 'needs-breakdown':
      return { label: 'Needs a first step', tone: 'step' };
    case 'behind': {
      const pts = Math.round(behindPaceBy(Math.round(goalPct(g)), g.start, g.deadline, today));
      return { label: `Behind ${pts}%`, tone: 'warn' };
    }
    case 'due-soon':
      return { label: `Due in ${daysBetween(today, g.deadline)}d`, tone: 'warn' };
    case 'milestone-soon': {
      const soon = (g.milestones ?? [])
        .filter((m) => m.date >= today && m.date <= addDays(today, MILESTONE_SOON_DAYS))
        .map((m) => m.date)
        .sort();
      if (soon.length === 0) return null; // unreachable given the state, but keep total
      return { label: `Milestone in ${daysBetween(today, soon[0])}d`, tone: 'warn' };
    }
    case 'not-planned':
      return { label: 'Not planned this week', tone: 'plan' };
    case 'ready-to-complete':
      return { label: 'Ready to complete', tone: 'accent' };
    default:
      return null; // on-track, completed
  }
}

export type CardActionKind = 'plan' | 'define' | 'complete' | 'none';

// The card's primary verb follows the verdict: break it down, complete it, or
// plan the next step. Someday projects get no plan nag (matches horizon gating).
export function cardPrimaryAction(g: Goal, today: string): CardActionKind {
  switch (projectAttention(g, today)) {
    case 'needs-breakdown': return 'define';
    case 'ready-to-complete': return 'complete';
    case 'completed': return 'none';
    default: return (g.column ?? 0) >= 3 ? 'none' : 'plan';
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
    else if (node.done) nowComplete.push(e);
    else unfinished.push(e);
  }
  return { planned: review.entries.length, nowComplete, unfinished, removed };
}

// Unchecked day-pinned leaves per day — powers MiniCalendar dots and the
// timeline's per-day counts.
export function pinnedDayCounts(goals: Goal[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of goals) {
    walkLeaves(g, (n) => {
      if (!n.done && n.plannedDay) m.set(n.plannedDay, (m.get(n.plannedDay) ?? 0) + 1);
    });
  }
  return m;
}
