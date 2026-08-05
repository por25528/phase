export interface GoalNode {
  id: string;
  title: string;
  done?: boolean;       // present on LEAVES only
  doneAt?: string;      // local 'YYYY-MM-DD' completion date; optional for legacy data
  children?: GoalNode[]; // present on CONTAINERS only
  // INVARIANT: a node is a leaf XOR a container.
  // Adding a child to a leaf deletes its `done` and `doneAt`.
  // A node with children[].length > 0 is a container.
  start?: string;    // 'YYYY-MM-DD' — scheduling metadata only, never affects pct
  deadline?: string; // both present or both absent
  plannedWeek?: string; // 'YYYY-MM-DD' Monday — "this week" commitment. Scheduling metadata only, never affects pct.
  plannedDay?: string;  // optional pin within plannedWeek; never present without plannedWeek
  plannedStartMin?: number; // minutes from local midnight, 0..1440. Never present
                            // without plannedDay. Scheduling metadata: never
                            // affects the pct roll-up.
  estimateMin?: number;  // LEAVES only — expected effort in minutes.
                         // Scheduling metadata: never affects pct roll-up.
  /**
   * A dated marker the user is working TOWARD — an exam, a submission, a demo.
   *
   * Unlike the `Milestone` this replaces, a checkpoint is a real node, so it
   * counts in the pct roll-up and can be ticked. That is deliberate: a marker
   * that never moved a number was the complaint that retired `Milestone`.
   *
   * Its date is its `deadline`; the migration writes `start === deadline`, so
   * a checkpoint is a zero-length span, which is what a marker is.
   *
   * LEAVES ONLY. A container has no `done`, so a container checkpoint could
   * never be reached — the same dead-marker problem. `toggleCheckpoint`
   * refuses containers and `addChild` drops the flag when it converts a leaf.
   */
  checkpoint?: boolean;
  notes?: string; // free-form step notes — never affects the pct roll-up
}

// One immutable snapshot of the PREVIOUS week's commitments, taken at week
// rollover. Entries never change after creation (triage mutates nodes, not
// this); only `reviewed` flips. Titles are stored so deleted nodes can still
// be shown in the recap.
export interface PlanReviewEntry {
  nodeId: string;
  goalId: string;
  leafTitle: string;
  goalTitle: string;
}

export interface PlanReview {
  week: string; // Monday of the snapshotted week
  entries: PlanReviewEntry[];
  reviewed: boolean;
}

export interface Goal {
  id: string;
  title: string;
  start?: string;    // 'YYYY-MM-DD'
  deadline?: string; // 'YYYY-MM-DD'
  datesConfirmed?: boolean;
  nodes: GoalNode[];
  notes?: string;           // free-form working notes — rides along in the goal object
  column?: number;          // commitment-horizon column, 0 = Now … 3 = Someday. Absent ⇒ 0.
  completedAt?: string;     // 'YYYY-MM-DD' — set when the project is explicitly archived. Absent ⇒ active.
}

export type ZoomLevel = 'week' | 'month' | 'quarter';

export type Cadence = 'daily' | 'weekly';

export interface Habit {
  id: string;
  title: string;
  cadence: Cadence;
  weeklyTarget: number; // used when cadence==='weekly'
  goalId: string | null; // tag FOR CONTEXT ONLY
  checkins: string[];   // array of 'YYYY-MM-DD' strings
  createdAt?: string;   // 'YYYY-MM-DD' — day the habit began; misses before it don't count. Optional for legacy data.
}

export interface Task {
  id: string;
  title: string;
  // 'YYYY-MM-DD'. Genuinely optional: a dateless task is unplanned work, and
  // the Plan view's backlog rail lists it under its project, so it is fully
  // reachable. (This note used to say the opposite — that nothing may clear
  // `date` because no surface shows a dateless task. That was true of the old
  // planner and stopped being true when the rail shipped; `unscheduleTask` now
  // clears both fields, matching `unscheduleNode`.)
  date?: string;
  // Minutes from local midnight. Never present without `date`. A task WITH a
  // date and NO startMin is committed to that day but not placed on the grid:
  // it shows in Today and the old planner, and belongs in the task backlog
  // once that ships.
  startMin?: number;
  done: boolean;
  doneAt?: string; // local 'YYYY-MM-DD' completion date; optional for legacy data
  goalId: string | null; // tag FOR CONTEXT ONLY
  estimateMin?: number; // expected effort in minutes; same meaning as GoalNode
}

export interface Session {
  id: string;
  goalId: string | null; // tag FOR CONTEXT ONLY — never moves a %
  date: string;          // 'YYYY-MM-DD'
  minutes: number;
  note: string;
  /**
   * The specific commitment this time went to. Optional and mutually
   * exclusive: a session carries at most one of them, and may carry neither
   * (time logged against a project as a whole, or a legacy/imported session
   * written before these existed).
   *
   * They exist so actual time can be set against the ESTIMATE that predicted
   * it. `goalId` alone cannot do that — an estimate is a property of a leaf or
   * a task, not of a project — so without these, "you planned 90m and it took
   * 145m" is unanswerable and the only honest report is a weekly total.
   *
   * Like every other time field in Phase, these NEVER affect the pct roll-up.
   * Logging time against a step does not complete it or advance it; ticking the
   * checkbox remains the only thing that moves a number.
   *
   * A reference may DANGLE: deleting a step or task leaves its sessions behind.
   * That is deliberate, and it must not be "fixed" by cascading the delete.
   * `withUndo` snapshots exactly one slice, so a delete that removed both the
   * node (`goals`) and its sessions (`sessions`) could only restore one of them
   * — the undo would bring the step back with its history silently gone. An
   * orphan is inert by comparison: `projectCalibration` walks live leaves and
   * never sees it, and the weekly total still counting it is consistent with
   * `PlanReview` storing titles so deleted work still appears in the recap. The
   * time was really spent.
   *
   * Cascading safely needs multi-slice undo first.
   */
  nodeId?: string;
  taskId?: string;
}

export interface AppState {
  goals: Goal[];
  habits: Habit[];
  tasks: Task[];
  sessions: Session[];
}

export interface Asset {
  id: string; // 'a_' + uid()
  mime: string; // 'image/webp' | 'image/png' | 'image/jpeg'
  bytes: Blob;
  width: number;
  height: number;
  createdAt: string; // 'YYYY-MM-DD'
}

// A weekday's availability window. Absent dow means that day is off.
export interface AvailabilityWindow {
  dow: number;      // 0 = Mon … 6 = Sun, matching weekDates() order
  startMin: number; // minutes from local midnight; 540 = 09:00
  endMin: number;   // exclusive
}

// A busy slice, already flattened onto one local day by the main process.
// Always empty in slice 1; populated from Google in slice 2.
export interface BusyBlock {
  date: string;     // 'YYYY-MM-DD' local
  startMin: number; // clipped to that local day, 0..1440
  endMin: number;   // exclusive, > startMin
  title: string;
  allDay: boolean;
}

/**
 * The device-local calendar snapshot.
 *
 * Lives OUTSIDE AppState and outside persist() for the same reason `assets`
 * does: persist() is a full clear + bulkPut of four tables, so folding this in
 * would rewrite every cached event on every checkbox tick. Writes are surgical
 * and go through src/db/calendarCache.ts.
 *
 * Excluded from backup export and import — meeting titles must not land in a
 * phase-goals-*.json the user might share, and on import the cache is left
 * untouched because it is derived device state, not user data.
 */
export interface CalendarCache {
  rangeStart: string;    // 'YYYY-MM-DD' inclusive
  rangeEnd: string;      // 'YYYY-MM-DD' EXCLUSIVE
  blocks: BusyBlock[];
  fetchedAt: string;     // ISO instant, for the staleness label
  // Provenance: any mismatch invalidates the cache. Without it, an account
  // switch, a changed calendar selection or a machine timezone change leaves
  // stale blocks rendering as current fact.
  accountId: string;
  calendarIds: string[]; // sorted
  timeZone: string;      // IANA zone the blocks were flattened against
  // `allDayBlocks` is deliberately NOT provenance: all-day blocks are always
  // cached and the preference is applied at read time in capacity.ts, so
  // toggling it never requires a refetch.
}
