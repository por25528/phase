import type { Goal, GoalNode } from '../db/types';
import { addDays } from './dates';
import {
  daysBetween, spanOutside, clampScale, PX_PER_DAY,
} from './timeline';
import { deadlineBefore, milestoneWithin, hasUnplannedOpenLeafThisWeek, MILESTONE_SOON_DAYS } from './plan';

// Pure roadmap logic for the Timeline (spec §3.4 / §3.2). Warnings derive from a
// project + today alone; the portfolio overlap is one sweep over the Now set;
// Fit frames a selection into the visible plot width. No view state here.

// ── Per-project warnings ──────────────────────────────────────────────────────

export type RoadmapWarningKind =
  | 'project-overdue'
  | 'phase-overdue'
  | 'phase-outside-project'
  | 'unscheduled-phases'
  | 'milestone-unplanned';

export interface RoadmapWarning {
  kind: RoadmapWarningKind;
  message: string;
  nodeIds?: string[]; // affected first-level phases, when the warning is phase-scoped
}

const isScheduled = (n: GoalNode): boolean => !!(n.start && n.deadline);

function subtreeIncomplete(n: GoalNode): boolean {
  if (n.children && n.children.length) return n.children.some(subtreeIncomplete);
  return !n.done;
}

const plural = (n: number): string => (n === 1 ? '' : 's');

// Five per-project warnings (spec §3.4). Completed projects are quiet — an
// archived project's stale dates are not actionable.
export function roadmapWarnings(goal: Goal, today: string): RoadmapWarning[] {
  if (goal.completedAt) return [];
  const out: RoadmapWarning[] = [];
  const phases = goal.nodes; // first-level nodes

  if (deadlineBefore(goal.deadline, today)) {
    out.push({ kind: 'project-overdue', message: 'Project deadline has passed' });
  }

  const overdue = phases.filter((n) => isScheduled(n) && deadlineBefore(n.deadline!, today) && subtreeIncomplete(n));
  if (overdue.length) {
    out.push({ kind: 'phase-overdue', message: `${overdue.length} phase${plural(overdue.length)} past due`, nodeIds: overdue.map((n) => n.id) });
  }

  const outside = phases.filter((n) => isScheduled(n) && spanOutside({ start: n.start!, deadline: n.deadline! }, goal));
  if (outside.length) {
    out.push({ kind: 'phase-outside-project', message: `${outside.length} phase${plural(outside.length)} outside the project span`, nodeIds: outside.map((n) => n.id) });
  }

  if ((goal.column ?? 0) === 0) {
    const unscheduled = phases.filter((n) => !isScheduled(n));
    if (unscheduled.length) {
      out.push({ kind: 'unscheduled-phases', message: `${unscheduled.length} unscheduled phase${plural(unscheduled.length)}`, nodeIds: unscheduled.map((n) => n.id) });
    }
  }

  // Same milestone window + unplanned-this-week predicate as the board's
  // milestone-soon signal, so the two surfaces can't drift (spec §3.4 / §4.2).
  if (milestoneWithin(goal, MILESTONE_SOON_DAYS, today) && hasUnplannedOpenLeafThisWeek(goal, today)) {
    out.push({ kind: 'milestone-unplanned', message: 'Milestone soon, nothing planned this week' });
  }

  return out;
}

// ── Portfolio focus-overlap ───────────────────────────────────────────────────

export interface OverlapWindow {
  window: { start: string; end: string };
  goalIds: string[];
}

const OVERLAP_MIN_PROJECTS = 3; // "more than three" ⇒ strictly > 3
const OVERLAP_MIN_DAYS = 7;

// The single portfolio warning: more than three Now spans overlapping ≥7
// consecutive days. Sweep-line over span endpoints, inclusive day counting.
// Among qualifying windows returns the earliest by start (tie-break longest),
// after merging touching runs. Null when nothing qualifies (spec §3.4).
export function focusOverlap(nowGoals: Goal[]): OverlapWindow | null {
  const spans = nowGoals.filter((g) => !g.completedAt);

  // Day deltas: +1 at a span's start, -1 the day after its (inclusive) deadline.
  const byDate = new Map<string, number>();
  for (const g of spans) {
    byDate.set(g.start, (byDate.get(g.start) ?? 0) + 1);
    const off = addDays(g.deadline, 1);
    byDate.set(off, (byDate.get(off) ?? 0) - 1);
  }
  const dates = [...byDate.keys()].sort();

  // Maximal runs where the active count exceeds three.
  const runs: { start: string; end: string }[] = [];
  let count = 0;
  for (let i = 0; i < dates.length - 1; i++) {
    count += byDate.get(dates[i])!;
    if (count > OVERLAP_MIN_PROJECTS) {
      const seg = { start: dates[i], end: addDays(dates[i + 1], -1) };
      const last = runs[runs.length - 1];
      if (last && addDays(last.end, 1) === seg.start) last.end = seg.end; // merge touching
      else runs.push(seg);
    }
  }

  const qualifying = runs.filter((r) => daysBetween(r.start, r.end) + 1 >= OVERLAP_MIN_DAYS);
  if (qualifying.length === 0) return null;

  // Earliest start, tie-break by longest.
  qualifying.sort((a, b) => a.start.localeCompare(b.start) || daysBetween(b.start, b.end) - daysBetween(a.start, a.end));
  const win = qualifying[0];
  const goalIds = spans.filter((g) => g.start <= win.end && g.deadline >= win.start).map((g) => g.id);
  return { window: { start: win.start, end: win.end }, goalIds };
}

// ── Fit projects ──────────────────────────────────────────────────────────────

export interface FitResult {
  scale: number;
  scrollToCenterDate: string;
}

// Every date belonging to the selection: project span, scheduled first-level
// phase dates, milestones.
function collectDates(goals: Goal[]): string[] {
  const out: string[] = [];
  for (const g of goals) {
    out.push(g.start, g.deadline);
    for (const n of g.nodes) if (isScheduled(n)) out.push(n.start!, n.deadline!);
    for (const m of g.milestones ?? []) out.push(m.date);
  }
  return out;
}

// Largest scale that frames the padded selection into `plotWidth` (viewport minus
// the sticky label column), clamped to the canvas zoom limits. Best-effort: too
// wide to fit settles at min zoom centered; a single-day selection uses the Week
// preset centered. Null for an empty selection or an unmeasured plot (spec §3.2).
export function fitRoadmapRange(goals: Goal[], plotWidth: number): FitResult | null {
  if (goals.length === 0 || plotWidth <= 0) return null;
  const dates = collectDates(goals);
  if (dates.length === 0) return null;

  let min = dates[0];
  let max = dates[0];
  for (const d of dates) {
    if (d < min) min = d;
    if (d > max) max = d;
  }

  // All considered dates coincide → Week preset centered on that day.
  if (min === max) return { scale: PX_PER_DAY.week, scrollToCenterDate: min };

  const spanDays = daysBetween(min, max);
  const pad = Math.max(7, Math.round(spanDays * 0.05)); // 5% per side, ≥7 days
  const paddedDays = spanDays + 2 * pad + 1; // inclusive day count of the padded range
  const scale = clampScale(plotWidth / paddedDays); // clamps to [3, 260]
  const midpoint = addDays(min, Math.floor(spanDays / 2));
  return { scale, scrollToCenterDate: midpoint };
}
