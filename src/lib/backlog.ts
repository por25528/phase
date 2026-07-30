import type { Goal, Task } from '../db/types';
import { normalizeEstimate } from './capacity';
import { goalPct } from './pct';
import { attentionRank, walkLeaves } from './plan';

/** One draggable row in the backlog rail. */
export interface BacklogItem {
  kind: 'step' | 'task';
  id: string;
  goalId: string | null;
  title: string;
  estimateMin?: number;
}

/** A project heading plus its unplaced work. `goalId: null` is the loose bucket. */
export interface BacklogGroup {
  goalId: string | null;
  goalTitle: string;
  pct: number;
  items: BacklogItem[];
}

export const LOOSE_GROUP_TITLE = 'Loose tasks';

/**
 * Everything available to drag onto the grid, grouped by project.
 *
 * The membership rule is the exact complement of `scheduledOn`: an item is
 * backlog unless it is genuinely placed — a day AND a start minute — for
 * `week`. That covers three shapes the old planner could not express: never
 * planned, committed to the week with no day, and pinned to a day with no
 * time. All three are invisible on the grid, so all three must be reachable
 * here or the work is lost.
 *
 * Loose tasks sort last: they are the least structured thing on screen and
 * should not push projects down.
 */
export function backlogGroups(
  goals: Goal[],
  tasks: Task[],
  week: string,
  today: string,
): BacklogGroup[] {
  const withEstimate = (min: number | undefined): { estimateMin?: number } => {
    const usable = normalizeEstimate(min);
    return usable === undefined ? {} : { estimateMin: usable };
  };

  const byGoal = new Map<string, BacklogItem[]>();
  // `attentionRank` drops archived projects AND 'ready-to-complete' ones
  // (100% done but not archived — see plan.ts). Neither gets a `byGoal` entry,
  // so an unfinished task still pointing at such a project misses the lookup
  // below and lands in the Loose tasks bucket, losing its project heading.
  const ranked = attentionRank(goals, today);

  for (const g of ranked) {
    const items: BacklogItem[] = [];
    walkLeaves(g, (n) => {
      if (n.done) return;
      const placed =
        n.plannedWeek === week && n.plannedDay !== undefined && n.plannedStartMin !== undefined;
      if (placed) return;
      items.push({ kind: 'step', id: n.id, goalId: g.id, title: n.title, ...withEstimate(n.estimateMin) });
    });
    byGoal.set(g.id, items);
  }

  const loose: BacklogItem[] = [];
  for (const t of tasks) {
    if (t.done) continue;
    if (t.date !== undefined && t.startMin !== undefined) continue; // on the grid
    const item: BacklogItem = {
      kind: 'task', id: t.id, goalId: t.goalId, title: t.title, ...withEstimate(t.estimateMin),
    };
    const bucket = t.goalId ? byGoal.get(t.goalId) : undefined;
    if (bucket) bucket.push(item);
    else loose.push(item);
  }

  const out: BacklogGroup[] = [];
  for (const g of ranked) {
    const items = byGoal.get(g.id) ?? [];
    if (items.length === 0) continue;
    out.push({ goalId: g.id, goalTitle: g.title, pct: Math.round(goalPct(g)), items });
  }
  if (loose.length > 0) {
    out.push({ goalId: null, goalTitle: LOOSE_GROUP_TITLE, pct: 0, items: loose });
  }
  return out;
}

/** How many items a project shows before it collapses behind "+N more". */
export const BACKLOG_CAP = 5;

/** The `expanded` key for the group with no project. */
export const LOOSE_GROUP_KEY = 'loose';

/** A backlog group with the cap applied. `items` is left whole. */
export interface CappedGroup extends BacklogGroup {
  /** `goalId`, or `LOOSE_GROUP_KEY` — what `expanded` is tested against. */
  key: string;
  /** The first `BACKLOG_CAP` items, or all of them when expanded. */
  shown: BacklogItem[];
  /** `items.length - shown.length`. Zero when expanded or already short. */
  hidden: number;
  /** `items.length > BACKLOG_CAP`, whether or not it is currently expanded. */
  expandable: boolean;
}

/**
 * Apply the per-project cap.
 *
 * `items` is deliberately left untouched so callers can still count the true
 * backlog size — the cap is a display device and must not shrink the number
 * that says how much work is unplanned.
 *
 * `expandable` is a separate field rather than `hidden > 0` because those two
 * differ exactly when a long group is expanded: hidden falls to 0, but the
 * group still needs its "Show less" control. Deriving one from the other
 * strands the user inside an expanded group.
 */
export function capBacklog(groups: BacklogGroup[], expanded: Set<string>): CappedGroup[] {
  return groups.map((group) => {
    const key = group.goalId ?? LOOSE_GROUP_KEY;
    const expandable = group.items.length > BACKLOG_CAP;
    const shown =
      expandable && !expanded.has(key) ? group.items.slice(0, BACKLOG_CAP) : group.items;
    return { ...group, key, shown, hidden: group.items.length - shown.length, expandable };
  });
}
