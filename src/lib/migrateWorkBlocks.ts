import type { Goal, GoalNode, Task } from '../db/types';
import { cloneGoals } from './tree';
import { durationOf } from './slot';
import { makeBlock } from './blocks';
import { weekOf } from './plan';

/**
 * Move the one placement a leaf or task could hold into its `blocks` list.
 *
 * Runs on load AND on import, and reads the RAW legacy fields off stored JSON —
 * exactly as `migrateNodeStatus` does, and for the same reason: the fields are
 * gone from the type, so the only way to read them is to admit they were once
 * there. That is deliberate, not something to "clean up".
 *
 * The conversion is total and lossless in the direction that matters:
 *
 * - `plannedDay` + `plannedStartMin` → one block of `durationOf(estimateMin)`,
 *   which is the length that block was already being DRAWN at. Its height on
 *   the grid does not change; it just stopped being re-derived on every read.
 * - `plannedWeek` stays. It is the week COMMITMENT, a different fact from a
 *   placement, and the rail's "to place" bucket is exactly the leaves that have
 *   one without the other.
 * - `plannedDay` with no `plannedStartMin` — "committed to that day, not placed"
 *   — degrades to a WEEK commitment rather than becoming a block at midnight.
 *   Inventing a time is how a migration silently moves someone's Tuesday, and
 *   dropping the day outright would lose a commitment the rail was listing. The
 *   new model has no day-level commitment for a leaf, so the week is the
 *   nearest true thing, and the rail lists it either way.
 * - A task keeps `date` for the same reason a leaf keeps `plannedWeek`: `⌘N`
 *   with `@friday` produces a commitment with no time, and that has to survive.
 *
 * Idempotent: a node that already has `blocks` is left alone, so a re-run after
 * a failed flag write costs nothing.
 */
export interface WorkBlockMigrationReport {
  nodes: number;
  tasks: number;
}

/** The shape of a node as it exists in storage written before this migration. */
type LegacyNode = GoalNode & { plannedDay?: string; plannedStartMin?: number };
type LegacyTask = Task & { startMin?: number };

function migrateNode(raw: GoalNode, report: WorkBlockMigrationReport): void {
  const n = raw as LegacyNode;
  if (n.children && n.children.length > 0) {
    n.children.forEach((child) => migrateNode(child, report));
    // A container never held a placement — `addChild` cleared the slot when it
    // converted a leaf — but strip any legacy fields all the same.
    delete n.plannedDay;
    delete n.plannedStartMin;
    return;
  }

  const day = n.plannedDay;
  const startMin = n.plannedStartMin;
  delete n.plannedDay;
  delete n.plannedStartMin;

  if (n.blocks !== undefined) return; // already migrated
  if (day === undefined) return;
  if (startMin === undefined) {
    n.plannedWeek ??= weekOf(day);
    return;
  }

  n.blocks = [makeBlock(day, startMin, durationOf(n.estimateMin))];
  report.nodes += 1;
}

export function migrateWorkBlocks(
  goals: Goal[],
  tasks: Task[],
): { goals: Goal[]; tasks: Task[]; report: WorkBlockMigrationReport } {
  const report: WorkBlockMigrationReport = { nodes: 0, tasks: 0 };

  const nextGoals = cloneGoals(goals);
  for (const g of nextGoals) g.nodes.forEach((n) => migrateNode(n, report));

  const nextTasks = tasks.map((raw) => {
    const t = { ...raw } as LegacyTask;
    const startMin = t.startMin;
    delete t.startMin;
    if (t.blocks !== undefined || t.date === undefined || startMin === undefined) return t as Task;
    t.blocks = [makeBlock(t.date, startMin, durationOf(t.estimateMin))];
    report.tasks += 1;
    return t as Task;
  });

  return { goals: nextGoals, tasks: nextTasks, report };
}
