import type { Goal, GoalNode } from '../db/types';
import { isDone } from './status';
import { normalizeEstimate } from './capacity';

/**
 * What a goal has left to do, in minutes and in tasks.
 *
 * This exists because a percentage is the wrong headline. `goalPct` silently
 * changes basis — weighted by estimate when a set is fully estimated, an equal
 * mean otherwise — so 62% means two different things on two goals and the
 * reader cannot tell which. Remaining effort has one meaning, and it is the
 * figure a person actually plans against: "12h 30m left" is something you can
 * compare to the free hours before the deadline. The percentage stays as a
 * compact secondary visual.
 */
export interface GoalEffort {
  /** Estimated minutes on OPEN leaves. Excludes checkpoints — see below. */
  remainingMin: number;
  /**
   * Open leaves carrying no estimate. The remaining figure is a FLOOR while
   * this is above zero, and every surface that shows one must show the other:
   * "8h left" beside six unestimated tasks is a number that will grow.
   */
  unestimated: number;
  /** Every leaf, checkpoints included — this is the count `goalPct` rolls up. */
  total: number;
  done: number;
}

/**
 * A milestone (`checkpoint` in storage) is a dated marker — an exam, a
 * submission, a demo. It is a real leaf and it counts in the roll-up,
 * deliberately: a marker that never moved a number was the exact complaint that
 * retired the previous `Milestone` object, and the spec's proposal to bring one
 * back would reintroduce it.
 *
 * But it is not WORK: nobody spends ninety minutes doing a deadline. So it
 * counts in `total` and `done` and contributes nothing to `remainingMin`, and —
 * this is the part that matters — it never lands in `unestimated` either, where
 * it would have read as a task somebody forgot to estimate. That split is how
 * both things are true at once: it moves the percentage, and it is not effort.
 */
function countsAsEffort(n: GoalNode): boolean {
  return n.checkpoint !== true;
}

export function goalEffort(g: Goal): GoalEffort {
  let remainingMin = 0;
  let unestimated = 0;
  let total = 0;
  let done = 0;

  const walk = (nodes: GoalNode[]): void => {
    for (const n of nodes) {
      if (n.children && n.children.length > 0) {
        walk(n.children);
        continue;
      }
      total += 1;
      if (isDone(n)) {
        done += 1;
        continue;
      }
      if (!countsAsEffort(n)) continue;
      // `normalizeEstimate` is the one definition of a usable estimate. An
      // imported 0.4 is not "priced at zero minutes"; it is unestimated, and
      // the workload math has always said so.
      const est = normalizeEstimate(n.estimateMin);
      if (est === undefined) unestimated += 1;
      else remainingMin += est;
    }
  };
  walk(g.nodes);

  return { remainingMin, unestimated, total, done };
}

/**
 * "12h 30m", "45m", "0m". Tabular by construction — no "about", no "~", and
 * never a bare decimal hour, which reads as a duration nobody typed.
 */
export function fmtMinutes(min: number): string {
  const safe = Math.max(0, Math.round(min));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * The header line: `12h 30m remaining · 8 of 14 tasks`, with the qualifier
 * attached when the first figure is incomplete.
 *
 * Returns null for a goal with no tasks at all — there is nothing to be
 * remaining about, and "0m remaining · 0 of 0 tasks" reads like a finished
 * goal rather than an empty one.
 *
 * The minutes are omitted entirely when nothing has been estimated yet, for
 * the same reason one step up: `0m remaining` is not a small amount of work
 * left, it is nobody having said how much there is — and printing it beside
 * the "4 unestimated" qualifier contradicts the qualifier that exists to
 * explain it. The count is always true, so the count is what is stated.
 */
export function describeEffort(e: GoalEffort): string | null {
  if (e.total === 0) return null;
  const count = `${e.done} of ${e.total} task${e.total === 1 ? '' : 's'}`;
  if (e.done === e.total) return `every task done · ${count}`;
  const parts = e.remainingMin > 0
    ? [`${fmtMinutes(e.remainingMin)} remaining`, count]
    : [count];
  if (e.unestimated > 0) {
    parts.push(`${e.unestimated} unestimated`);
  }
  return parts.join(' · ');
}

/**
 * The board card's three-part restatement of the same figures: a fraction to
 * DRAW, a fraction to PRINT, and the estimate's caveats.
 *
 * `describeEffort` above is the goal header's one long sentence, and a card has
 * neither the width for it nor the same job. These are separate rather than a
 * shorter variant of it because the card splits the figures across two lines by
 * design — see `effortCaption`.
 */

/**
 * Completion as a percentage, counted by TASK.
 *
 * Deliberately not `goalPct`. That figure switches between an estimate-weighted
 * mean and an equal one depending on whether every sibling set happens to be
 * estimated, which is exactly why the card's previous progress bar was deleted:
 * a bar is the most confident-looking object on a card, and it was drawing the
 * least stable number on it. This is a flat leaf count with one basis, and it is
 * the same figure `effortCount` prints beside the bar — so the meter states
 * nothing the card was not already saying, which is the only licence it has to
 * be there.
 */
export function effortPct(e: GoalEffort): number {
  if (e.total === 0) return 0;
  return (e.done / e.total) * 100;
}

/** The figure at the meter's right edge: `2/13`, or `Done` at full. */
export function effortCount(e: GoalEffort): string {
  if (e.total > 0 && e.done === e.total) return 'Done';
  return `${e.done}/${e.total}`;
}

/**
 * What the meter cannot say: `55m left · 11 unestimated`.
 *
 * These are caveats about the ESTIMATE, not about progress, and they are kept
 * off the meter's own row on purpose — sitting adjacent to the count is what
 * made the old single line read as one quantity when it was three.
 *
 * Minutes are omitted when nothing has been estimated, on the same grounds as
 * `describeEffort`: `0m left` is not a small amount of work remaining, it is
 * nobody having said how much there is. Returns null when neither part applies,
 * so the caller renders no line at all rather than an empty one.
 */
export function effortCaption(e: GoalEffort): string | null {
  const parts: string[] = [];
  if (e.remainingMin > 0) parts.push(`${fmtMinutes(e.remainingMin)} left`);
  if (e.unestimated > 0) parts.push(`${e.unestimated} unestimated`);
  return parts.length > 0 ? parts.join(' · ') : null;
}
