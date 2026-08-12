import type { GoalNode, Task, WorkBlock } from '../db/types';
import { normalizeEstimate } from './capacity';
import { uid } from './tree';

/**
 * The one vocabulary for a task's sittings.
 *
 * `plannedDay`/`plannedStartMin` (leaves) and `startMin` (tasks) used to be read
 * directly in three dozen files, which is exactly why replacing them with a list
 * touched three dozen files. Everything goes through here now, so the next
 * change to how a placement is stored is one module wide.
 *
 * The rule this module exists to hold: **`blocks` is absent, never `[]`.**
 * Presence is what "is this placed" means, and an empty array is the same
 * legacy-leaf ambiguity `GoalNode.children` already suffers — a node whose last
 * block was removed must be indistinguishable from one that never had any.
 */
export type Placeable = GoalNode | Task;

const EMPTY: readonly WorkBlock[] = [];

export function blocksOf(item: Placeable): readonly WorkBlock[] {
  return item.blocks ?? EMPTY;
}

/** Placed at a real time — the predicate `scheduledOn` partitions on. */
export function isPlaced(item: Placeable): boolean {
  return blocksOf(item).length > 0;
}

/** Earliest sitting, by day then minute. What a single-block reader wants. */
export function firstBlock(item: Placeable): WorkBlock | undefined {
  return sortedBlocks(item)[0];
}

export function sortedBlocks(item: Placeable): WorkBlock[] {
  return [...blocksOf(item)].sort(
    (a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin,
  );
}

export function blocksOn(item: Placeable, date: string): WorkBlock[] {
  return blocksOf(item).filter((b) => b.date === date);
}

/** Total time set aside, across every sitting. */
export function plannedMinutes(item: Placeable): number {
  return blocksOf(item).reduce((n, b) => n + b.minutes, 0);
}

/**
 * How the planned sittings compare to the estimate.
 *
 * Null when there is nothing to compare — no estimate, or nothing placed. This
 * is the discrepancy the spec asks for ("if planned sessions exceed the
 * estimate, show a quiet discrepancy indicator"), and it is only expressible
 * because a block owns its own `minutes`.
 */
export function planVsEstimate(item: Placeable): { planned: number; estimate: number } | null {
  const estimate = normalizeEstimate(item.estimateMin);
  if (estimate === undefined || !isPlaced(item)) return null;
  return { planned: plannedMinutes(item), estimate };
}

export function makeBlock(date: string, startMin: number, minutes: number): WorkBlock {
  return { id: `b_${uid()}`, date, startMin, minutes };
}

/**
 * Mutating helpers. They take the node/task from an already-cloned tree, in the
 * same style as `setPlannedSlot`, because the store owns cloning.
 */
export function addBlock(item: Placeable, block: WorkBlock): void {
  item.blocks = [...blocksOf(item), block];
}

/** Replace every sitting with one. The old single-slot write, exactly. */
export function setOnlyBlock(item: Placeable, block: WorkBlock): void {
  item.blocks = [block];
}

export function replaceBlock(item: Placeable, blockId: string, next: Partial<WorkBlock>): void {
  const kept = blocksOf(item).map((b) => (b.id === blockId ? { ...b, ...next } : b));
  item.blocks = [...kept];
}

export function removeBlock(item: Placeable, blockId: string): void {
  const kept = blocksOf(item).filter((b) => b.id !== blockId);
  if (kept.length === 0) delete item.blocks;
  else item.blocks = kept;
}

export function clearBlocks(item: Placeable): void {
  delete item.blocks;
}
