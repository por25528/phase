import type { AvailabilityWindow, BusyBlock, Goal } from '../db/types';
import type { DailyWorkItem, DailyWorkSections } from './dailyWork';
import { goalEffort } from './effort';
import { goalHealth, type Health } from './health';
import { fmtD } from './dates';

/**
 * What Today puts in front of you, and what it refuses to.
 *
 * Phase could already compute the next open leaf, the week's plan, capacity,
 * pace and blocked states — and distributed those answers across card
 * metadata, a focus summary, a sidebar rail, a goal header and calendar blocks.
 * None of them answered "what do I do now" with any authority, so the user
 * assembled the answer themselves every morning.
 *
 * This module is the assembly, and its main job is subtraction: ONE thing in
 * front, then the day, then at most three exceptions. A dashboard of every
 * signal the app can produce is the thing it is replacing.
 */

export interface NowFocus {
  item: DailyWorkItem;
  /**
   * True when the clock is inside this item's block. "Now" and "next" are
   * different sentences and the surface says which one it is showing.
   */
  current: boolean;
}

/**
 * The single item to lead with.
 *
 * A block containing the current minute wins. Otherwise the next one to start,
 * and failing that the first untimed commitment — because a day with nothing on
 * the calendar still has work in it, and answering "nothing" then would be
 * false.
 *
 * `durationMin` falls back to 60 only for deciding whether NOW is inside a
 * block. It is never displayed: showing an hour nobody estimated would be the
 * surface inventing a number, which is the failure `unestimated` exists to
 * avoid everywhere else.
 */
const ASSUMED_BLOCK_MIN = 60;

export function nowFocus(items: DailyWorkItem[], nowMinute: number): NowFocus | null {
  const open = items.filter((i) => !i.done);
  if (open.length === 0) return null;

  const running = open.find((i) => {
    if (i.startMin === undefined) return false;
    const end = i.startMin + (i.estimateMin ?? ASSUMED_BLOCK_MIN);
    return i.startMin <= nowMinute && nowMinute < end;
  });
  if (running) return { item: running, current: true };

  const upcoming = open.find((i) => i.startMin !== undefined && i.startMin >= nowMinute);
  if (upcoming) return { item: upcoming, current: false };

  // Everything timed is behind us, or nothing is timed at all. The first
  // untimed commitment is still a real answer; `items` arrives in bucket
  // precedence, so it is the most urgent one.
  const untimed = open.find((i) => i.startMin === undefined);
  return untimed ? { item: untimed, current: false } : null;
}

// ── Attention ─────────────────────────────────────────────────────────────────

export type AttentionKind = 'carry-over' | 'at-risk' | 'blocked';

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  text: string;
  /** The goal to open, where the exception belongs to one. */
  goalId?: string;
}

/**
 * At most three. That number is the point.
 *
 * The board's focus summary showed five tiles of portfolio analytics above the
 * work, every visit, whether or not any of them applied — which trains a person
 * to skip the region, and a warning region that gets skipped is worse than none.
 * These are exceptions: something has slipped, something cannot be finished,
 * something cannot be started. A quiet day shows nothing here.
 */
export const MAX_ATTENTION = 3;

export function attentionItems(
  goals: Goal[],
  sections: DailyWorkSections,
  today: string,
  windows: AvailabilityWindow[],
  blocks: BusyBlock[],
  allDayBlocks: boolean,
): AttentionItem[] {
  const out: AttentionItem[] = [];

  const carried = sections.carryOvers.filter((i) => !i.done).length;
  if (carried > 0) {
    out.push({
      id: 'carry-over',
      kind: 'carry-over',
      text: `${carried} task${carried === 1 ? '' : 's'} slipped from an earlier day`,
    });
  }

  /*
   * Verdicts, in severity order, and only the two that need acting on.
   * `Tight` is deliberately absent: it is a state to be aware of when you open
   * the goal, not one to interrupt a Tuesday morning with.
   */
  const verdicts = goals
    .filter((g) => !g.completedAt)
    .map((g) => ({
      goal: g,
      verdict: goalHealth({ goal: g, effort: goalEffort(g), today, windows, blocks, allDayBlocks }),
    }));

  const byKind = (health: Health) => verdicts.filter((v) => v.verdict.health === health);

  for (const { goal } of byKind('at-risk')) {
    out.push({
      id: `at-risk:${goal.id}`,
      kind: 'at-risk',
      goalId: goal.id,
      text: goal.deadline
        ? `${goal.title} will not fit before ${fmtD(goal.deadline)}`
        : `${goal.title} will not fit before its deadline`,
    });
  }
  for (const { goal } of byKind('blocked')) {
    out.push({
      id: `blocked:${goal.id}`,
      kind: 'blocked',
      goalId: goal.id,
      text: `${goal.title} has nothing that can be started`,
    });
  }

  return out.slice(0, MAX_ATTENTION);
}
