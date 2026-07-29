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
}

// Markers only — milestones are never used in pct roll-up.
export interface Milestone {
  id: string;
  title: string;
  date: string; // 'YYYY-MM-DD'
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
  milestones?: Milestone[]; // markers only — never used in pct roll-up
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
  date?: string; // 'YYYY-MM-DD'. ABSENT = unscheduled — the task lives in the
                 // sidebar backlog, not on any day.
  startMin?: number; // minutes from local midnight. Never present without `date`.
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
}

export interface AppState {
  goals: Goal[];
  habits: Habit[];
  tasks: Task[];
  sessions: Session[];
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
