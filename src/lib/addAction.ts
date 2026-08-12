/**
 * What the header's `+ Add` creates, given where the user is standing.
 *
 * It always opened task capture, on every surface. On Goals that is the one
 * thing the page cannot show you afterwards — a loose task does not appear on
 * a board of goals — so the most prominent button in the app produced an
 * invisible result on the screen most likely to be showing when a new goal is
 * wanted.
 *
 * The rule is "create the thing this surface is made of":
 *
 *   Goals   → a goal
 *   a goal  → a task in it
 *   Plan    → a task
 *   Today   → a task
 *
 * Only the DEFAULT changes. Every verb stays reachable from `⌘K`, which is
 * where a second option belongs — a split button offering both on every
 * surface would be the "expose more options after opening" the brief warns
 * about, paid for on every visit.
 */

import type { ViewName } from '../state/store';

export type AddIntent = 'goal' | 'task' | 'node';

export interface AddAction {
  intent: AddIntent;
  /** The button's own caption — it names what pressing it makes. */
  label: string;
  /** The accessible name, which also carries the shortcut. */
  title: string;
}

const TASK_ACTION: AddAction = { intent: 'task', label: 'Add', title: 'Add a task (⌘N)' };

export function addActionFor(view: ViewName, insideGoal: boolean): AddAction {
  if (view === 'goals') {
    return { intent: 'goal', label: 'New goal', title: 'New goal (⌘N)' };
  }
  // The project page is the one surface where the goal is already chosen, so
  // the task can go straight into it rather than into the loose pile.
  if (view === 'project' && insideGoal) {
    return { intent: 'node', label: 'Add task', title: 'Add a task to this goal (⌘N)' };
  }
  return TASK_ACTION;
}
