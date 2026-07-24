import type { Goal, GoalNode } from '../db/types';
import { addDays } from './dates';
import { weekOf } from './plan';

// A seeded, deletable example so a cold board teaches its own model instead of
// leaving a first-timer guessing how deep to decompose. It demonstrates the three
// things the audit said were invisible on day one:
//   • leaves are the concrete actions you check off (the % only moves on a tick),
//   • a container ("Problem 3") groups several leaves without touching the %,
//   • one open leaf is pinned to today, so Today isn't dim before the first plan.
// Dates are confirmed and relative to `today`, so it never trips the
// unconfirmed-dates banner and always reads as "current".

export const SAMPLE_PROJECT_TITLE = 'Finish Pset 7 (example)';

export function sampleProject(today: string, makeId: () => string): Goal {
  const thisWeek = weekOf(today);
  const nodes: GoalNode[] = [
    { id: makeId(), title: 'Problem 1: recursion', done: true, doneAt: addDays(today, -3) },
    { id: makeId(), title: 'Problem 2: graph search', done: true, doneAt: addDays(today, -1) },
    {
      id: makeId(),
      title: 'Problem 3: dynamic programming',
      children: [
        { id: makeId(), title: 'Write the recurrence', done: false, plannedWeek: thisWeek, plannedDay: today },
        { id: makeId(), title: 'Implement + memoize', done: false },
        { id: makeId(), title: 'Test against the provided cases', done: false },
      ],
    },
    { id: makeId(), title: 'Write up + submit', done: false },
  ];
  return {
    id: makeId(),
    title: SAMPLE_PROJECT_TITLE,
    column: 0,
    start: today,
    deadline: addDays(today, 12),
    datesConfirmed: true,
    notes:
      'A seeded example so you can see how a project decomposes. Leaves (the '
      + 'checkboxes) are the concrete actions — the % only moves when you tick one. '
      + 'A container like "Problem 3" just groups several leaves. Delete this project '
      + 'whenever you like.',
    nodes,
  };
}
