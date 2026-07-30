import type { Goal, GoalNode, Habit, Task } from '../db/types';

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
  /** Project to open. Null for a task/habit with no project tag. */
  goalId: string | null;
  /** Set on step entries so the drawer can scroll to and highlight the node. */
  nodeId?: string;
  done?: boolean;
  archived?: boolean;
}

export interface SearchHit {
  entry: SearchEntry;
  score: number;
  /** Indices into `entry.title` that matched, for highlighting. */
  titleMatches: number[];
}

// A match in the title is worth double one in the project context: typing
// "raft" should surface the Raft project before every step inside it.
const CONTEXT_WEIGHT = 0.5;

// Demotions are larger than any achievable match score, so they act as sort
// tiers rather than nudges — done work never outranks open work on a tie.
const DONE_PENALTY = 5_000;
const ARCHIVED_PENALTY = 10_000;

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
      goalId: goal.id,
      nodeId: node.id,
      done: node.done === true,
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

function scoreEntry(entry: SearchEntry, terms: string[]): SearchHit | null {
  let total = 0;
  const titleMatches = new Set<number>();

  for (const term of terms) {
    const inTitle = matchTerm(entry.title, term);
    const inContext = entry.context ? matchTerm(entry.context, term) : null;

    // Every term must land somewhere, so a multi-term query narrows.
    if (!inTitle && !inContext) return null;

    const titleScore = inTitle ? inTitle.score : 0;
    const contextScore = inContext ? inContext.score * CONTEXT_WEIGHT : 0;

    if (titleScore >= contextScore) {
      total += titleScore;
      inTitle!.indices.forEach((i) => titleMatches.add(i));
    } else {
      total += contextScore;
    }
  }

  let score = total / terms.length;
  if (entry.done) score -= DONE_PENALTY;
  if (entry.archived) score -= ARCHIVED_PENALTY;

  return {
    entry,
    score,
    titleMatches: [...titleMatches].sort((a, b) => a - b),
  };
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
