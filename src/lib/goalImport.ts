import type { Goal, GoalNode } from '../db/types';
import { uid } from './tree';
import { clampSpan } from './timeline';
import { isValidLocalDate, projectDateError } from './schedule';

// ── Horizon ↔ column ──────────────────────────────────────────────────────────
// The Goals board has 4 commitment horizons, column 0 = Now. The AI-facing
// format uses words so neither the model nor the user thinks in column indices.
// Imports stay backward-compatible: the legacy priority words map to the same
// columns as the horizon words they were renamed to.

export const PRIORITY_WORDS = ['now', 'next', 'later', 'someday'] as const;
export type PriorityWord = (typeof PRIORITY_WORDS)[number];

// Legacy highest|high|medium|later → columns 0–3, so old backups and prompts
// still import to the right horizon. `later` is intentionally shared: it meant
// column 3 under the old scheme and column 2 under the new one — the new horizon
// word wins (checked first) so a fresh export round-trips, while an old backup's
// `later` still resolves via this table to its original column 3.
const LEGACY_PRIORITY_WORDS = ['highest', 'high', 'medium', 'later'] as const;

export function priorityToColumn(word?: unknown): number {
  if (typeof word !== 'string') return 0;
  const w = word.trim().toLowerCase();
  const horizon = PRIORITY_WORDS.indexOf(w as PriorityWord);
  if (horizon !== -1) return horizon;
  const legacy = LEGACY_PRIORITY_WORDS.indexOf(w as (typeof LEGACY_PRIORITY_WORDS)[number]);
  return legacy === -1 ? 0 : legacy;
}

export function columnToPriority(column?: number): PriorityWord {
  return PRIORITY_WORDS[Math.min(Math.max(column ?? 0, 0), PRIORITY_WORDS.length - 1)];
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
  if (isValidLocalDate(spec.start) && isValidLocalDate(spec.deadline)) {
    const clamped = clampSpan(spec.start, spec.deadline);
    node.start = clamped.start;
    node.deadline = clamped.deadline;
  }
  return node;
}

// ── Manual-form goal construction ─────────────────────────────────────────────

export interface ManualGoalInput {
  title: string;
  start?: string;
  deadline?: string;
  column: number;
  notes: string;
  subgoalTitles: string[];
}

/** Build a Goal from the manual New Goal form. Subgoals are flat leaf steps. */
export function buildManualGoal(input: ManualGoalInput): Goal {
  const dateError = projectDateError(input.start, input.deadline);
  if (dateError) throw new Error(dateError);
  const nodes: GoalNode[] = input.subgoalTitles
    .map((t) => t.trim())
    .filter(Boolean)
    .map((title) => ({ id: uid(), title, done: false }));
  const goal: Goal = {
    id: uid(),
    title: input.title.trim(),
    nodes,
    column: input.column,
    datesConfirmed: true,
  };
  if (input.start) goal.start = input.start;
  if (input.deadline) goal.deadline = input.deadline;
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

function buildImportedGoal(spec: GoalSpec): Goal {
  const nodes = Array.isArray(spec.subgoals)
    ? (spec.subgoals as SubgoalSpec[]).map(buildNode).filter((n): n is GoalNode => n !== null)
    : [];
  const goal: Goal = {
    id: uid(),
    title: (spec.title as string).trim(),
    nodes,
    column: priorityToColumn(spec.priority),
    datesConfirmed: true,
  };
  if (isValidLocalDate(spec.start)) goal.start = spec.start;
  if (isValidLocalDate(spec.deadline)) goal.deadline = spec.deadline;
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
  if (c === undefined || isValidLocalDate(c)) return goal;
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
  _today: string,
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
    const goalSpec = spec as GoalSpec;
    const dateError = projectDateError(goalSpec.start, goalSpec.deadline);
    if (dateError) return { error: `Goal #${i + 1}: ${dateError}` };
    goals.push(buildImportedGoal(goalSpec));
  }
  return { goals };
}

// ── AI prompt + on-screen format hint ─────────────────────────────────────────

/** Compact, human-readable schema shown inside the Import modal. */
export const FORMAT_HINT = `{
  "title": "Project name",              // required
  "start": "YYYY-MM-DD",                // optional; omit when unknown
  "deadline": "YYYY-MM-DD",             // optional; omit when unknown
  "priority": "now|next|later|someday", // optional → now
  "notes": "context…",                  // optional
  "subgoals": [
    "a step",                            // string = one step
    { "title": "a group", "subgoals": ["sub-step"] },
    { "title": "scheduled step", "start": "YYYY-MM-DD", "deadline": "YYYY-MM-DD" }
  ]
}`;

/** The full instruction block copied to the clipboard for pasting into any AI. */
export function buildAiPrompt(today: string): string {
  return `You are helping me plan a project for my goal-tracking app.
Output ONLY valid JSON — no prose, no markdown code fences — matching this exact format:

{
  "title": "string (required) — the project name",
  "start": "YYYY-MM-DD (optional; omit when unknown)",
  "deadline": "YYYY-MM-DD (optional; omit when unknown)",
  "priority": "now | next | later | someday (optional, default now) — the commitment horizon",
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
- Break the project into 3–7 concrete subgoals; nest a group only when a step needs its own sub-steps.
- Keep every leaf step small and actionable.
- Today's date is ${today}. Make explicit dates realistic relative to today; omit project dates you cannot infer.
- Output a single project object, or an array of project objects if I ask for several.

Example:
{
  "title": "Launch my side project",
  "priority": "now",
  "subgoals": [
    "Pick one idea",
    { "title": "Build v1", "subgoals": ["Design mockups", "Implement backend"] },
    { "title": "Ship publicly", "start": "${today.slice(0, 4)}-11-01", "deadline": "${today.slice(0, 4)}-11-15" }
  ]
}

Here's what I want to achieve:
<describe your project here>`;
}

// ── Daily subtasks for one step ───────────────────────────────────────────────

/** Prompt to break a single step into day-sized subtasks (drawer AI helper). */
export function buildSubtaskPrompt(goalTitle: string, stepTitle: string, today: string): string {
  return `You are helping me break one step of a project into small daily tasks.

Project: "${goalTitle}"
Step: "${stepTitle}"
Today's date is ${today}.

Break this step into 2–6 subtasks, each small enough to finish in a single focused day.
Output ONLY a JSON array of short strings — no prose, no markdown code fences.

Example:
["Draft the outline", "Write the first section", "Write the second section", "Edit and polish"]`;
}

/**
 * Parse an AI response into subtask titles. Accepts a JSON array of strings, or
 * of `{ title }` objects (forgiving). Trims, drops blanks; empty/invalid rejects.
 */
export function parseSubtasks(raw: string): { titles: string[] } | { error: string } {
  const text = raw.trim();
  if (!text) return { error: 'Paste the AI output first.' };

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "That's not valid JSON — expected an array of subtask strings." };
  }
  if (!Array.isArray(data)) return { error: 'Expected a JSON array of subtask strings.' };

  const titles = data
    .map((d): string => {
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object' && typeof (d as { title?: unknown }).title === 'string') {
        return (d as { title: string }).title;
      }
      return '';
    })
    .map((t) => t.trim())
    .filter(Boolean);

  if (titles.length === 0) return { error: 'No subtasks found in that JSON.' };
  return { titles };
}
