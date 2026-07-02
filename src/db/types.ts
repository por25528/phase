export interface GoalNode {
  id: string;
  title: string;
  done?: boolean;       // present on LEAVES only
  children?: GoalNode[]; // present on CONTAINERS only
  // INVARIANT: a node is a leaf XOR a container.
  // Adding a child to a leaf deletes its `done`.
  // A node with children[].length > 0 is a container.
}

// Markers only — milestones are never used in pct roll-up.
export interface Milestone {
  id: string;
  title: string;
  date: string; // 'YYYY-MM-DD'
}

export interface Goal {
  id: string;
  title: string;
  start: string;    // 'YYYY-MM-DD'
  deadline: string; // 'YYYY-MM-DD'
  nodes: GoalNode[];
  milestones?: Milestone[]; // markers only — never used in pct roll-up
}

export type ZoomLevel = 'year' | 'quarter' | 'month';

export type Cadence = 'daily' | 'weekly';

export interface Habit {
  id: string;
  title: string;
  cadence: Cadence;
  weeklyTarget: number; // used when cadence==='weekly'
  goalId: string | null; // tag FOR CONTEXT ONLY
  checkins: string[];   // array of 'YYYY-MM-DD' strings
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
