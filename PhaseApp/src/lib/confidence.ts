import type { Confidence, Goal, GoalNode } from '../db/types';
import { daysBetween } from './timeline';

export type { Confidence };

/**
 * The one vocabulary for a topic's confidence, the way `status.ts` is the one
 * vocabulary for a step's status. Readers go through this module and never
 * touch `confidence` / `confidenceAt` directly.
 *
 * A topic is a leaf beneath a node carrying `topics: true`. It is never done;
 * it is `shaky`, `okay` or `solid`, or it has not been rated. The words are
 * about the STUDENT ("how solid is this now?"), not the work, which is why
 * they are not the demand words or the focus words.
 */

/** Ascending, and the order every control renders in. */
export const CONFIDENCES: readonly Confidence[] = ['shaky', 'okay', 'solid'];

export const CONFIDENCE_WORD: Record<Confidence, string> = {
  shaky: 'Shaky',
  okay: 'Okay',
  solid: 'Solid',
};

/** Unrated is 0 and is not in this table — see `confidenceRank`. Monotone. */
export const CONFIDENCE_RANK: Record<Confidence, number> = {
  shaky: 1,
  okay: 2,
  solid: 3,
};

/**
 * What a topic is worth to the roll-up: the fraction of "done" a rating
 * stands for. Linear on purpose — three even steps are the only reading a
 * three-word scale can defend.
 */
export const CONFIDENCE_WEIGHT: Record<Confidence, number> = {
  shaky: 1 / 3,
  okay: 2 / 3,
  solid: 1,
};

export function isConfidence(raw: unknown): raw is Confidence {
  return raw === 'shaky' || raw === 'okay' || raw === 'solid';
}

function isLeaf(n: GoalNode): boolean {
  return !n.children || n.children.length === 0;
}

/**
 * The ids of every topic in a goal — every LEAF beneath a `topics` node, at
 * any depth. The flag on an empty (leaf) area names nothing: an area with no
 * rows in it has no topics yet.
 */
export function topicIds(g: Goal): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: GoalNode[], inTopics: boolean): void => {
    for (const n of nodes) {
      const here = inTopics || n.topics === true;
      if (isLeaf(n)) {
        if (here && n.topics !== true) out.add(n.id);
        continue;
      }
      walk(n.children!, here);
    }
  };
  walk(g.nodes, false);
  return out;
}

export function isTopic(g: Goal, nodeId: string): boolean {
  return topicIds(g).has(nodeId);
}

/** `null` for an unrated topic — and for half a rating, which is not one. */
export function topicConfidence(n: GoalNode): Confidence | null {
  if (!isConfidence(n.confidence) || typeof n.confidenceAt !== 'string') return null;
  return n.confidence;
}

/** Unrated → 0, then `CONFIDENCE_RANK`. */
export function confidenceRank(n: GoalNode): number {
  const c = topicConfidence(n);
  return c === null ? 0 : CONFIDENCE_RANK[c];
}

/**
 * The review order within ONE subject: unrated first, then shaky, okay,
 * solid; inside a tier the OLDEST rating first; ties keep the order given
 * (tree order). This is the only ranking the feature adds, and it ranks
 * inside a subject — which subject leads is `sortByDue`'s call, fed the exam
 * date, so there is never a second cross-project opinion.
 */
export function sortForReview(topics: GoalNode[]): GoalNode[] {
  return [...topics].sort((a, b) => {
    const byRank = confidenceRank(a) - confidenceRank(b);
    if (byRank !== 0) return byRank;
    const aAt = topicConfidence(a) === null ? '' : a.confidenceAt!;
    const bAt = topicConfidence(b) === null ? '' : b.confidenceAt!;
    return aAt < bAt ? -1 : aAt > bAt ? 1 : 0;
  });
}

export interface Readiness {
  topics: number;
  unrated: number;
  shaky: number;
  okay: number;
  solid: number;
}

export function readiness(g: Goal): Readiness {
  const ids = topicIds(g);
  const r: Readiness = { topics: 0, unrated: 0, shaky: 0, okay: 0, solid: 0 };
  const walk = (nodes: GoalNode[]): void => {
    for (const n of nodes) {
      if (!isLeaf(n)) { walk(n.children!); continue; }
      if (!ids.has(n.id)) continue;
      r.topics += 1;
      const c = topicConfidence(n);
      if (c === null) r.unrated += 1;
      else r[c] += 1;
    }
  };
  walk(g.nodes);
  return r;
}

/** `3 of 8 topics solid` · `All 8 topics solid` · `8 topics, none rated yet` — `null` with no topics. */
export function describeReadiness(r: Readiness): string | null {
  if (r.topics === 0) return null;
  const noun = `topic${r.topics === 1 ? '' : 's'}`;
  if (r.solid === r.topics) return `All ${r.topics} ${noun} solid`;
  if (r.unrated === r.topics) return `${r.topics} ${noun}, none rated yet`;
  return `${r.solid} of ${r.topics} ${noun} solid`;
}

/**
 * Pure. Returns a copy with both fields written, or both removed for `null`.
 * The store copies the result back key by key, exactly as `writeStatus` does
 * for `applyStatus`, because assigning a copy over the live node would keep
 * the keys the copy dropped.
 */
export function applyConfidence(n: GoalNode, next: Confidence | null, today: string): GoalNode {
  const out: GoalNode = { ...n };
  if (next === null) {
    delete out.confidence;
    delete out.confidenceAt;
  } else {
    out.confidence = next;
    out.confidenceAt = today;
  }
  return out;
}

/** `today` / `yesterday` / `3 days ago` for a rated topic; `null` for an unrated one. */
export function ratedWhenLabel(n: GoalNode, today: string): string | null {
  if (topicConfidence(n) === null) return null;
  const days = daysBetween(n.confidenceAt!, today);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/** `solid, rated 3 days ago` / `not rated yet` — for aria labels and captions. */
export function topicAgeLabel(n: GoalNode, today: string): string {
  const c = topicConfidence(n);
  if (c === null) return 'not rated yet';
  return `${c}, rated ${ratedWhenLabel(n, today)}`;
}
