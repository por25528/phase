import type { AvailabilityWindow, BusyBlock, Goal } from '../db/types';
import type { DailyWorkItem, DailyWorkSections } from './dailyWork';
import { goalEffort } from './effort';
import { goalHealth, type Health } from './health';
import { fmtD, parseD } from './dates';
import { firstBlockedLeaf } from './board';

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

export type AttentionKind = 'at-risk' | 'blocked';

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  text: string;
  /** The goal to open, where the exception belongs to one. */
  goalId?: string;
  /**
   * The exact task to land on.
   *
   * A blocked goal opens ON its first blocked task rather than at the top of
   * its tree, because "nothing here can be started" is only actionable next to
   * the reason — and the board card that used to carry this deep link had it as
   * a footer button duplicating the card's own click target.
   */
  nodeId?: string;
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
  _sections: DailyWorkSections,
  today: string,
  windows: AvailabilityWindow[],
  blocks: BusyBlock[],
  allDayBlocks: boolean,
): AttentionItem[] {
  const out: AttentionItem[] = [];

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
      ...(firstBlockedLeaf(goal.nodes) ? { nodeId: firstBlockedLeaf(goal.nodes)!.id } : {}),
      text: `${goal.title} has nothing that can be started`,
    });
  }

  return out.slice(0, MAX_ATTENTION);
}

/**
 * Why this row is on today's list at all.
 *
 * Every item here arrived through a different door — a deadline, a day it was
 * placed on, a week it was committed to — and the surface showed them as one
 * undifferentiated list. "Show why an item is surfaced" is the difference
 * between a list you trust and a list you re-derive.
 *
 * Null where the row already says it: something placed at 14:00 shows 14:00,
 * and a chip reading "placed today" beside it is a word for a fact already on
 * screen.
 */
export function surfaceReason(item: DailyWorkItem): string | null {
  switch (item.source) {
    case 'due': return 'Due today';
    case 'this-week': return 'This week';
    case 'carry-over': return 'Carried over';
    default: return null;
  }
}

/**
 * The most carry-over rows Today will draw.
 *
 * A section listing everything overdue is the second backlog rail this surface
 * must not become. Five is the same number `PROPOSAL_MAX` settled on, for the
 * same reason: past it, a list stops being a decision.
 */
export const MAX_CARRY_OVER = 5;

/** The date a carry-over slipped from: a task's day, a step's week. */
function carriedDate(item: DailyWorkItem): string | undefined {
  return item.kind === 'task' ? item.scheduledDate : item.plannedWeek;
}

/**
 * How long ago a carry-over slipped — the one fact justifying its row.
 *
 * Days inside a week, weeks beyond it. The boundary is a boundary rather than a
 * taper because a step's date is a WEEK commitment: it is only ever accurate to
 * the week, and "9d ago" would claim a precision the stored value does not have.
 */
export function carriedFrom(item: DailyWorkItem, today: string): string | null {
  const from = carriedDate(item);
  if (!from) return null;
  const days = Math.round((parseD(today).getTime() - parseD(from).getTime()) / 86_400_000);
  if (days <= 0) return null;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? 'Last week' : `${weeks}w ago`;
}

/**
 * The rows Today draws, and the count it withheld.
 *
 * Oldest first, for `slippedWork`'s reason: the thing that slipped furthest has
 * waited longest, and a section that leads with yesterday buries the week-old
 * one underneath it.
 *
 * `exclude` carries the keys the page is already showing — a carry-over is a
 * candidate the advisor may lead with, and the row sitting in Now is on screen:
 * listing it again would be the same task twice. It is dropped in the same pass
 * as a finished one, BEFORE the cap, so it is never counted as withheld either.
 */
export function carryOverRows(
  carryOvers: DailyWorkItem[],
  today: string,
  exclude: ReadonlySet<string> = new Set(),
): { rows: DailyWorkItem[]; overflow: number } {
  const open = carryOvers.filter((i) => !i.done && !exclude.has(i.key));
  const ordered = [...open].sort((a, b) => {
    const ad = carriedDate(a) ?? today;
    const bd = carriedDate(b) ?? today;
    return ad.localeCompare(bd);
  });
  return {
    rows: ordered.slice(0, MAX_CARRY_OVER),
    overflow: Math.max(0, ordered.length - MAX_CARRY_OVER),
  };
}
