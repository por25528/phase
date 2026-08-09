import type { GoalNode } from '../db/types';
import { clockLabel } from './clock';
import { addDays, fmtD, parseD } from './dates';
import { isDone } from './status';
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

export function scheduleCell(n: GoalNode, today: string): ScheduleCell | null {
  // A finished task's schedule is history. Showing "Tue 14:00" beside a ticked
  // box reads as work still to come, on the one row that has none left.
  if (isDone(n)) return null;

  if (n.plannedDay !== undefined) {
    const late = n.plannedDay < today;
    const time = n.plannedStartMin === undefined ? '' : ` ${clockLabel(n.plannedStartMin)}`;
    return {
      text: `${dayLabel(n.plannedDay, today)}${time}`,
      tone: late ? 'warn' : 'muted',
      hint: late
        ? `Was scheduled for ${fmtD(n.plannedDay)} and has not been done`
        : `Scheduled for ${fmtD(n.plannedDay)}${time}`,
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
