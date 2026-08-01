import type { Goal } from '../db/types';
import { milestonesToCheckpointNodes } from './checkpoints';

export interface CheckpointMigrationReport {
  goalsMigrated: number;
  checkpointsCreated: number;
}

/**
 * Replace legacy goal milestones with real root-level checkpoint nodes.
 *
 * A migrated goal is rebuilt only when it carries the legacy field, so a no-op
 * migration preserves the original goals and goal objects by identity. Removing
 * the legacy field makes a second run harmless and is what makes retrying after
 * a crash or a failed done-flag write idempotent.
 */
export function migrateCheckpoints(
  goals: Goal[],
): { goals: Goal[]; report: CheckpointMigrationReport } {
  const report: CheckpointMigrationReport = { goalsMigrated: 0, checkpointsCreated: 0 };
  let changed = false;

  const nextGoals = goals.map((goal) => {
    const hasLegacyField = Object.prototype.hasOwnProperty.call(goal, 'milestones');
    const checkpoints = milestonesToCheckpointNodes(goal);
    if (!hasLegacyField) return goal;

    changed = true;
    report.goalsMigrated++;
    report.checkpointsCreated += checkpoints.length;
    const migrated = { ...goal, nodes: [...goal.nodes, ...checkpoints] };
    delete (migrated as Goal & { milestones?: unknown }).milestones;
    return migrated;
  });

  return { goals: changed ? nextGoals : goals, report };
}
