export interface GoalNode {
  id: string;
  title: string;
  done?: boolean;       // present on LEAVES only
  children?: GoalNode[]; // present on CONTAINERS only
  // INVARIANT: a node is a leaf XOR a container.
  // Adding a child to a leaf deletes its `done`.
  // A node with children[].length > 0 is a container.
  start?: string;    // 'YYYY-MM-DD' — scheduling metadata only, never affects pct
  deadline?: string; // both present or both absent
  plannedWeek?: string; // 'YYYY-MM-DD' Monday — "this week" commitment. Scheduling metadata only, never affects pct.
  plannedDay?: string;  // optional pin within plannedWeek; never present without plannedWeek
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
  start: string;    // 'YYYY-MM-DD'
  deadline: string; // 'YYYY-MM-DD'
  nodes: GoalNode[];
  milestones?: Milestone[]; // markers only — never used in pct roll-up
  notes?: string;           // free-form working notes — rides along in the goal object
  column?: number;          // priority-board column, 0 = leftmost/highest. Absent ⇒ 0.
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
  date: string;  // 'YYYY-MM-DD'
  done: boolean;
  goalId: string | null; // tag FOR CONTEXT ONLY
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
