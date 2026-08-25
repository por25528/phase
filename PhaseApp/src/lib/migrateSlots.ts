import type { Goal, GoalNode, Task } from '../db/types';

/**
 * The pre-`WorkBlock` shape, spelled out.
 *
 * This migration repairs data written when a leaf held ONE placement in
 * `plannedDay` + `plannedStartMin`, and it runs BEFORE `migrateWorkBlocks`
 * moves that pair into `blocks`. The fields are gone from `GoalNode`/`Task`, so
 * reading them requires admitting they were once there — the same deliberate
 * arrangement `migrateNodeStatus` has with the legacy `done` boolean.
 */
export type LegacyNode = GoalNode & { plannedDay?: string; plannedStartMin?: number };
export type LegacyTask = Task & { startMin?: number };

import { walkLeaves, weekOf } from './plan';
import { durationOf, resolveSlot, NO_PAST_LIMIT, ORDINARY_DAY, type PlacedSpan } from './slot';
import { cloneGoals } from './tree';
import { isDone } from './status';

export interface MigrationReport {
  scheduledSteps: number;
  scheduledTasks: number;
  sidebarSteps: number;
  unpinnedTasks: number;
}

/** Clear every planning field a leaf or task carries, together. `plannedStartMin`
 * (leaves) / `startMin` (tasks) is never present without a day — see db/types.ts
 * — so every path that returns an item to the sidebar must drop both fields in
 * the same step or it leaves the half-state the invariant forbids. */
function clearNodePlan(n: LegacyNode): void {
  delete n.plannedWeek;
  delete n.plannedDay;
  delete n.plannedStartMin;
}

/**
 * Give every open, day-committed step and task a real start minute.
 *
 * Placement order is FIXED — steps before tasks, goals in array order (already
 * column-major), leaves depth-first, tasks in array order — because items on
 * one day compete for the same gaps. A different order yields a different
 * result, which would make the idempotence guarantee meaningless.
 *
 * Busy blocks are deliberately empty: this runs at first hydration, before any
 * calendar fetch, so no cached calendar data exists to respect.
 */
export function migrateSlots(
  goals: Goal[],
  tasks: Task[],
  allDayBlocks: boolean,
): { goals: Goal[]; tasks: Task[]; report: MigrationReport } {
  const report: MigrationReport = {
    scheduledSteps: 0, scheduledTasks: 0, sidebarSteps: 0, unpinnedTasks: 0,
  };
  // Live and archived work are placed against SEPARATE occupancy maps. An
  // archived project's leaves must not compete with live work for a gap (a
  // dead project should never push a live commitment into the sidebar), but
  // they still need a real plannedStartMin: `store.reopenGoal` is documented
  // as archiving's exact inverse (just deleting completedAt), and a leaf left
  // with plannedDay but no plannedStartMin is invisible everywhere — skipped
  // by `scheduledOn` (which requires both fields) AND excluded from
  // `unplannedOpenLeaves` when its plannedWeek is the current week (since it
  // reads as "already planned this week"). Clearing or skipping it here would
  // make a reopened project's steps unreachable. Placing it into its own map
  // keeps it fully usable on reopen, at the accepted cost that it may then
  // overlap live work placed independently — a visible, user-fixable state,
  // not silent data loss.
  const occupied = new Map<string, PlacedSpan[]>();
  const archivedOccupied = new Map<string, PlacedSpan[]>();

  function spansFrom(map: Map<string, PlacedSpan[]>, date: string): PlacedSpan[] {
    let list = map.get(date);
    if (!list) { list = []; map.set(date, list); }
    return list;
  }

  function place(map: Map<string, PlacedSpan[]>, date: string, durationMin: number): number | null {
    return resolveSlot({
      date,
      aimMin: ORDINARY_DAY.startMin, // "earliest gap that fits" falls out of the normal search
      durationMin,
      /*
       * `ORDINARY_DAY`, not `WHOLE_DAY` — the same side of the split the
       * replan paths are on, and for the same reason. Nobody aimed at anything
       * here: legacy data carries a DAY and an estimate, and the hour is being
       * chosen for the user, which is the definition of the automatic case.
       * Searching the whole day instead would stack a second leaf backwards
       * into the small hours whenever that gap sat nearer the aim than the one
       * after the first leaf, and would quietly retire the "did not fit — go
       * and look at it" report this migration exists to produce.
       */
      span: ORDINARY_DAY,
      blocks: [],
      placed: spansFrom(map, date),
      now: NO_PAST_LIMIT,
      allDayBlocks,
    });
  }

  const nextGoals = cloneGoals(goals);
  for (const g of nextGoals) {
    const archived = !!g.completedAt;
    const map = archived ? archivedOccupied : occupied;

    walkLeaves(g, (raw) => {
      const n = raw as LegacyNode;
      if (isDone(n) || !n.plannedWeek) return;

      // Already migrated: keep it, but register its span so later items avoid it.
      if (n.plannedDay && n.plannedStartMin !== undefined) {
        spansFrom(map, n.plannedDay).push({
          startMin: n.plannedStartMin,
          endMin: n.plannedStartMin + durationOf(n.estimateMin),
        });
        return;
      }

      // `plannedWeek` with no `plannedDay` is LEGAL, current-model state: a step
      // committed to a week but not yet given a day. `backlogGroups` shows it in
      // that week's rail, and `deferOpenWork` produces exactly this shape on
      // purpose ("Push to next week"), as its own comment says.
      //
      // This used to read it as the retired "Any day" bucket and clear the week
      // commitment. That was survivable while the migration truly ran once on
      // legacy data — but `importStateFromFile` calls `resetSlotMigration()`, so
      // it re-runs over CURRENT data after every backup restore. Defer twelve
      // carried-over steps, export, import, relaunch, and all twelve week
      // commitments were erased while the toast reported "12 returned to the
      // sidebar". Leaving the shape alone is also what makes the migration
      // idempotent, which the swallowed `markSlotMigrationDone` failure path
      // already assumes.
      //
      // A start minute with no day IS still illegal (db/types.ts), so that one
      // field is repaired — but only that one, and only on this branch: the
      // `!n.plannedWeek` guard above returns first, so a stray `plannedStartMin`
      // with no week at all is left alone (as it always was).
      if (!n.plannedDay) {
        delete n.plannedStartMin;
        return;
      }

      const duration = durationOf(n.estimateMin);
      const startMin = place(map, n.plannedDay, duration);
      if (startMin === null) {
        clearNodePlan(n);
        if (!archived) report.sidebarSteps++;
        return;
      }

      spansFrom(map, n.plannedDay).push({ startMin, endMin: startMin + duration });
      // Legacy day/week can drift apart (e.g. hand-edited data, or a day moved
      // without its week following) — re-derive the week from the day being
      // placed so the two can never disagree post-migration. Undocumented
      // until now; see migrateSlots.test.ts for the drift case this repairs.
      n.plannedWeek = weekOf(n.plannedDay);
      n.plannedStartMin = startMin;
      if (!archived) report.scheduledSteps++;
    });
  }

  const nextTasks = tasks.map((raw) => {
    const t = raw as LegacyTask;
    if (t.done || !t.date) return t as Task;

    if (t.startMin !== undefined) {
      spansFrom(occupied, t.date).push({ startMin: t.startMin, endMin: t.startMin + durationOf(t.estimateMin) });
      return t as Task;
    }

    const duration = durationOf(t.estimateMin);
    const startMin = place(occupied, t.date, duration);
    if (startMin === null) {
      // No room on its day: keep `date` — there is no task sidebar for a
      // dateless task to land in (unlike a step, which has the backlog rail).
      // Dropping `date` here made every Saturday/Sunday task, and any task on
      // an oversubscribed weekday, silently unreachable in every view. Leaving
      // `date` in place and only withholding `startMin` keeps the task legal
      // under the model (day without a start minute = backlog) and visible in
      // Today and the old planner; a later plan's sidebar can surface it.
      const unpinned = { ...t };
      delete unpinned.startMin;
      report.unpinnedTasks++;
      return unpinned as Task;
    }

    spansFrom(occupied, t.date).push({ startMin, endMin: startMin + duration });
    report.scheduledTasks++;
    return { ...t, startMin } as Task;
  });

  return { goals: nextGoals, tasks: nextTasks, report };
}

/** One-line summary for the post-migration toast, or null if nothing moved. */
export function describeMigration(report: MigrationReport): string | null {
  const placed = report.scheduledSteps + report.scheduledTasks;
  const returned = report.sidebarSteps;
  const unpinned = report.unpinnedTasks;
  if (placed === 0 && returned === 0 && unpinned === 0) return null;

  const parts: string[] = [];
  if (placed > 0) parts.push(`${placed} item${placed === 1 ? '' : 's'} placed on the calendar`);
  if (returned > 0) parts.push(`${returned} returned to the sidebar`);
  if (unpinned > 0) {
    parts.push(
      unpinned === 1
        ? '1 task kept on its day, unscheduled'
        : `${unpinned} tasks kept on their days, unscheduled`,
    );
  }
  return parts.join(' · ');
}
