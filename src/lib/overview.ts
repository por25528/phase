import type { Goal, GoalNode } from '../db/types';
import { goalEffort, type GoalEffort } from './effort';
import { checkpointMarkers } from './checkpoints';
import { stepStatus } from './status';
import { plannedLeaves } from './plan';

/**
 * What a goal's Overview tab answers, and nothing more.
 *
 * Four questions, in the order somebody opening a goal actually asks them:
 * what do I do next, how much is left, what is coming, and is anything stuck.
 * The brief for this tab warns against turning it into a dashboard of cards,
 * so the shape here is deliberately narrow — there is no room in it for a
 * chart, a streak or a velocity read, because there is no field for one.
 *
 * Every figure is DERIVED. Overview stores nothing and owns nothing; it is a
 * third reading of `goal.nodes`, exactly as Board and Calendar are, so it
 * cannot disagree with the tree about what is done.
 */

/** Enough to choose from, few enough to read without scanning. */
export const OVERVIEW_NEXT_MAX = 3;
export const OVERVIEW_UPCOMING_MAX = 4;

export interface OverviewNextItem {
  id: string;
  title: string;
  estimateMin?: number;
  /** The container this sits in, for context. Absent at the root. */
  parentTitle?: string;
  /** True while the task is already under way — the reason it sorts first. */
  started: boolean;
}

export interface OverviewUpcoming {
  id: string;
  title: string;
  date: string;
  overdue: boolean;
}

export interface GoalOverview {
  next: OverviewNextItem[];
  upcoming: OverviewUpcoming[];
  effort: GoalEffort;
  /** Open leaves whose status is `blocked` — the count, not the rows. */
  blocked: number;
}

export interface GoalWeekLoad {
  /** Leaves planned into this week, done or not. */
  total: number;
  done: number;
  /** Σ estimates of the OPEN ones. Priced work only. */
  minutes: number;
  /** Open ones carrying no estimate — the reason `minutes` is a floor. */
  unestimated: number;
}

/**
 * What this goal has committed to the week.
 *
 * Membership is `plannedLeaves`' rule and nothing else — a leaf belongs to the
 * week when it carries `plannedWeek` or has a sitting landing inside it — so
 * this figure cannot start disagreeing with the Plan rail about what "this
 * week" means.
 *
 * `minutes` counts only OPEN, PRICED leaves: a finished task is not work left,
 * and an unpriced one is unknown rather than free, which is why the count of
 * those is reported beside it instead of being folded in as zero.
 */
export function goalWeekLoad(goal: Goal, week: string): GoalWeekLoad {
  const leaves = plannedLeaves([goal], week);
  let done = 0;
  let minutes = 0;
  let unestimated = 0;
  for (const leaf of leaves) {
    if (leaf.done) { done += 1; continue; }
    if (leaf.estimateMin === undefined) unestimated += 1;
    else minutes += leaf.estimateMin;
  }
  return { total: leaves.length, done, minutes, unestimated };
}

/**
 * Open leaves in queue order: everything started, then everything untouched.
 *
 * The two-pass shape is `firstOpenLeaf`'s, and copying it is the point — this
 * list's FIRST entry has to be the task the rest of the app calls next, or the
 * Overview tab and the goal header would name different work on the same
 * screen. Blocked leaves are skipped for the same reason `firstOpenLeaf` skips
 * them: they are open, but they are not available.
 *
 * Milestones are NOT filtered out, again matching `firstOpenLeaf`. One that is
 * genuinely next is a real answer — "the exam is the next thing on this goal"
 * is what a study plan looks like in its last week.
 */
function openLeavesInOrder(nodes: GoalNode[]): OverviewNextItem[] {
  const started: OverviewNextItem[] = [];
  const fresh: OverviewNextItem[] = [];

  function walk(list: GoalNode[], parentTitle?: string): void {
    for (const n of list) {
      if (n.children && n.children.length) {
        walk(n.children, n.title);
        continue;
      }
      const status = stepStatus(n);
      if (status !== 'doing' && status !== 'todo') continue;
      const item: OverviewNextItem = {
        id: n.id,
        title: n.title,
        estimateMin: n.estimateMin,
        parentTitle,
        started: status === 'doing',
      };
      (status === 'doing' ? started : fresh).push(item);
    }
  }

  walk(nodes);
  return [...started, ...fresh];
}

function countBlocked(nodes: GoalNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.children && node.children.length) n += countBlocked(node.children);
    else if (stepStatus(node) === 'blocked') n += 1;
  }
  return n;
}

/**
 * `today` is passed in rather than read, like every other dated helper here —
 * it is what makes "is this milestone overdue" testable without a clock.
 */
export function goalOverview(g: Goal, today: string): GoalOverview {
  const upcoming = checkpointMarkers(g)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => ({ ...m, overdue: m.date < today }))
    .slice(0, OVERVIEW_UPCOMING_MAX);

  return {
    next: openLeavesInOrder(g.nodes).slice(0, OVERVIEW_NEXT_MAX),
    upcoming,
    effort: goalEffort(g),
    blocked: countBlocked(g.nodes),
  };
}

/**
 * Whether the tab has anything to say.
 *
 * An empty goal gets the tree's own "break this down" offer instead — an
 * Overview showing three empty sections and a 0% bar is the dashboard-of-cards
 * failure in its purest form.
 */
export function overviewIsEmpty(o: GoalOverview): boolean {
  return (
    o.next.length === 0
    && o.upcoming.length === 0
    && o.blocked === 0
    && o.effort.total === 0
  );
}
