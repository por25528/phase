import type { Goal, GoalNode, PlanReview, PlanReviewEntry } from '../db/types';
import { weekDates, addDays } from './dates';
import { goalPct } from './pct';
import { expectedPct } from './timeline';
import { leafCount } from './board';
import { findInAll } from './tree';

// One shared threshold so cards, the insight bar, and the planner never
// disagree about what "behind" means.
export const PACE_THRESHOLD_PTS = 10;

export function weekOf(date: string): string {
  return weekDates(date)[0];
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

// All leaves planned for `week` (done and not), day-pinned first in day order.
export function plannedLeaves(goals: Goal[], week: string): PlannedLeaf[] {
  const out: PlannedLeaf[] = [];
  for (const g of goals) {
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

// Unchecked leaves whose plan slipped past its week — the "Needs a decision" list.
export function carryOvers(goals: Goal[], today: string): PlannedLeaf[] {
  const week = weekOf(today);
  const out: PlannedLeaf[] = [];
  for (const g of goals) {
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
  // Round pct first, then the diff — mirrors BoardCard/boardInsights exactly.
  const pct = Math.round(goalPct(g));
  const diff = Math.round(expectedPct(g.start, g.deadline, today) - pct);
  if (diff >= PACE_THRESHOLD_PTS) return 'behind';
  if (-diff >= PACE_THRESHOLD_PTS) return 'quiet-ahead';
  return 'on-pace';
}

// Planner sort: overdue scheduled leaves → behind pace → due within 14 days →
// board priority (the goals array is already column-major). Complete goals are
// dropped — nothing to plan.
export function attentionRank(goals: Goal[], today: string): Goal[] {
  function score(g: Goal): number {
    let overdue = false;
    walkLeaves(g, (n) => {
      if (!n.done && n.deadline && n.deadline < today) overdue = true;
    });
    if (overdue) return 0;
    if (paceStatus(g, today) === 'behind') return 1;
    if (g.deadline >= today && g.deadline <= addDays(today, 14)) return 2;
    return 3;
  }
  return goals
    .filter((g) => paceStatus(g, today) !== 'complete')
    .map((g, i) => ({ g, s: score(g), i }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.g);
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
