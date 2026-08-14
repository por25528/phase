import type { AvailabilityWindow, BusyBlock, Goal, Task } from '../db/types';
import { freeMinutes, type Now } from './capacity';
import { addDays, fmtD } from './dates';
import { fmtMinutes } from './effort';
import { backlogGroups, sortByDue, type BacklogItem } from './backlog';

/**
 * What Today offers when the day is unbooked.
 *
 * Today's three zones — Now, the rest of the day, the exceptions — are each
 * conditional on something carrying today's date. A user with real projects,
 * real open steps and real deadlines, who has simply not committed anything to
 * this week, got one grey sentence and a thousand pixels of nothing. That is
 * the wrong moment to go quiet: an empty day is precisely when "what should I
 * do now" needs an answer, and the answer "go and use Plan" is the morning
 * assembly this surface exists to end.
 *
 * So the empty day becomes the planning moment. One row per project, the free
 * time that is actually left, and a click that books it.
 *
 * The candidates come from `backlogGroups` and nothing else. The
 * `PLANNING_HORIZONS` gate, the parked-project commitment exception, the
 * blocked-work rule and the due ordering all already live there — reimplementing
 * any of them here is how the offer and the rail beside it start disagreeing
 * about what is worth doing.
 */

/**
 * How far ahead the offer will look for a day with room. A week: past that,
 * "when could I do this" is a planning question for the Plan grid, not a
 * suggestion to act on now.
 */
export const PLAN_DAY_HORIZON = 7;

/**
 * The most rows the offer will show. It is a choice between PROJECTS, not
 * between every open step — five is already the point at which a list stops
 * being a decision and starts being a backlog, which is the thing this must
 * not become.
 */
export const PROPOSAL_MAX = 5;

export interface ProposalRow {
  key: string;
  kind: 'step' | 'task';
  id: string;
  /** Absent for a loose task, which belongs to no project. */
  goalId?: string;
  title: string;
  goalTitle: string;
  estimateMin?: number;
  /** The one reason a row is allowed to carry, under `dueChip`'s rules. */
  due?: string;
}

export interface FreeDay {
  date: string;
  freeMin: number;
}

export type TodayPlan =
  /**
   * Availability was never set. A distinct verdict, not a zero: "Phase does not
   * know when you work" and "you are out of time today" are different sentences
   * and only one of them is true here — the same distinction `goalHealth` draws
   * with `no-forecast`.
   */
  | { kind: 'no-hours' }
  /** Nothing to offer, or nowhere inside the horizon to put it. */
  | { kind: 'none' }
  | { kind: 'offer'; date: string; today: boolean; freeMin: number; rows: ProposalRow[] };

/**
 * The first day from `today` onward that still has unbooked time.
 *
 * `remainingWindow` already reports nothing for a window that has closed, so
 * 19:00 on a Sunday rolls to Monday with no special case for "the evening" —
 * only the scan is new.
 */
export function nextFreeDay(
  today: string,
  windows: AvailabilityWindow[],
  blocks: BusyBlock[],
  allDayBlocks: boolean,
  now: Now,
): FreeDay | null {
  for (let i = 0; i < PLAN_DAY_HORIZON; i++) {
    const date = addDays(today, i);
    const freeMin = freeMinutes(date, windows, blocks, now, allDayBlocks);
    if (freeMin > 0) return { date, freeMin };
  }
  return null;
}

function row(item: BacklogItem, goalTitle: string): ProposalRow {
  return {
    key: `${item.kind}:${item.id}`,
    kind: item.kind,
    id: item.id,
    ...(item.goalId ? { goalId: item.goalId } : {}),
    title: item.title,
    goalTitle,
    ...(item.estimateMin === undefined ? {} : { estimateMin: item.estimateMin }),
    ...(item.due === undefined ? {} : { due: item.due }),
  };
}

/**
 * One row per project — its first backlog item, which `backlogGroups` has
 * already sorted by urgency — then the projects themselves ordered by that
 * same near-deadline rule, so the row at the top is the one with a date on it.
 */
export function proposalRows(
  goals: Goal[],
  tasks: Task[],
  week: string,
  today: string,
  exclude: ReadonlySet<string> = new Set(),
): ProposalRow[] {
  const firsts: { item: BacklogItem; goalTitle: string }[] = [];
  for (const group of backlogGroups(goals, tasks, week, today)) {
    const item = group.items.find((i) => !exclude.has(`${i.kind}:${i.id}`));
    if (item) firsts.push({ item, goalTitle: group.goalTitle });
  }
  const ordered = sortByDue(firsts.map((f) => f.item), today);
  const titleFor = new Map(firsts.map((f) => [`${f.item.kind}:${f.item.id}`, f.goalTitle]));
  return ordered
    .slice(0, PROPOSAL_MAX)
    .map((item) => row(item, titleFor.get(`${item.kind}:${item.id}`) ?? ''));
}

/**
 * The day the offer is talking about, said the way a person would. Shared by
 * the heading and the row labels, so what a screen reader hears and what the
 * heading says are the same day named the same way — `2026-07-16` is a date, not
 * a word.
 */
export function dayLabel(date: string, today: string): string {
  if (date === today) return 'today';
  if (date === addDays(today, 1)) return 'tomorrow';
  return fmtD(date);
}

/**
 * The same day, as a BUTTON says it.
 *
 * `dayLabel` is a fragment inside a sentence — `Plan “X” today` — so it is
 * lowercase. A button is not a sentence, and the carry-over verb one section
 * below already reads `Today`. Deriving this from `dayLabel` rather than
 * writing a second table is what stops the two verbs naming the same act two
 * different ways. `fmtD` is already capitalised, so the same rule covers all
 * three cases.
 */
export function dayVerb(date: string, today: string): string {
  const label = dayLabel(date, today);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * The one sentence above the rows.
 *
 * It always names the day the click will book, because the offer's whole claim
 * is that it knows where the work is going. "No time left today" is about free
 * time, not about commitments — a day can be booked solid and still have three
 * things left on it.
 */
export function offerHeading(
  offer: { date: string; today: boolean; freeMin: number },
  today: string,
): string {
  if (offer.today) return `${fmtMinutes(offer.freeMin)} free today`;
  return `No time left today — ${dayLabel(offer.date, today)} has ${fmtMinutes(offer.freeMin)} free`;
}

export interface TodayPlanInput {
  goals: Goal[];
  tasks: Task[];
  availability: AvailabilityWindow[];
  blocks: BusyBlock[];
  allDayBlocks: boolean;
  today: string;
  week: string;
  now: Now;
  /** Keys (`${kind}:${id}`) the caller is already showing. */
  exclude?: ReadonlySet<string>;
}

export function todayPlan(input: TodayPlanInput): TodayPlan {
  const { goals, tasks, availability, blocks, allDayBlocks, today, week, now, exclude } = input;
  // Checked before the candidates: with no hours set there is nothing useful to
  // say about having nothing to do, and one of the two answers is actionable.
  if (availability.length === 0) return { kind: 'no-hours' };

  const rows = proposalRows(goals, tasks, week, today, exclude);
  if (rows.length === 0) return { kind: 'none' };

  const day = nextFreeDay(today, availability, blocks, allDayBlocks, now);
  if (!day) return { kind: 'none' };

  return {
    kind: 'offer',
    date: day.date,
    today: day.date === today,
    freeMin: day.freeMin,
    rows,
  };
}
