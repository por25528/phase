export type StepStatus = 'todo' | 'doing' | 'blocked' | 'done';

/**
 * One sitting: a span of calendar time allocated to a task.
 *
 * This is what makes a four-hour task two two-hour sittings without duplicating
 * it. Before this a leaf carried `plannedDay` + `plannedStartMin` — exactly ONE
 * placement — so the only ways to express two sittings were to split the task
 * (which duplicates it in every count and roll-up) or to schedule it once and
 * lie about the length.
 *
 * `minutes` belongs to the BLOCK, not to the task. That is the whole point:
 * resizing a sitting changes that sitting, never the estimate, and "planned
 * sittings exceed the estimate" is then a comparison of two real numbers rather
 * than a guess. A task's estimate stays a fact about the work.
 *
 * Blocks live INSIDE the node or task they belong to, not in a table of their
 * own. Every calendar read already walks the whole tree (`scheduledOn`), so the
 * table would buy nothing — and it would introduce a dangling-reference class
 * that `Session` is only allowed to have because a stray session is inert. A
 * stray BLOCK would draw itself on a Tuesday.
 */
export interface WorkBlock {
  id: string;
  date: string;     // 'YYYY-MM-DD' local
  startMin: number; // minutes from local midnight, 0..1440
  minutes: number;  // this sitting's own length, > 0
}

export interface GoalNode {
  id: string;
  title: string;
  /**
   * LEAVES only. Absent ⇒ 'todo'; 'todo' is never written. Scheduling
   * metadata never affects the pct roll-up and neither does this: `pct.ts`
   * counts 'done' and nothing else, so 'doing' and 'blocked' contribute
   * zero, exactly as an unticked box always did.
   */
  status?: StepStatus;
  /** Present only while status === 'blocked'. Cleared on any other transition. */
  blockedOn?: string;
  doneAt?: string;      // local 'YYYY-MM-DD' completion date; optional for legacy data
  children?: GoalNode[]; // present on CONTAINERS only
  // INVARIANT: a node is a leaf XOR a container.
  // Adding a child to a leaf deletes its `status` and `doneAt`.
  // A node with children[].length > 0 is a container.
  start?: string;    // 'YYYY-MM-DD' — scheduling metadata only, never affects pct
  deadline?: string; // both present or both absent
  /**
   * 'YYYY-MM-DD' Monday — the "this week" COMMITMENT. Scheduling metadata only,
   * never affects pct.
   *
   * Commitment and placement are separate facts and neither derives the other:
   * a leaf can be committed to a week with nothing on the calendar (the rail's
   * "to place"), and — since a sitting can be moved without renegotiating the
   * week — its blocks need not all fall inside `plannedWeek`.
   */
  plannedWeek?: string;
  /**
   * The sittings this leaf is placed at. LEAVES only, like `estimateMin`, and
   * absent rather than `[]` when there are none — `scheduledOn` reads presence,
   * and an empty array is the legacy-leaf ambiguity `children` already suffers.
   *
   * Replaces `plannedDay` + `plannedStartMin`, which between them could hold
   * exactly one placement. `migrateWorkBlocks` moves the old pair in.
   */
  blocks?: WorkBlock[];
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
   * LEAVES ONLY. A container has no `status`, so a container checkpoint could
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

/**
 * One of the handful of lives a person is living at once — "MIT", "Startup".
 *
 * A life is an ORGANISING dimension, not a container: it groups goals and (in
 * slice 2) takes a share of the week's hours. It is deliberately NOT
 * `Goal.type`, which is a template deciding what an empty workspace offers on
 * first visit — welding them would mean a study-shaped goal could never sit on
 * the startup board.
 *
 * Capped at `MAX_LIVES` (3). Scarcity is how this product thinks, and four
 * lives is not a life, it is a tag system.
 */
export interface Life {
  id: string;
  title: string;
  order: number; // ascending display order; ties broken by array position
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
  /**
   * The life this goal belongs to. Absent ⇒ unassigned, which is a REAL,
   * permanent state, not a migration gap — an errand belongs to no life.
   *
   * The reference MAY DANGLE, exactly as `Session.nodeId` may. Deleting a life
   * leaves its goals pointing at nothing and they read as unassigned; `lifeOf`
   * resolves that at read time. This is what lets `removeLife` avoid rewriting
   * every goal it touched, and what keeps its undo honest.
   */
  lifeId?: string;
  /**
   * Study / Project / General — a TEMPLATE, not a second object model. All
   * three share the same Areas, Tasks and schedule; the type only decides what
   * an empty workspace offers on the first visit.
   *
   * Optional, and read by nothing except those suggestions: a goal that
   * predates types, or whose owner declined one, loses a starting point and no
   * behaviour.
   */
  type?: 'study' | 'project' | 'general';
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
  /**
   * The sittings this task is placed at — the same object a `GoalNode` carries,
   * for the same reason. Replaces `startMin`, which could hold one.
   *
   * `date` survives as the DAY COMMITMENT: a task captured with `@friday` has a
   * date and no blocks, which is what the rail calls "to place". A task with
   * blocks is placed, whatever `date` says.
   */
  blocks?: WorkBlock[];
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
  lives: Life[];
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
// MUST stay identical to electron/busyBlocks.d.cts: the process seam prevents
// importing this declaration across it, so any change must be made to both.
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
  // Half-open bounds, matching DateRange and NormalizeOptions.
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
