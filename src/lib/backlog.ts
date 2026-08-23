import type { Goal, Task } from '../db/types';
import { normalizeEstimate } from './capacity';
import { addDays, fmtD } from './dates';
import { isPlanningHorizon } from './horizons';
import { goalPct } from './pct';
import { attentionRank, walkLeaves } from './plan';
import { isDone, stepStatus } from './status';
import { isPlaced } from './blocks';

/** One draggable row in the backlog rail. */
export interface BacklogItem {
  kind: 'step' | 'task';
  id: string;
  goalId: string | null;
  title: string;
  estimateMin?: number;
  /**
   * When this needs doing: a step's own `deadline`, or the day a task is
   * committed to. Absent means undated, which sorts last.
   *
   * The rail carried no date at all, and each group was in raw tree order — so
   * with the per-project cap at three, a pset due tomorrow sitting eighth in
   * its project simply was not on screen, and nothing on the visible rows said
   * which of them was urgent. That is precisely the failure mode for someone
   * holding several deadlines at once.
   */
  due?: string;
}

/**
 * How far ahead a due date is worth acting on: the window in which it both
 * prints a chip and reorders the rail. The two must agree.
 */
export const DUE_CHIP_DAYS = 7;

/**
 * Nearest deadline first, everything else in tree order.
 *
 * "Everything else" means undated work AND work due beyond the urgency horizon,
 * and the second half matters: a date only reorders the rail if `dueChip` will
 * also SHOW it. Sorting on every date regardless meant a final submission due
 * next January jumped over the four steps you actually do first, displaying no
 * date at all — the project order scrambled with nothing on screen to explain
 * it — and `planNextStepFor` reads `items[0]`, so the board card's "Plan next
 * step" pointed at a deadline five months out. Whatever jumps the queue has to
 * say why.
 *
 * `Array.prototype.sort` is stable, so everything below the horizon keeps its
 * tree order and a project carrying no near dates is completely untouched.
 */
export function sortByDue(items: BacklogItem[], today: string): BacklogItem[] {
  const horizon = addDays(today, DUE_CHIP_DAYS);
  const rank = (item: BacklogItem): string | undefined =>
    item.due !== undefined && item.due <= horizon ? item.due : undefined;
  return [...items].sort((a, b) => {
    const x = rank(a);
    const y = rank(b);
    if (x === y) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return x < y ? -1 : 1;
  });
}

/**
 * The urgency chip for a row, or null when the date is far enough out that
 * printing it on every row would be noise rather than signal. `sortByDue` uses
 * the same horizon deliberately — the two must agree, or a row jumps the queue
 * with nothing on it to say why.
 */
export function dueChip(
  due: string | undefined,
  today: string,
): { text: string; overdue: boolean } | null {
  if (!due) return null;
  if (due < today) return { text: 'overdue', overdue: true };
  if (due === today) return { text: 'today', overdue: false };
  if (due > addDays(today, DUE_CHIP_DAYS)) return null;
  return { text: fmtD(due), overdue: false };
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
 * Scoped to the PLANNING horizons: Now and Next. A parked project (Later,
 * Someday) contributes only work already carrying a commitment — a step with a
 * `plannedWeek`, or a task with a `date`. That exception is not a courtesy, it
 * is what keeps the rail and the numbers beside it consistent:
 *
 *   - `weekCapacity` charges every week-committed item to "Xh to place". Work
 *     the header bills you for and the rail cannot show is the exact
 *     contradiction the planned/backlog split was introduced to remove.
 *   - `countOpenCarryOver` counts overdue tasks and steps whose planned week
 *     has passed, and offers to push them. A button that moves N items must
 *     not be counting items that are not on screen.
 *
 * Both sets are commitments, so both stay. What drops out is the untouched
 * remainder of a deferred project — which is precisely what deferring it meant.
 *
 * Loose tasks sort last: they are the least structured thing on screen and
 * should not push projects down.
 */
export function backlogGroups(
  goals: Goal[],
  tasks: Task[],
  /**
   * Kept in the signature, and deliberately unused for the placed/unplaced
   * split: a leaf with a sitting on ANY day is not waiting to be placed, so the
   * test cannot be "placed inside this week". Callers still pass it, and it
   * still reads as the week the rail is for.
   */
  _week: string,
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
  // Projects the user has deferred. They still get a `byGoal` bucket, because
  // their committed work belongs under its own project heading like anything
  // else — only their untouched remainder is left out.
  const parked = new Set(ranked.filter((g) => !isPlanningHorizon(g.column)).map((g) => g.id));

  for (const g of ranked) {
    const items: BacklogItem[] = [];
    walkLeaves(g, (n) => {
      if (isDone(n)) return;
      // Placed anywhere at all, not just inside `week`: a sitting is a sitting,
      // and a leaf with one on the calendar is not waiting to be placed.
      if (isPlaced(n)) return;
      if (parked.has(g.id) && n.plannedWeek === undefined) return;
      // Blocked or parked work is not a queue you can work. Dropped, unless
      // committed — weekCapacity bills a plannedWeek step to "to place", and a
      // number you plan against must have a row beside it. Same exception a
      // parked PROJECT gets, just above.
      const s = stepStatus(n);
      if ((s === 'blocked' || s === 'parked') && n.plannedWeek === undefined) return;
      items.push({
        kind: 'step', id: n.id, goalId: g.id, title: n.title,
        ...withEstimate(n.estimateMin),
        ...(n.deadline ? { due: n.deadline } : {}),
      });
    });
    byGoal.set(g.id, items);
  }

  const loose: BacklogItem[] = [];
  for (const t of tasks) {
    if (t.done) continue;
    if (isPlaced(t)) continue; // on the grid
    const item: BacklogItem = {
      kind: 'task', id: t.id, goalId: t.goalId, title: t.title,
      ...withEstimate(t.estimateMin),
      // A task has no deadline field; `date` is the day it is committed to,
      // which is the only urgency signal it carries.
      ...(t.date ? { due: t.date } : {}),
    };
    const goalId = t.goalId ?? null;
    const bucket = goalId ? byGoal.get(goalId) : undefined;
    // A parked project's uncommitted task is DROPPED, not demoted to Loose.
    // Falling through to `loose` is the behaviour for a task whose project has
    // no bucket at all (archived, or already complete) — reusing it here would
    // strip the project heading off deferred work and re-file it at the bottom
    // of the rail under "Loose tasks", which is more prominent than where it
    // started, not less.
    if (!bucket) loose.push(item);
    else if (goalId === null || !parked.has(goalId) || t.date !== undefined) bucket.push(item);
  }

  // Sorted per group, not globally: the rail's structure is by project, and
  // the cap that follows takes the FIRST few of each — so this is what decides
  // whether the three rows a project shows are its most urgent three or just
  // its topmost three.
  const out: BacklogGroup[] = [];
  for (const g of ranked) {
    const items = byGoal.get(g.id) ?? [];
    if (items.length === 0) continue;
    out.push({ goalId: g.id, goalTitle: g.title, pct: Math.round(goalPct(g)), items: sortByDue(items, today) });
  }
  if (loose.length > 0) {
    out.push({ goalId: null, goalTitle: LOOSE_GROUP_TITLE, pct: 0, items: sortByDue(loose, today) });
  }
  return out;
}

/** Why `backlogGroups` is hiding a project's work — see `hiddenProjectCounts`. */
export interface HiddenProjectCounts {
  /** Parked in Later or Someday, holding open work that carries no commitment. */
  parked: number;
  /**
   * Holds at least one blocked, uncommitted leaf that `backlogGroups` is not
   * showing — the same per-leaf rule applied there, counted per-project. NOT
   * "every open leaf is blocked": a project with one placed leaf and one
   * hidden-blocked leaf still has a row in the rail, via the placed one, so
   * `groups` is non-empty and this count is never consulted for it (`hidden`
   * is only computed when the rail is already empty) — safe to count more
   * loosely here than "fully blocked".
   */
  blocked: number;
}

/**
 * Projects the rail is deliberately not showing, split by the reason.
 *
 * Only the empty state needs this, and it needs it badly. "Nothing left to
 * plan" is the right sentence when the week really is placed and the wrong one
 * whenever `backlogGroups` comes back empty while hidden work exists —
 * deferred to Later/Someday, or blocked with nothing committed. Either way it
 * reads as finished rather than as filtered, and the user cannot see the rail
 * is applying a rule at all. The counts turn an apparent dead end into an
 * instruction: promote a parked project, or unblock a stuck one.
 *
 * A project can land in both buckets (parked AND fully blocked) — the buckets
 * are independent counts of DIFFERENT rules, not a partition of projects.
 */
export function hiddenProjectCounts(goals: Goal[], today: string): HiddenProjectCounts {
  let parked = 0;
  let blocked = 0;
  for (const g of attentionRank(goals, today)) {
    let hiddenBlocked = false;
    walkLeaves(g, (n) => {
      if (!isDone(n) && stepStatus(n) === 'blocked' && n.plannedWeek === undefined) hiddenBlocked = true;
    });
    if (hiddenBlocked) blocked++;

    if (!isPlanningHorizon(g.column)) {
      let hidden = false;
      walkLeaves(g, (n) => {
        if (!isDone(n) && n.plannedWeek === undefined) hidden = true;
      });
      if (hidden) parked++;
    }
  }
  return { parked, blocked };
}

/**
 * How many items a project shows before it collapses behind "+N more".
 *
 * The FLOOR of the shortlist, not a fixed size. A project is never reduced
 * below three teaser rows — enough to read as "here is the head of this
 * project's queue" rather than a single stranded row.
 *
 * A fixed three was the whole size, and it starved a rail it did not need to:
 * one project with nine unplaced steps drew three rows and "+6 more" on a
 * screen that was 60% empty, and two different problem sets both clipped to
 * `6.006 Proble…` behind it. The cap now GROWS as fewer projects share the
 * rail — see `backlogCap` — so one project fills the room it has while several
 * still split it and land back near three each.
 */
export const BACKLOG_CAP = 3;

/**
 * Roughly how many rows the rail can draw before it genuinely overflows and
 * starts scrolling. Not a measurement — the rail's height is the viewport's,
 * unknown here — but the budget the adaptive cap spends across the groups on
 * screen. Twelve fills a mostly-empty rail with a single project's queue
 * without letting four projects stack into an endless list.
 */
export const BACKLOG_ROW_BUDGET = 12;

/**
 * The effective per-project cap for a rail showing `groupCount` projects: the
 * row budget split evenly, floored at `BACKLOG_CAP` so a crowded rail still
 * shows each project's head. One project gets the whole budget; four split it
 * back to three each. It only ever GROWS the old fixed three, never shrinks it.
 */
export function backlogCap(groupCount: number): number {
  if (groupCount <= 0) return BACKLOG_ROW_BUDGET;
  return Math.max(BACKLOG_CAP, Math.floor(BACKLOG_ROW_BUDGET / groupCount));
}

/** The `expanded` key for the group with no project. */
export const LOOSE_GROUP_KEY = 'loose';

/** A backlog group with the cap applied. `items` is left whole. */
export interface CappedGroup extends BacklogGroup {
  /** `goalId`, or `LOOSE_GROUP_KEY` — what `expanded` is tested against. */
  key: string;
  /** The first `backlogCap(groupCount)` items, or all of them when expanded. */
  shown: BacklogItem[];
  /** `items.length - shown.length`. Zero when expanded or already short. */
  hidden: number;
  /** `items.length > cap`, whether or not it is currently expanded. */
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
  // One cap for the whole rail: the budget is split by how many projects share
  // it, so a group's shortlist depends on its neighbours, not on itself.
  const cap = backlogCap(groups.length);
  return groups.map((group) => {
    const key = group.goalId ?? LOOSE_GROUP_KEY;
    const expandable = group.items.length > cap;
    const shown =
      expandable && !expanded.has(key) ? group.items.slice(0, cap) : group.items;
    return { ...group, key, shown, hidden: group.items.length - shown.length, expandable };
  });
}
