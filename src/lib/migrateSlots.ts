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
  const occupied = new Map<string, PlacedSpan[]>();

  function spansFor(date: string): PlacedSpan[] {
    let list = occupied.get(date);
    if (!list) { list = []; occupied.set(date, list); }
    return list;
  }

  function place(date: string, durationMin: number): number | null {
    const window = windowForDate(date, windows);
    if (!window) return null;
    return resolveSlot({
      date,
      aimMin: window.startMin, // "earliest gap that fits" falls out of the normal search
      durationMin,
      windows,
      blocks: [],
      placed: spansFor(date),
      now: MIGRATION_NOW,
      allDayBlocks,
    });
  }

  const nextGoals = cloneGoals(goals);
  for (const g of nextGoals) {
    // Archived projects are invisible everywhere else that reads plannedDay
    // (plannedLeaves, scheduledOn, store.planNode all skip completedAt goals),
    // so letting a leftover open leaf here occupy a gap would let dead work
    // silently push a live commitment into the sidebar. Strip its planning
    // fields entirely instead of placing or sidebar-counting it — there is no
    // toast action a user could take on an archived project's leaf moving, so
    // it must not inflate sidebarSteps either.
    if (g.completedAt) {
      walkLeaves(g, (n) => { if (!n.done) clearNodePlan(n); });
      continue;
    }

    walkLeaves(g, (n) => {
      if (n.done || !n.plannedWeek) return;

      // Already migrated: keep it, but register its span so later items avoid it.
      if (n.plannedDay && n.plannedStartMin !== undefined) {
        spansFor(n.plannedDay).push({
          startMin: n.plannedStartMin,
          endMin: n.plannedStartMin + durationOf(n.estimateMin),
        });
        return;
      }

      if (!n.plannedDay) { // the old "Any day" bucket has no equivalent now
        clearNodePlan(n);
        report.sidebarSteps++;
        return;
      }

      const duration = durationOf(n.estimateMin);
      const startMin = place(n.plannedDay, duration);
      if (startMin === null) {
        clearNodePlan(n);
        report.sidebarSteps++;
        return;
      }

      spansFor(n.plannedDay).push({ startMin, endMin: startMin + duration });
      // Legacy day/week can drift apart (e.g. hand-edited data, or a day moved
      // without its week following) — re-derive the week from the day being
      // placed so the two can never disagree post-migration. Undocumented
      // until now; see migrateSlots.test.ts for the drift case this repairs.
      n.plannedWeek = weekOf(n.plannedDay);
      n.plannedStartMin = startMin;
      report.scheduledSteps++;
    });
  }

  const nextTasks = tasks.map((t) => {
    if (t.done || !t.date) return t;

    if (t.startMin !== undefined) {
      spansFor(t.date).push({ startMin: t.startMin, endMin: t.startMin + durationOf(t.estimateMin) });
      return t;
    }

    const duration = durationOf(t.estimateMin);
    const startMin = place(t.date, duration);
    if (startMin === null) {
      const unscheduled = { ...t };
      delete unscheduled.date;
      delete unscheduled.startMin; // keep date/startMin absent together — see clearNodePlan
      report.sidebarTasks++;
      return unscheduled;
    }

    spansFor(t.date).push({ startMin, endMin: startMin + duration });
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
