import type { Goal, GoalNode, PlanReview, PlanReviewEntry, Session } from '../db/types';
import { weekDates, addDays } from './dates';
import { behindPaceHint, behindPaceLabel } from './pace';
import { goalPct } from './pct';
import { expectedPct, behindPaceBy, daysBetween } from './timeline';
import { leafCount } from './board';
import { findInAll } from './tree';
import { hasTrustedSchedule, needsDateConfirmation, isValidLocalDate } from './schedule';

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
export function plannedLeaves(goals: Goal[], week: string): PlannedLeaf[] {
  const out: PlannedLeaf[] = [];
  for (const g of goals) {
    if (g.completedAt) continue;
    walkLeaves(g, (n) => { if (n.plannedWeek === week) out.push(asPlanned(g, n)); });
  }
  return out.sort((a, b) => (a.plannedDay ?? '9999').localeCompare(b.plannedDay ?? '9999'));
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
    if (!n.done && (n.plannedWeek !== week || n.plannedDay === undefined || n.plannedStartMin === undefined)) out.push(n);
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
      } else if (!n.done && (n.plannedWeek !== week || n.plannedDay === undefined || n.plannedStartMin === undefined)) {
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
  if (g.datesConfirmed === true && g.deadline && g.deadline <= addDays(today, DUE_SOON_DAYS)) return 'due-soon';
  if (milestoneWithin(g, MILESTONE_SOON_DAYS, today) && !hasPlannedOpenLeafThisWeek(g, today)) return 'milestone-soon';
  if (col === 0 && hasUnplannedOpenLeafThisWeek(g, today)) return 'not-planned';
  return 'on-track';
}

export function projectAttention(g: Goal, today: string): ProjectAttention {
  if (g.completedAt) return 'completed';
  const pace = paceStatus(g, today);
  if (pace === 'complete') return 'ready-to-complete';
  if ((g.datesConfirmed === true && g.deadline && deadlineBefore(g.deadline, today)) || hasOverdueLeaf(g, today)) return 'overdue';
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

// The one date a card leads with: for trusted schedules, the soonest upcoming
// milestone before the deadline or the deadline itself. Unconfirmed schedules
// may surface an upcoming milestone, but never their legacy project deadline.
export function nearestMeaningfulDate(g: Goal, today: string): MeaningfulDate | null {
  const confirmedDeadline = g.datesConfirmed === true ? g.deadline : undefined;
  const upcoming = (g.milestones ?? [])
    .filter((m) => m.date >= today && (!confirmedDeadline || m.date < confirmedDeadline))
    .map((m) => m.date)
    .sort();
  if (upcoming.length > 0) return { date: upcoming[0], kind: 'milestone', past: false };
  if (confirmedDeadline) {
    return { date: confirmedDeadline, kind: 'deadline', past: deadlineBefore(confirmedDeadline, today) };
  }
  return null;
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
      return { label: 'Needs a first step', tone: 'step' };
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
      if (!n.done && n.plannedDay) m.set(n.plannedDay, (m.get(n.plannedDay) ?? 0) + 1);
    });
  }
  return m;
}
