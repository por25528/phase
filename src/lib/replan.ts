import type { AvailabilityWindow, BusyBlock, Goal, Task } from '../db/types';
import { addDays } from './dates';
import { isDone } from './status';
import { resolveSlot, type PlacedSpan } from './slot';
import { windowForDate } from './availability';
import { blocksOf } from './blocks';
import { scheduledOn } from './scheduled';
import type { Now } from './capacity';

/**
 * What to do about the work that did not happen.
 *
 * Phase could already tell you something had slipped — `countOpenCarryOver`
 * counts it, the rail lists it — and then left you to interpret the backlog,
 * the calendar and the deadlines by hand. A planner is good at representing a
 * plan and useless if renegotiating one is manual, because the plan is wrong by
 * Tuesday afternoon of most weeks.
 *
 * This module proposes; it never writes. Every move is shown with where it came
 * from and where it would go, and the ones that will not fit are listed too —
 * an item quietly dropped from a recovery flow is the same work slipping again,
 * one layer deeper.
 */
export interface SlippedItem {
  kind: 'step' | 'task';
  id: string;
  /**
   * WHICH sitting slipped.
   *
   * A task can be sat several times, and only the sittings that are in the past
   * have slipped — moving the whole task would drag Thursday's planned hour
   * backwards because Monday's went unused.
   */
  blockId: string;
  goalId: string | null;
  goalTitle: string;
  title: string;
  /** The day it was placed on, which is in the past. */
  from: string;
  /** How long this sitting is — its own length, not the task's estimate. */
  minutes: number;
}

export interface ReplanMove extends SlippedItem {
  /** Where it would go. */
  to: string;
  startMin: number;
}

export interface ReplanProposal {
  moves: ReplanMove[];
  /** Slipped work that will not fit inside the horizon at all. */
  unplaceable: SlippedItem[];
}

/**
 * How far ahead a recovery may reach.
 *
 * Fourteen days, matching the deadline rail. Further out is not recovery, it is
 * rescheduling the month, and a proposal a person cannot hold in their head is
 * one they will accept without reading.
 */
export const REPLAN_HORIZON_DAYS = 14;

/** Everything unfinished that was placed on a day now past. */
export function slippedWork(
  goals: Goal[],
  tasks: Task[],
  today: string,
): SlippedItem[] {
  const out: SlippedItem[] = [];

  for (const goal of goals) {
    if (goal.completedAt) continue;
    const walk = (nodes: Goal['nodes']): void => {
      for (const n of nodes) {
        if (n.children && n.children.length > 0) { walk(n.children); continue; }
        if (isDone(n)) continue;
        for (const b of blocksOf(n)) {
          if (b.date >= today) continue;
          out.push({
            kind: 'step',
            id: n.id,
            blockId: b.id,
            goalId: goal.id,
            goalTitle: goal.title,
            title: n.title,
            from: b.date,
            minutes: b.minutes,
          });
        }
      }
    };
    walk(goal.nodes);
  }

  for (const t of tasks) {
    if (t.done) continue;
    for (const b of blocksOf(t)) {
      if (b.date >= today) continue;
      out.push({
        kind: 'task',
        id: t.id,
        blockId: b.id,
        goalId: t.goalId,
        goalTitle: goals.find((g) => g.id === t.goalId)?.title ?? '',
        title: t.title,
        from: b.date,
        minutes: b.minutes,
      });
    }
  }

  // Oldest first: the thing that slipped furthest has waited longest, and a
  // proposal that fills Monday with Friday's work is not a recovery.
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

export interface ReplanInput {
  goals: Goal[];
  tasks: Task[];
  today: string;
  windows: AvailabilityWindow[];
  blocks: BusyBlock[];
  allDayBlocks: boolean;
  now: Now;
}

/**
 * Where each slipped item would land.
 *
 * The proposals are built against a growing map of what the EARLIER proposals
 * in this same run have taken. Without it every item is offered the same first
 * gap, the preview shows five tasks all landing at Monday 09:00, and applying
 * it either overlaps them or silently drops four — which is the "nothing moves
 * silently" rule broken by the flow that exists to enforce it.
 */
export function proposeReplan(input: ReplanInput): ReplanProposal {
  const { goals, tasks, today, windows, blocks, allDayBlocks, now } = input;
  const slipped = slippedWork(goals, tasks, today);
  const moves: ReplanMove[] = [];
  const unplaceable: SlippedItem[] = [];

  /** Spans taken on each day: what is really there, plus what we have proposed. */
  const taken = new Map<string, PlacedSpan[]>();
  const spansFor = (date: string): PlacedSpan[] => {
    const existing = taken.get(date);
    if (existing) return existing;
    const real = scheduledOn(goals, tasks, date)
      .filter((i) => !i.done)
      .map((i) => ({ startMin: i.startMin, endMin: i.endMin }));
    taken.set(date, real);
    return real;
  };

  for (const item of slipped) {
    let placed = false;
    for (let i = 0; i < REPLAN_HORIZON_DAYS; i += 1) {
      const date = addDays(today, i);
      const startMin = resolveSlot({
        date,
        aimMin: 0, // the earliest gap that fits, inside the window below
        durationMin: item.minutes,
        /*
         * The availability window, deliberately — this is the one placement
         * path Job 1 does NOT open up. A replan PROPOSES hours on your behalf,
         * and the same reasoning that keeps it out of the past ("proposing you
         * do something yesterday is nonsense") keeps it out of 03:00: a
         * proposal that ignores when you said you work is not a recovery, it is
         * a shuffle. A person placing a block by hand is not proposing
         * anything, which is why every manual route now searches `WHOLE_DAY`.
         *
         * A day with no window is skipped, exactly as before — `resolveSlot`
         * returns null on a null span and the loop moves to the next day.
         */
        span: windowForDate(date, windows),
        blocks,
        placed: spansFor(date),
        now,
        allDayBlocks,
      });
      if (startMin === null) continue;
      spansFor(date).push({ startMin, endMin: startMin + item.minutes });
      moves.push({ ...item, to: date, startMin });
      placed = true;
      break;
    }
    if (!placed) unplaceable.push(item);
  }

  return { moves, unplaceable };
}

/** Total minutes a proposal would move. The headline of the preview. */
export function proposalMinutes(proposal: ReplanProposal): number {
  return proposal.moves.reduce((n, m) => n + m.minutes, 0);
}
