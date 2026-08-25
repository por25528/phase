import type { Goal, GoalNode, Task } from '../db/types';

/**
 * How much of you a piece of work wants.
 *
 * The second axis. `timeLens` asks how long something takes and has three
 * kinds of evidence for it — history, an estimate, a starter. Nothing measured
 * how HARD it was, so a twenty-minute expense claim and a twenty-minute "decide
 * the data model" were the same size and the same offer.
 *
 * The words are deliberately NOT the dial's words. The dial reads
 * `Low / Medium / High` and means capability; this reads `Light / Moderate /
 * Deep` and means requirement. They are opposite poles of one scale, and a chip
 * reading `Low` on a row could be read either way — the same reason
 * `expectedTimeLabel` prefixes `Usually / Planned / Suggested` rather than
 * printing a bare figure.
 */

export type Demand = 'light' | 'moderate' | 'deep';

/** Ascending, and the order every selector renders in. */
export const DEMANDS: readonly Demand[] = ['light', 'moderate', 'deep'];

export const DEMAND_WORD: Record<Demand, string> = {
  light: 'Light',
  moderate: 'Moderate',
  deep: 'Deep',
};

/** Compared against `FOCUS_ADMITS`. Monotone, so a dial is a dial. */
export const DEMAND_RANK: Record<Demand, number> = {
  light: 1,
  moderate: 2,
  deep: 3,
};

export function isDemand(raw: unknown): raw is Demand {
  return raw === 'light' || raw === 'moderate' || raw === 'deep';
}

/**
 * A resolved value and where it came from.
 *
 * `source` is required rather than convenient: it is what lets a tree row draw
 * a chip only where a value was SET — a `deep` goal painting `Deep` onto all
 * thirty of its leaves is a column that says one word thirty times — while a
 * page states the resolved value in full and names the ancestor it came from.
 */
export interface ResolvedDemand {
  level: Demand;
  source: 'own' | 'inherited';
}

/**
 * Every node's demand, resolved from its nearest tagged ancestor.
 *
 * ONE pass, deliberately. `findNodePath` would answer the same question per
 * node but is O(n) per call, which would make the shelf O(n²) in the size of a
 * goal; `walkLeaves` cannot be reused because it visits leaves only and hands
 * the visitor no ancestor context.
 *
 * Nothing is written down. A node indented under a `deep` container re-resolves
 * on the next paint, exactly as `isLeafNode`/`isContainerNode` are computed at
 * render rather than stored.
 *
 * Untagged nodes are ABSENT from the map rather than present-and-undefined:
 * absence is the whole meaning of "made no claim".
 */
export function demandIndex(goals: Goal[]): Map<string, ResolvedDemand> {
  const out = new Map<string, ResolvedDemand>();
  function walk(nodes: GoalNode[], inherited: Demand | undefined): void {
    for (const n of nodes) {
      const level = n.demand ?? inherited;
      if (level !== undefined) {
        out.set(n.id, { level, source: n.demand === undefined ? 'inherited' : 'own' });
      }
      if (n.children?.length) walk(n.children, level);
    }
  }
  for (const g of goals) walk(g.nodes, g.demand);
  return out;
}

/**
 * A task's demand — its own or nothing.
 *
 * `Task.goalId` is documented "tag FOR CONTEXT ONLY", the same phrase
 * `Habit.goalId` and `Session.goalId` carry. It is not a parent link, so there
 * is nothing here to inherit from.
 */
export function taskDemand(task: Task): ResolvedDemand | undefined {
  return task.demand === undefined ? undefined : { level: task.demand, source: 'own' };
}
