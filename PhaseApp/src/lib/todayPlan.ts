import type { BusyBlock, Goal, Task } from '../db/types';
import type { Now } from './capacity';
import { longestFreeGap, ORDINARY_DAY, type PlacedSpan } from './slot';
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
 * So the empty day becomes the planning moment. One row per project, the room
 * that is actually left on the day, and a click that books it.
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
  /** The widest unbooked RUN inside the ordinary day. See `nextFreeDay`. */
  gapMin: number;
}

export type TodayPlan =
  /** Nothing to offer, or nowhere inside the horizon to put it. */
  | { kind: 'none' }
  | { kind: 'offer'; date: string; today: boolean; gapMin: number; rows: ProposalRow[] };

/**
 * The shortest run this surface will call room.
 *
 * A fifteen-minute crack between two meetings is not somewhere to start a
 * project task, and an offer you cannot act on is worse than no offer.
 */
export const MIN_SITTING_MIN = 30;

/**
 * The first day from `today` onward with an unbooked run long enough to sit
 * down in.
 *
 * `ORDINARY_DAY` and NOT `WHOLE_DAY`, deliberately. This is the app CHOOSING a
 * day on your behalf, and the button on the row it produces places the work
 * automatically — so the region it measures has to be the region that
 * placement aims at, or the offer names a day whose only room is at 3am. A
 * manual drag is measured against `WHOLE_DAY` instead; see `Plan.tsx`.
 *
 * It reports a RUN and never a sum, for the same reason `longestFreeGap` does:
 * three separate half-hours are not an hour of room.
 *
 * `remainingSpan` inside `longestFreeGap` already clips the elapsed part of
 * today, so 19:00 rolls forward with no special case for "the evening" — only
 * the scan is new.
 */
export function nextFreeDay(
  today: string,
  blocks: BusyBlock[],
  placedOn: (date: string) => PlacedSpan[],
  allDayBlocks: boolean,
  now: Now,
): FreeDay | null {
  for (let i = 0; i < PLAN_DAY_HORIZON; i++) {
    const date = addDays(today, i);
    const gapMin = longestFreeGap(date, ORDINARY_DAY, blocks, placedOn(date), now, allDayBlocks);
    if (gapMin >= MIN_SITTING_MIN) return { date, gapMin };
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
 * One row per PROJECT — its first backlog item, which `backlogGroups` has
 * already sorted by urgency — then the projects themselves ordered by that
 * same near-deadline rule, so the row at the top is the one with a date on it.
 *
 * The loose bucket is the one exception, and for the same reason `backlogGroups`
 * treats it differently everywhere else: "Loose tasks" is not a project, it is
 * the bucket that means "belongs to no project". Rationing it to one row — the
 * rule that stops a single project's queue dominating — is exactly what put ONE
 * of nine open loose tasks on an otherwise empty page. So each loose task is its
 * own candidate, ordered by due like everything else; the `PROPOSAL_MAX` cap is
 * what still stops the section becoming a second backlog rail.
 */
export function proposalRows(
  goals: Goal[],
  tasks: Task[],
  week: string,
  today: string,
  exclude: ReadonlySet<string> = new Set(),
  /**
   * How many rows the caller can use. Today's page keeps `PROPOSAL_MAX` —
   * five is where a list stops being a decision — but the advisor asks for
   * more, because its pool is cut twice again (the lenses, then
   * `MAX_ALTERNATIVES`) and a pool pre-cut to five starves the undated tail,
   * which is exactly where every loose task lives.
   */
  max: number = PROPOSAL_MAX,
): ProposalRow[] {
  const candidates: { item: BacklogItem; goalTitle: string }[] = [];
  for (const group of backlogGroups(goals, tasks, week, today)) {
    const open = group.items.filter((i) => !exclude.has(`${i.kind}:${i.id}`));
    if (group.goalId === null) {
      for (const item of open) candidates.push({ item, goalTitle: group.goalTitle });
    } else if (open.length > 0) {
      candidates.push({ item: open[0], goalTitle: group.goalTitle });
    }
  }
  const ordered = sortByDue(candidates.map((f) => f.item), today);
  const titleFor = new Map(candidates.map((f) => [`${f.item.kind}:${f.item.id}`, f.goalTitle]));
  return ordered
    .slice(0, max)
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
 * is that it knows where the work is going. It reports a RUN rather than a
 * total, so the figure means "you could sit down for this long" — which is the
 * only reading a person can act on.
 *
 * "Today is booked" is about ROOM, not about commitments: a day can be full of
 * sittings and still have three unfinished things on it.
 */
export function offerHeading(
  offer: { date: string; today: boolean; gapMin: number },
  today: string,
): string {
  if (offer.today) return `${fmtMinutes(offer.gapMin)} open today`;
  return `Today is booked — ${dayLabel(offer.date, today)} has ${fmtMinutes(offer.gapMin)} open`;
}

export interface TodayPlanInput {
  goals: Goal[];
  tasks: Task[];
  blocks: BusyBlock[];
  /**
   * The sittings already on a date — `spansOn(goals, tasks, date)`, curried by
   * the caller.
   *
   * A function rather than a precomputed map because the scan stops at the
   * first day with room, which is almost always today: building seven days of
   * placements to read one of them is a walk of every goal's leaf tree, six
   * times for nothing.
   */
  placedOn: (date: string) => PlacedSpan[];
  allDayBlocks: boolean;
  today: string;
  week: string;
  now: Now;
  /** Keys (`${kind}:${id}`) the caller is already showing. */
  exclude?: ReadonlySet<string>;
  /**
   * How many rows the caller can use. Passed through to `proposalRows`.
   */
  max?: number;
}

export function todayPlan(input: TodayPlanInput): TodayPlan {
  const { goals, tasks, blocks, placedOn, allDayBlocks, today, week, now, exclude, max } = input;

  /*
   * There used to be a `no-hours` verdict here, checked before the candidates,
   * because "Phase does not know when you work" is actionable where "nothing
   * to do" is not. The state it named is gone — nothing is ever asked when you
   * work — so the only refusal left is a horizon with no room in it.
   */
  const rows = proposalRows(goals, tasks, week, today, exclude, max ?? PROPOSAL_MAX);
  if (rows.length === 0) return { kind: 'none' };

  const day = nextFreeDay(today, blocks, placedOn, allDayBlocks, now);
  if (!day) return { kind: 'none' };

  return {
    kind: 'offer',
    date: day.date,
    today: day.date === today,
    gapMin: day.gapMin,
    rows,
  };
}
