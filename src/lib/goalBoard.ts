import type { Goal, GoalNode, StepStatus } from '../db/types';
import { stepStatus } from './status';

/**
 * The goal's tasks, arranged by workflow state.
 *
 * This is a PROJECTION, not a second structure. Every card is a leaf that
 * already exists in the tree, addressed by the same id, and the only thing a
 * drag changes is `status` — the one dimension the columns represent. A board
 * that owned its own array of cards would be a second source of truth for the
 * same work, which is the failure mode the spec names explicitly.
 *
 * The columns are the four states the model actually stores. The spec asks for
 * `Backlog → Ready → In progress → Done`, and Ready is a genuinely useful
 * distinction — but Phase has never recorded it, so a Backlog column would be
 * either always empty or a lie about where work sits. Splitting `todo` in two
 * is a data change that has to earn itself; until it does, the board shows what
 * is true. `blocked` gets its own column rather than a flag, for the same
 * reason: it IS a stored state here, and hiding a stored state inside another
 * column's card is how a board stops matching the tree beside it.
 */
export const BOARD_COLUMNS: { status: StepStatus; title: string; hint: string }[] = [
  { status: 'todo', title: 'To do', hint: 'Open, not started' },
  { status: 'doing', title: 'In progress', hint: 'Actively being worked on' },
  { status: 'blocked', title: 'Blocked', hint: 'Waiting on something else' },
  { status: 'done', title: 'Done', hint: 'Finished' },
];

/**
 * How many tasks may sit in In progress before the column says something.
 *
 * A warning, never a refusal. A hard block would be the board deciding it knows
 * better than the person about a Tuesday, and the only way past it would be to
 * lie about a status.
 */
export const WIP_LIMIT = 3;

/**
 * Below this many open tasks a board is worse than the tree: four columns of
 * one card each is more chrome than content, and the tree already shows order,
 * which is what small goals are organised by.
 */
export const BOARD_MIN_OPEN_TASKS = 5;

export interface BoardCard {
  node: GoalNode;
  /** The containers above it, outermost first — the card's breadcrumb. */
  areaPath: string[];
  /** The id of the outermost container, for filtering. Null at the root. */
  areaId: string | null;
}

export interface BoardColumn {
  status: StepStatus;
  title: string;
  hint: string;
  cards: BoardCard[];
}

/** Every leaf, with the containers above it. Containers are never cards. */
export function boardCards(goal: Goal): BoardCard[] {
  const out: BoardCard[] = [];
  const walk = (nodes: GoalNode[], path: string[], areaId: string | null): void => {
    for (const n of nodes) {
      if (n.children && n.children.length > 0) {
        walk(n.children, [...path, n.title], areaId ?? n.id);
        continue;
      }
      out.push({ node: n, areaPath: path, areaId });
    }
  };
  walk(goal.nodes, [], null);
  return out;
}

/** The top-level containers, which are what the filter row offers. */
export function boardAreas(goal: Goal): { id: string; title: string }[] {
  return goal.nodes
    .filter((n) => n.children && n.children.length > 0)
    .map((n) => ({ id: n.id, title: n.title }));
}

export function goalBoard(goal: Goal, areaId: string | null = null): BoardColumn[] {
  const cards = boardCards(goal).filter((c) => areaId === null || c.areaId === areaId);
  return BOARD_COLUMNS.map((col) => ({
    ...col,
    cards: cards.filter((c) => stepStatus(c.node) === col.status),
  }));
}

/** Whether a board is the better view of this goal right now. */
export function boardIsUseful(goal: Goal): boolean {
  const open = boardCards(goal).filter((c) => stepStatus(c.node) !== 'done');
  return open.length >= BOARD_MIN_OPEN_TASKS;
}
