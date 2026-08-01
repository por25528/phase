import type { Goal, GoalNode, Habit } from '../db/types';
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

/**
 * Whether `priority` is a word this format actually knows.
 *
 * `priorityToColumn` answers 0 — Now — for anything unrecognised, which is the
 * right default for an ABSENT field and the wrong answer for a present one: an
 * LLM writing `"priority": "urgent"` or `"high-priority"` silently landed the
 * project in Now, against the horizon's WIP limit, and nothing said so. Absent
 * still means Now.
 */
export function isKnownPriority(word: unknown): boolean {
  // `undefined`, `null` and `""` all mean "unset", and unset means Now. Only a
  // word that was actually written and is not a horizon is an error — rejecting
  // `""` would turn a field the model left blank into a failed paste.
  if (word === undefined || word === null) return true;
  if (typeof word !== 'string') return false;
  const w = word.trim().toLowerCase();
  if (w === '') return true;
  return (PRIORITY_WORDS as readonly string[]).includes(w)
    || (LEGACY_PRIORITY_WORDS as readonly string[]).includes(w);
}

/**
 * Whether `subgoals` was written as something that is not a list.
 *
 * `null` counts as absent, not malformed — it is the ordinary JSON way to say
 * "none", and an LLM emitting `"subgoals": null` means a project with no steps.
 * The case worth rejecting is the one that silently loses data:
 * `"subgoals": "Pset 1, Pset 2"`, which used to import zero steps.
 */
function isMalformedSubgoals(subgoals: unknown): boolean {
  return subgoals !== undefined && subgoals !== null && !Array.isArray(subgoals);
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
 *
 * `issues`, when supplied, collects a plain-English reason for every skip.
 * Dropping a step silently was survivable for a stray empty string, and not at
 * all for the shape an LLM actually produces: a GROUP object that came back
 * without a `title` returned null and took its entire subtree with it, so
 * "Imported 1 project" could mean half the psets were missing. `parseGoalImport`
 * is strict about the goal's own title; it has no business being lax one level
 * down.
 */
export function buildNode(spec: SubgoalSpec, issues?: string[]): GoalNode | null {
  if (typeof spec === 'string') {
    // A blank string in a list is a trailing-comma artifact, not lost work —
    // skipped silently. Rejecting the whole paste over one is the opposite of
    // the point, which is that a titleless GROUP takes its subtree with it.
    const title = spec.trim();
    return title ? { id: uid(), title, done: false } : null;
  }
  if (!spec || typeof spec !== 'object') {
    issues?.push('a step is neither a string nor an object');
    return null;
  }

  const title = typeof spec.title === 'string' ? spec.title.trim() : '';
  if (!title) {
    const nested = Array.isArray(spec.subgoals) ? spec.subgoals.length : 0;
    issues?.push(
      nested > 0
        ? `a group of ${nested} step${nested === 1 ? '' : 's'} has no "title"`
        : 'a step has no "title"',
    );
    return null;
  }

  if (isMalformedSubgoals(spec.subgoals)) {
    issues?.push(`"${title}" has a "subgoals" that is not a list`);
    return null;
  }

  const children = Array.isArray(spec.subgoals)
    ? (spec.subgoals as SubgoalSpec[])
      .map((child) => buildNode(child, issues))
      .filter((n): n is GoalNode => n !== null)
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

function buildImportedGoal(spec: GoalSpec, issues: string[]): Goal {
  if (isMalformedSubgoals(spec.subgoals)) {
    issues.push('"subgoals" is not a list');
  }
  const nodes = Array.isArray(spec.subgoals)
    ? (spec.subgoals as SubgoalSpec[])
      .map((child) => buildNode(child, issues))
      .filter((n): n is GoalNode => n !== null)
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
 * anything else is removed, leaving the project active. Unknown fields are
 * deliberately left untouched so a later generation migration can consume
 * legacy data before removing it.
 */
export function sanitizeBackupGoal(goal: Goal): Goal {
  const c = (goal as { completedAt?: unknown }).completedAt;
  if (c === undefined || isValidLocalDate(c)) return goal;
  const copy = { ...goal };
  delete (copy as { completedAt?: unknown }).completedAt;
  return copy;
}

/**
 * Normalise a habit's check-ins on the way in from a backup.
 *
 * Goals go through `sanitizeBackupGoal`; habits were passed straight through
 * untouched. `toggleHabitOn` removes ONE matching index, so a duplicated date —
 * from a hand-edited backup, a merge, or anything that wrote the same day twice
 * — made clearing that day take two clicks, with the dot still filled and the
 * streak still counting it after the first. Sorting is a free bonus: `streak`
 * and the weekly count both read this list.
 */
export function sanitizeBackupHabit(habit: Habit): Habit {
  // A hand-edited backup can carry a null in the habits array; `.map` over it
  // would throw out of `importStateFromFile` and surface as "Could not read
  // that file", which blames the file for one bad row.
  if (!habit || typeof habit !== 'object') return habit;
  const raw = habit.checkins;
  if (!Array.isArray(raw)) return { ...habit, checkins: [] };
  const clean = [...new Set(raw.filter(isValidLocalDate))].sort();
  // Compared against the RAW field, not a normalised copy of it — comparing
  // against the copy makes a missing `checkins` look unchanged and hands back
  // the original, undefined field and all.
  const unchanged = clean.length === raw.length && clean.every((d, i) => d === raw[i]);
  return unchanged ? habit : { ...habit, checkins: clean };
}


// ── Getting JSON out of an AI reply ───────────────────────────────────────────
//
// Both import surfaces are fed by pasting a chat response, and a chat response
// is almost never a bare JSON literal. It arrives fenced, wrapped in "Sure!
// Here is your project:", smart-quoted by a rich-text field, or with a trailing
// comma. The SUBTASK importer has tolerated all of that from the start; the
// PROJECT importer — the one the format and the copy-the-prompt button exist
// for — called `JSON.parse` on the raw paste and answered every one of those
// shapes with "That's not valid JSON — check for a missing comma, quote, or
// bracket", which is both a refusal and a wrong diagnosis.

/** Curly quotes are what you get when a reply passes through a rich-text field. */
function normaliseQuotes(text: string): string {
  return text.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
}

/** Pull the body out of a ```json … ``` block, prose and all. */
function stripCodeFence(text: string): string {
  const fenced = text.match(/```[a-zA-Z]*\s*\n?([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

/** Trailing commas before a closer — legal in JS, not in JSON, common from models. */
function dropTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * The JSON value inside an AI reply, or null when there is not one.
 *
 * Deliberately bounded: it unwraps a fence, normalises quotes, drops trailing
 * commas, and — only if the whole string still will not parse — takes the span
 * from the first `{`/`[` to its matching last `}`/`]`. It never repairs the
 * JSON itself, so a genuinely malformed paste still fails and still gets the
 * syntax message, which is then accurate.
 */
function extractJson(raw: string): unknown | null {
  const cleaned = dropTrailingCommas(normaliseQuotes(stripCodeFence(raw)));
  const attempt = (text: string): unknown | null => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  const whole = attempt(cleaned);
  if (whole !== null) return whole;

  // Prose on either side: take the outermost object or array and try again.
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const start = cleaned.indexOf(open);
    const end = cleaned.lastIndexOf(close);
    if (start === -1 || end <= start) continue;
    const span = attempt(cleaned.slice(start, end + 1));
    if (span !== null) return span;
  }
  return null;
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

  const data = extractJson(text);
  if (data === null) {
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
    if (!isKnownPriority(goalSpec.priority)) {
      return {
        error: `Goal #${i + 1}: "${String(goalSpec.priority)}" isn't a horizon — use now, next, later or someday.`,
      };
    }
    // Node-level problems reject the paste, exactly as a missing goal title
    // does. Silently dropping them meant "Imported 1 project" could be true
    // while half the steps were gone — and the one thing a paste has to be is
    // trustworthy, because the user cannot diff JSON against a board by eye.
    const issues: string[] = [];
    const goal = buildImportedGoal(goalSpec, issues);
    if (issues.length > 0) {
      const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : '';
      return { error: `Goal #${i + 1}: ${issues[0]}${more}` };
    }
    goals.push(goal);
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

/** `- `, `* `, `• `, `1. `, `2) ` — whatever a model decided a bullet is. */
function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
}

/**
 * Find and parse a JSON array in `text`, tolerating a trailing comma. Returns
 * null when there is no array to be had, so the caller can fall back to lines.
 */
function tryParseArray(text: string): unknown[] | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  const slice = normaliseQuotes(text.slice(start, end + 1)).replace(/,\s*]$/, ']');
  try {
    const data: unknown = JSON.parse(slice);
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Parse an AI response into subtask titles.
 *
 * Deliberately forgiving: a JSON array (fenced or bare, smart-quoted, with a
 * trailing comma, wrapped in prose), an array of `{ title }` objects, or just a
 * plain list one per line with whatever bullet the model felt like using.
 */
export function parseSubtasks(raw: string): { titles: string[] } | { error: string } {
  const text = raw.trim();
  if (!text) return { error: 'Paste the AI output first.' };

  const unfenced = stripCodeFence(text);
  const data = tryParseArray(unfenced);

  if (data === null) {
    // A model asked for a list very often just writes a list.
    const opensJson = /^[[{]/.test(unfenced);
    const lines = unfenced.split(/\r?\n/).map(stripListMarker).filter(Boolean);
    if (opensJson || lines.length === 0) {
      return { error: "That didn't look like a list — paste a JSON array, or one subtask per line." };
    }
    return { titles: lines };
  }

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

  if (titles.length === 0) return { error: 'No subtasks found in that list.' };
  return { titles };
}
