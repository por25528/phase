import type { GoalNode, WorkBlock } from '../db/types';
import { clockLabel } from './clock';
import { addDays, fmtD, parseD } from './dates';
import { isDone } from './status';
import { sortedBlocks, type Placeable } from './blocks';
import { weekOf } from './plan';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The one thing a task row says about WHEN, in one cell.
 *
 * A node carries four separate temporal fields — `plannedStartMin`,
 * `plannedDay`, `plannedWeek` and `deadline` — and until now the row showed
 * none of them. All four at once would be four columns of mostly-empty
 * metadata, so this collapses them into a single answer, most specific first:
 * an actual time beats a day, a day beats a week, and a commitment of any kind
 * beats a deadline, because "when will I do this" is a more useful thing for a
 * row to say than "when is it due" once you have answered the first.
 *
 * `tone` is `warn` only where the row is genuinely late. Deadlines that are
 * merely approaching get no colour: a row that is orange for a week stops being
 * read as a warning, which is the whole reason the app has one warning colour.
 */
export interface ScheduleCell {
  text: string;
  tone: 'muted' | 'warn';
  /** The long form, for a title attribute — the cell itself is terse. */
  hint: string;
}

/** 'Today', 'Tomorrow', a weekday inside the next week, else 'Aug 24'. */
export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  if (date > today && date < addDays(today, 7)) return DOW[parseD(date).getDay()];
  return fmtD(date);
}

/**
 * The one sitting that represents a task, when it has any.
 *
 * A task can be sat several times, so "when" is a run of dates. This picks the
 * next one still ahead — including today — and falls back to the last overdue
 * sitting only once every sitting is in the past, so a task done last week and
 * booked again for Tuesday reads as Tuesday, not as its own history.
 *
 * `scheduleCell` (the tree row) and `TaskPage` (the leaf's own page) both need
 * this exact choice; they differ only in what they do once nothing is booked —
 * the row falls back to `plannedWeek` and then `deadline`, the page stops here
 * because it already shows the deadline as its own chip. Keeping the picker
 * itself shared is what stops the two surfaces from disagreeing about a task
 * that has both a past and a future sitting.
 */
export function nextSitting(item: Placeable, today: string): WorkBlock | null {
  const blocks = sortedBlocks(item);
  if (blocks.length === 0) return null;
  const overdue = blocks.filter((b) => b.date < today);
  return blocks.find((b) => b.date >= today) ?? overdue[overdue.length - 1];
}

export function scheduleCell(n: GoalNode, today: string): ScheduleCell | null {
  // A finished task's schedule is history. Showing "Tue 14:00" beside a ticked
  // box reads as work still to come, on the one row that has none left.
  if (isDone(n)) return null;

  // The NEXT sitting, and how many more there are: `Tue 14:00 +2` says the
  // same thing as three chips and leaves the column a column.
  const blocks = sortedBlocks(n);
  const next = nextSitting(n, today);
  if (next) {
    const late = next.date < today;
    const more = blocks.length - 1;
    const time = ` ${clockLabel(next.startMin)}`;
    return {
      text: `${dayLabel(next.date, today)}${time}${more > 0 ? ` +${more}` : ''}`,
      tone: late ? 'warn' : 'muted',
      hint: late
        ? `Was scheduled for ${fmtD(next.date)} and has not been done`
        : `Scheduled for ${fmtD(next.date)}${time}${more > 0 ? `, and ${more} more sitting${more === 1 ? '' : 's'}` : ''}`,
    };
  }

  if (n.plannedWeek !== undefined) {
    const thisWeek = n.plannedWeek === weekOf(today);
    return {
      text: thisWeek ? 'This week' : `Wk ${fmtD(n.plannedWeek)}`,
      // Committed to a week that has been and gone is exactly the carry-over
      // the recovery flow exists for, so it is worth a colour.
      tone: n.plannedWeek < weekOf(today) ? 'warn' : 'muted',
      hint: `Committed to the week of ${fmtD(n.plannedWeek)}, not yet placed on a day`,
    };
  }

  if (n.deadline !== undefined) {
    const overdue = n.deadline < today;
    return {
      text: overdue ? `Overdue ${fmtD(n.deadline)}` : `Due ${dayLabel(n.deadline, today)}`,
      tone: overdue ? 'warn' : 'muted',
      hint: overdue ? `Was due ${fmtD(n.deadline)}` : `Due ${fmtD(n.deadline)}`,
    };
  }

  return null;
}
