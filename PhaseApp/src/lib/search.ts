import type { Goal, GoalNode, Habit, Task } from '../db/types';
import { stripAssetRefs } from './notes';
import { isDone } from './status';

// Everything the palette can find. The store already holds the whole dataset in
// memory, so this is a derived projection rebuilt per keystroke-batch rather
// than a persisted index.
export type SearchKind = 'project' | 'step' | 'task' | 'habit';

export interface SearchEntry {
  kind: SearchKind;
  id: string;
  title: string;
  /** The parent project's title — shown as the disambiguating second line. */
  context?: string;
  /** Note markdown with opaque asset references removed. */
  body?: string;
  /** Project to open. Null for a task/habit with no project tag. */
  goalId: string | null;
  /** Set on step entries so the drawer can scroll to and highlight the node. */
  nodeId?: string;
  /**
   * A row-level disambiguator, so two entries reading "6.006 Problem Set 4" can
   * be told apart. A task's committed `date`, or a step's `deadline` — the one
   * date each carries. Absent when neither has one.
   */
  date?: string;
  /**
   * A node with children. The palette's verbs read this: a container has no
   * status and no estimate, so "Mark as done" and "Schedule today" are not
   * things that can be done to it.
   */
  container?: boolean;
  done?: boolean;
  archived?: boolean;
}

export interface SearchHit {
  entry: SearchEntry;
  score: number;
  /** Indices into `entry.title` that matched, for highlighting. */
  titleMatches: number[];
  /** A short excerpt from a matching note body, when one matched. */
  snippet?: string;
}

// A match in the title is worth double one in the project context: typing
// "raft" should surface the Raft project before every step inside it. These
// weights only order matches WITHIN a tier — the context/body signal can never
// cross the title tier below.
const CONTEXT_WEIGHT = 0.5;
const BODY_WEIGHT = 0.25;

// Demotions are larger than any achievable match score, so they act as sort
// tiers rather than nudges — done work never outranks open work on a tie.
const DONE_PENALTY = 5_000;
const ARCHIVED_PENALTY = 10_000;

// A match that lives only in the context/body — never the entry's own title —
// is demoted a full tier below every title match. Scoring context at 0.5×
// meant a matching goal's whole subtree outranked a direct title hit in a
// different goal ("pset" put "Implement + memoize" above "6.006 Problem Set
// 4"). Context is a tiebreak among title matches now, never a way to outrank
// one. Smaller than DONE_PENALTY, so an open context-only hit still sorts
// above a done title hit — the open-beats-done tier stays the strongest.
const NO_TITLE_PENALTY = 2_000;

function flattenNodes(
  nodes: GoalNode[],
  goal: Goal,
  archived: boolean,
  out: SearchEntry[],
): void {
  for (const node of nodes) {
    out.push({
      kind: 'step',
      id: node.id,
      title: node.title,
      context: goal.title,
      ...(node.notes === undefined ? {} : { body: stripAssetRefs(node.notes) }),
      goalId: goal.id,
      nodeId: node.id,
      ...(node.deadline === undefined ? {} : { date: node.deadline }),
      container: Boolean(node.children && node.children.length > 0),
      done: isDone(node),
      archived,
    });
    if (node.children?.length) flattenNodes(node.children, goal, archived, out);
  }
}

export function buildSearchIndex(
  goals: Goal[],
  tasks: Task[],
  habits: Habit[],
): SearchEntry[] {
  const entries: SearchEntry[] = [];

  for (const goal of goals) {
    const archived = goal.completedAt != null;
    entries.push({
      kind: 'project',
      id: goal.id,
      title: goal.title,
      ...(goal.notes === undefined ? {} : { body: stripAssetRefs(goal.notes) }),
      goalId: goal.id,
      archived,
    });
    flattenNodes(goal.nodes, goal, archived, entries);
  }

  const goalTitle = new Map(goals.map((g) => [g.id, g.title]));

  for (const task of tasks) {
    entries.push({
      kind: 'task',
      id: task.id,
      title: task.title,
      context: task.goalId ? goalTitle.get(task.goalId) : undefined,
      goalId: task.goalId,
      ...(task.date === undefined ? {} : { date: task.date }),
      done: task.done,
    });
  }

  for (const habit of habits) {
    entries.push({
      kind: 'habit',
      id: habit.id,
      title: habit.title,
      context: habit.goalId ? goalTitle.get(habit.goalId) : undefined,
      goalId: habit.goalId,
    });
  }

  return entries;
}

interface TermMatch {
  score: number;
  indices: number[];
}

// Score one term against one string. A contiguous run beats a scattered
// subsequence; starting at the string or at a word boundary beats mid-word.
function matchTerm(haystack: string, term: string): TermMatch | null {
  const lower = haystack.toLowerCase();

  const at = lower.indexOf(term);
  if (at !== -1) {
    const isStart = at === 0;
    const isWordStart = isStart || /[^a-z0-9]/.test(lower[at - 1]);
    const score = 600 + (isStart ? 200 : 0) + (isWordStart ? 100 : 0);
    const indices = Array.from({ length: term.length }, (_, i) => at + i);
    return { score, indices };
  }

  // Fall back to a subsequence walk so initialisms ("pmpf") still match.
  const indices: number[] = [];
  let cursor = 0;
  for (const ch of term) {
    const found = lower.indexOf(ch, cursor);
    if (found === -1) return null;
    indices.push(found);
    cursor = found + 1;
  }
  // Tighter spans are better matches than ones sprayed across the string.
  const span = indices[indices.length - 1] - indices[0] + 1;
  const density = term.length / span;
  return { score: 100 + Math.round(density * 100), indices };
}

function makeSnippet(body: string, indices: number[]): string {
  const matchStart = indices[0];
  const matchEnd = indices[indices.length - 1] + 1;
  const context = Math.max(0, Math.floor((80 - (matchEnd - matchStart)) / 2));
  let start = Math.max(0, matchStart - context);
  let end = Math.min(body.length, start + 80);
  if (end - start < 80) start = Math.max(0, end - 80);
  return `${start > 0 ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`;
}

function scoreEntry(entry: SearchEntry, terms: string[]): SearchHit | null {
  let total = 0;
  const titleMatches = new Set<number>();
  let snippet: string | undefined;
  // Whether the entry's own TITLE matched any term. A context/body-only entry
  // is demoted a whole tier, so it can never outrank a real title hit.
  let titled = false;

  for (const term of terms) {
    const inTitle = matchTerm(entry.title, term);
    const inContext = entry.context ? matchTerm(entry.context, term) : null;
    const inBody = entry.body ? matchTerm(entry.body, term) : null;

    // Every term must land somewhere, so a multi-term query narrows.
    if (!inTitle && !inContext && !inBody) return null;

    // The title matching is the tier signal, tracked independently of which
    // signal wins the magnitude below — a weak title match losing the max to a
    // strong context match still keeps the entry in the title tier, and still
    // highlights.
    if (inTitle) {
      titled = true;
      inTitle.indices.forEach((i) => titleMatches.add(i));
    }

    const titleScore = inTitle ? inTitle.score : 0;
    const contextScore = inContext ? inContext.score * CONTEXT_WEIGHT : 0;
    const bodyScore = inBody ? inBody.score * BODY_WEIGHT : 0;

    total += Math.max(titleScore, contextScore, bodyScore);
    if (inBody && snippet === undefined) snippet = makeSnippet(entry.body!, inBody.indices);
  }

  let score = total / terms.length;
  if (!titled) score -= NO_TITLE_PENALTY;
  if (entry.done) score -= DONE_PENALTY;
  if (entry.archived) score -= ARCHIVED_PENALTY;

  const hit: SearchHit = {
    entry,
    score,
    titleMatches: [...titleMatches].sort((a, b) => a - b),
  };
  if (snippet !== undefined) hit.snippet = snippet;
  return hit;
}

export function searchEntries(
  entries: SearchEntry[],
  query: string,
  limit = 12,
): SearchHit[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const entry of entries) {
    const hit = scoreEntry(entry, terms);
    if (hit) hits.push(hit);
  }

  // Stable tiebreak on title so equal-scoring results don't reshuffle between
  // keystrokes — a jumping list is unusable with the keyboard.
  hits.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
  return hits.slice(0, limit);
}
