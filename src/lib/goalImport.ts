import type { Goal, GoalNode } from '../db/types';
import { uid } from './tree';
import { clampSpan } from './timeline';

// ── Priority ↔ column ─────────────────────────────────────────────────────────
// The Goals board has 4 columns, 0 = highest. The AI-facing format uses words so
// neither the model nor the user has to think in column indices.

export const PRIORITY_WORDS = ['highest', 'high', 'medium', 'later'] as const;
export type PriorityWord = (typeof PRIORITY_WORDS)[number];

export function priorityToColumn(word?: unknown): number {
  if (typeof word !== 'string') return 0;
  const i = PRIORITY_WORDS.indexOf(word.trim().toLowerCase() as PriorityWord);
  return i === -1 ? 0 : i;
}

export function columnToPriority(column?: number): PriorityWord {
  return PRIORITY_WORDS[Math.min(Math.max(column ?? 0, 0), PRIORITY_WORDS.length - 1)];
}

/** End of the year `today` falls in — the default deadline when none is given. */
export function defaultDeadline(today: string): string {
  return `${today.slice(0, 4)}-12-31`;
}

// ── Node construction from the simplified spec ────────────────────────────────
// A subgoal spec is either a plain string (a leaf step) or an object with an
// optional nested `subgoals` array (a group) and optional start/deadline dates.

type SubgoalSpec =
  | string
  | {
      title?: unknown;
      subgoals?: unknown;
      start?: unknown;
      deadline?: unknown;
    };

const isDateStr = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Build a GoalNode tree from a subgoal spec, minting fresh ids. Enforces the
 * leaf-XOR-container invariant: a spec with a non-empty `subgoals` array becomes
 * a container (children, no `done`); everything else is a leaf (`done:false`).
 * Returns null for specs with no usable title so callers can skip them.
 */
export function buildNode(spec: SubgoalSpec): GoalNode | null {
  if (typeof spec === 'string') {
    const title = spec.trim();
    return title ? { id: uid(), title, done: false } : null;
  }
  if (!spec || typeof spec !== 'object') return null;

  const title = typeof spec.title === 'string' ? spec.title.trim() : '';
  if (!title) return null;

  const children = Array.isArray(spec.subgoals)
    ? (spec.subgoals as SubgoalSpec[]).map(buildNode).filter((n): n is GoalNode => n !== null)
    : [];

  if (children.length > 0) {
    return { id: uid(), title, children };
  }

  // Leaf — carry scheduling dates only when both are present.
  const node: GoalNode = { id: uid(), title, done: false };
  if (isDateStr(spec.start) && isDateStr(spec.deadline)) {
    const clamped = clampSpan(spec.start, spec.deadline);
    node.start = clamped.start;
    node.deadline = clamped.deadline;
  }
  return node;
}

// ── Manual-form goal construction ─────────────────────────────────────────────

export interface ManualGoalInput {
  title: string;
  start: string;
  deadline: string;
  column: number;
  notes: string;
  subgoalTitles: string[];
}

/** Build a Goal from the manual New Goal form. Subgoals are flat leaf steps. */
export function buildManualGoal(input: ManualGoalInput): Goal {
  const clamped = clampSpan(input.start, input.deadline);
  const nodes: GoalNode[] = input.subgoalTitles
    .map((t) => t.trim())
    .filter(Boolean)
    .map((title) => ({ id: uid(), title, done: false }));
  const goal: Goal = {
    id: uid(),
    title: input.title.trim(),
    start: clamped.start,
    deadline: clamped.deadline,
    nodes,
    column: input.column,
  };
  const notes = input.notes.trim();
  if (notes) goal.notes = notes;
  return goal;
}

// ── Import parsing ────────────────────────────────────────────────────────────

type GoalSpec = {
  title?: unknown;
  start?: unknown;
  deadline?: unknown;
  priority?: unknown;
  notes?: unknown;
  subgoals?: unknown;
};

function buildImportedGoal(spec: GoalSpec, today: string): Goal {
  const start = isDateStr(spec.start) ? spec.start : today;
  const deadline = isDateStr(spec.deadline) ? spec.deadline : defaultDeadline(today);
  const clamped = clampSpan(start, deadline);
  const nodes = Array.isArray(spec.subgoals)
    ? (spec.subgoals as SubgoalSpec[]).map(buildNode).filter((n): n is GoalNode => n !== null)
    : [];
  const goal: Goal = {
    id: uid(),
    title: (spec.title as string).trim(),
    start: clamped.start,
    deadline: clamped.deadline,
    nodes,
    column: priorityToColumn(spec.priority),
  };
  if (typeof spec.notes === 'string' && spec.notes.trim()) goal.notes = spec.notes.trim();
  return goal;
}

/**
 * Drop an invalid `completedAt` from a backup goal so a malformed value can't
 * silently hide a project on import (spec §5). A valid `YYYY-MM-DD` is kept;
 * anything else is removed, leaving the project active.
 */
export function sanitizeBackupGoal(goal: Goal): Goal {
  const c = (goal as { completedAt?: unknown }).completedAt;
  if (c === undefined || (typeof c === 'string' && isDateStr(c))) return goal;
  const copy = { ...goal };
  delete (copy as { completedAt?: unknown }).completedAt;
  return copy;
}

/**
 * Parse pasted JSON into ready-to-store Goal objects. Accepts a single goal
 * object or an array. Forgiving on optional fields (defaults applied), strict on
 * `title` and JSON validity, all-or-nothing: any bad goal rejects the whole paste.
 */
export function parseGoalImport(
  raw: string,
  today: string,
): { goals: Goal[] } | { error: string } {
  const text = raw.trim();
  if (!text) return { error: 'Paste some JSON first.' };

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "That's not valid JSON — check for a missing comma, quote, or bracket." };
  }

  const list = Array.isArray(data) ? data : [data];
  if (list.length === 0) return { error: 'No goals found in that JSON.' };

  const goals: Goal[] = [];
  for (let i = 0; i < list.length; i++) {
    const spec = list[i];
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      return { error: `Goal #${i + 1} isn't a valid goal object.` };
    }
    const title = (spec as GoalSpec).title;
    if (typeof title !== 'string' || !title.trim()) {
      return { error: `Goal #${i + 1} is missing a title.` };
    }
    goals.push(buildImportedGoal(spec as GoalSpec, today));
  }
  return { goals };
}

// ── AI prompt + on-screen format hint ─────────────────────────────────────────

/** Compact, human-readable schema shown inside the Import modal. */
export const FORMAT_HINT = `{
  "title": "Goal name",                 // required
  "start": "YYYY-MM-DD",                // optional → today
  "deadline": "YYYY-MM-DD",             // optional → end of year
  "priority": "highest|high|medium|later", // optional → highest
  "notes": "context…",                  // optional
  "subgoals": [
    "a step",                            // string = one step
    { "title": "a group", "subgoals": ["sub-step"] },
    { "title": "scheduled step", "start": "YYYY-MM-DD", "deadline": "YYYY-MM-DD" }
  ]
}`;

/** The full instruction block copied to the clipboard for pasting into any AI. */
export function buildAiPrompt(today: string): string {
  return `You are helping me plan a goal for my goal-tracking app.
Output ONLY valid JSON — no prose, no markdown code fences — matching this exact format:

{
  "title": "string (required) — the goal name",
  "start": "YYYY-MM-DD (optional, defaults to today)",
  "deadline": "YYYY-MM-DD (optional, defaults to end of the year)",
  "priority": "highest | high | medium | later (optional, default highest)",
  "notes": "string (optional) — strategy, context, links",
  "subgoals": [
    "a plain string is one concrete step",
    {
      "title": "an object with its own subgoals is a group of steps",
      "subgoals": ["nested step 1", "nested step 2"]
    },
    { "title": "a step with its own schedule", "start": "YYYY-MM-DD", "deadline": "YYYY-MM-DD" }
  ]
}

Rules:
- Break the goal into 3–7 concrete subgoals; nest a group only when a step needs its own sub-steps.
- Keep every leaf step small and actionable.
- Today's date is ${today}. Make all dates realistic relative to today.
- Output a single goal object, or an array of goal objects if I ask for several goals.

Example:
{
  "title": "Launch my side project",
  "deadline": "${today.slice(0, 4)}-12-31",
  "priority": "highest",
  "subgoals": [
    "Pick one idea",
    { "title": "Build v1", "subgoals": ["Design mockups", "Implement backend"] },
    { "title": "Ship publicly", "start": "${today.slice(0, 4)}-11-01", "deadline": "${today.slice(0, 4)}-11-15" }
  ]
}

Here's what I want to achieve:
<describe your goal here>`;
}
