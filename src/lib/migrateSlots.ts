import type { AvailabilityWindow, Goal, GoalNode, Task } from '../db/types';
import { windowForDate } from './availability';
import type { Now } from './capacity';
import { walkLeaves, weekOf } from './plan';
import { durationOf, resolveSlot, type PlacedSpan } from './slot';
import { cloneGoals } from './tree';

/**
 * The migration re-homes commitments the user ALREADY made. Clamping to the
 * real clock would refuse this morning merely because it is now afternoon and
 * dump the day's work into the sidebar. A sentinel far in the past disables
 * `remainingWindow`'s past-clamping for every date the migration touches.
 */
export const MIGRATION_NOW: Now = { date: '1970-01-01', minute: 0 };

export interface MigrationReport {
  scheduledSteps: number;
  scheduledTasks: number;
  sidebarSteps: number;
  sidebarTasks: number;
}

/** Clear every planning field a leaf or task carries, together. `plannedStartMin`
 * (leaves) / `startMin` (tasks) is never present without a day — see db/types.ts
 * — so every path that returns an item to the sidebar must drop both fields in
 * the same step or it leaves the half-state the invariant forbids. */
function clearNodePlan(n: GoalNode): void {
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
  windows: AvailabilityWindow[],
  allDayBlocks: boolean,
): { goals: Goal[]; tasks: Task[]; report: MigrationReport } {
  const report: MigrationReport = {
    scheduledSteps: 0, scheduledTasks: 0, sidebarSteps: 0, sidebarTasks: 0,
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
    const window = windowForDate(date, windows);
    if (!window) return null;
    return resolveSlot({
      date,
      aimMin: window.startMin, // "earliest gap that fits" falls out of the normal search
      durationMin,
      windows,
      blocks: [],
      placed: spansFrom(map, date),
      now: MIGRATION_NOW,
      allDayBlocks,
    });
  }

  const nextGoals = cloneGoals(goals);
  for (const g of nextGoals) {
    const archived = !!g.completedAt;
    const map = archived ? archivedOccupied : occupied;

    walkLeaves(g, (n) => {
      if (n.done || !n.plannedWeek) return;

      // Already migrated: keep it, but register its span so later items avoid it.
      if (n.plannedDay && n.plannedStartMin !== undefined) {
        spansFrom(map, n.plannedDay).push({
          startMin: n.plannedStartMin,
          endMin: n.plannedStartMin + durationOf(n.estimateMin),
        });
        return;
      }

      if (!n.plannedDay) { // the old "Any day" bucket has no equivalent now
        clearNodePlan(n);
        if (!archived) report.sidebarSteps++;
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

  const nextTasks = tasks.map((t) => {
    if (t.done || !t.date) return t;

    if (t.startMin !== undefined) {
      spansFrom(occupied, t.date).push({ startMin: t.startMin, endMin: t.startMin + durationOf(t.estimateMin) });
      return t;
    }

    const duration = durationOf(t.estimateMin);
    const startMin = place(occupied, t.date, duration);
    if (startMin === null) {
      const unscheduled = { ...t };
      delete unscheduled.date;
      // Defensive only: the `t.startMin !== undefined` guard above already
      // returned before this branch whenever startMin was set, so it is always
      // already absent here. Kept so this branch can never produce the
      // date/startMin half-state even if that guard's shape changes later.
      delete unscheduled.startMin;
      report.sidebarTasks++;
      return unscheduled;
    }

    spansFrom(occupied, t.date).push({ startMin, endMin: startMin + duration });
    report.scheduledTasks++;
    return { ...t, startMin };
  });

  return { goals: nextGoals, tasks: nextTasks, report };
}

/** One-line summary for the post-migration toast, or null if nothing moved. */
export function describeMigration(report: MigrationReport): string | null {
  const placed = report.scheduledSteps + report.scheduledTasks;
  const returned = report.sidebarSteps + report.sidebarTasks;
  if (placed === 0 && returned === 0) return null;

  const parts: string[] = [];
  if (placed > 0) parts.push(`${placed} item${placed === 1 ? '' : 's'} placed on the calendar`);
  if (returned > 0) parts.push(`${returned} returned to the sidebar`);
  return parts.join(' · ');
}
