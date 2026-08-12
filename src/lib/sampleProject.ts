import type { Goal, GoalNode } from '../db/types';
import { addDays } from './dates';
import { weekOf } from './plan';

// A seeded, deletable example so a cold board teaches its own model instead of
// leaving a first-timer guessing how deep to decompose. It demonstrates the three
// things the audit said were invisible on day one:
//   • leaves are the concrete actions you check off (the % only moves on a tick),
//   • a container ("Problem 3") groups several leaves without touching the %,
//   • one open leaf is committed to this week but left in the backlog (no
//     plannedDay, no plannedStartMin) — the sample can't know the user's
//     availability, so it doesn't guess a day or a clock time. That leaf
//     surfaces in the planner's backlog rail, and dragging it onto the grid is
//     meant to be the user's first action under the calendar-grid model.
// Dates are confirmed and relative to `today`, so it never trips the
// unconfirmed-dates banner and always reads as "current".

export const SAMPLE_PROJECT_TITLE = 'Finish Pset 7 (example)';

export function sampleProject(today: string, makeId: () => string): Goal {
  const thisWeek = weekOf(today);
  const nodes: GoalNode[] = [
    { id: makeId(), title: 'Problem 1: recursion', status: 'done', doneAt: addDays(today, -3) },
    { id: makeId(), title: 'Problem 2: graph search', status: 'done', doneAt: addDays(today, -1) },
    {
      id: makeId(),
      title: 'Problem 3: dynamic programming',
      children: [
        { id: makeId(), title: 'Write the recurrence', plannedWeek: thisWeek },
        { id: makeId(), title: 'Implement + memoize' },
        { id: makeId(), title: 'Test against the provided cases' },
      ],
    },
    { id: makeId(), title: 'Write up + submit' },
  ];
  return {
    id: makeId(),
    title: SAMPLE_PROJECT_TITLE,
    column: 0,
    start: today,
    deadline: addDays(today, 12),
    datesConfirmed: true,
    notes:
      'A seeded example so you can see how a goal decomposes. Leaves (the '
      + 'checkboxes) are the concrete tasks — the % only moves when you tick one. '
      + 'An area like "Problem 3" just groups several tasks. Delete this goal '
      + 'whenever you like.',
    nodes,
  };
}
