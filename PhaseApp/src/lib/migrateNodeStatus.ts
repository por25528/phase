import type { Goal, GoalNode } from '../db/types';

/**
 * Rewrite the legacy `done` boolean as a `status`, and drop half a rating.
 *
 * Total and unambiguous — `true` is 'done', anything else is 'todo', which is
 * stored as an absent field. So unlike migrateSlots and migrateCheckpoints this
 * needs no one-shot flag and no pre-migration snapshot: re-running it cannot
 * change anything a first run did not, and there is nothing to recover to.
 *
 * A node is rebuilt only when it carries the legacy field, so a no-op migration
 * returns the very same array and the very same objects. That identity is what
 * makes it cheap enough to run on every load and every import.
 */
export function migrateNodeStatus(goals: Goal[]): Goal[] {
  let changed = false;

  const migrateNode = (n: GoalNode): GoalNode => {
    const kids = n.children?.map(migrateNode);
    const kidsChanged = kids !== undefined && kids.some((k, i) => k !== n.children![i]);
    // An empty `children` array counts as a LEAF, not a container — the same
    // test `isLeaf` in status.ts and the roll-up in pct.ts use. `removeNode`
    // splices a container's last child and leaves `children: []` behind, and
    // `toggleLeaf` will happily tick that row — so treating it as a container
    // here silently dropped a legacy `done: true` on load, moving `goalPct`.
    const isContainer = (n.children?.length ?? 0) > 0;
    // A container never carries `status` — it is derived from its children
    // (see `containerStatus` in status.ts) — so a legacy `done` sitting on one
    // is stripped but never turned into a `status`, matching the leaves-only
    // contract the type declares.
    const hasLegacy = !isContainer && Object.prototype.hasOwnProperty.call(n, 'done');
    const hasLegacyOnContainer = isContainer && Object.prototype.hasOwnProperty.call(n, 'done');
    // Half a rating is not a rating: `confidence` and `confidenceAt` are
    // written together by `rateTopic`, so one without the other is a file
    // edited by hand or a write that was cut short, and both go.
    const halfRating = !isContainer
      && ((n.confidence !== undefined) !== (n.confidenceAt !== undefined));

    if (!hasLegacy && !hasLegacyOnContainer && !halfRating && !kidsChanged) return n;

    changed = true;
    const out = { ...n, ...(kids ? { children: kids } : {}) } as GoalNode & { done?: boolean };
    if (hasLegacy) {
      // Only set `status` when the node did not already carry one: an
      // already-migrated node that somehow still holds `done` must keep the
      // newer field as the truth.
      if (out.status === undefined && out.done === true) out.status = 'done';
      delete out.done;
    } else if (hasLegacyOnContainer) {
      delete out.done;
    }
    if (halfRating) {
      delete out.confidence;
      delete out.confidenceAt;
    }
    return out;
  };

  const next = goals.map((g) => {
    const nodes = g.nodes.map(migrateNode);
    return nodes.some((n, i) => n !== g.nodes[i]) ? { ...g, nodes } : g;
  });

  return changed ? next : goals;
}
