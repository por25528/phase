import type { Goal, Task } from '../db/types';
import type { WorkRef } from './expectedTime';
import { parseDateToken, parseQuickAdd, resolveGoalToken, type QuickAddParse } from './quickAdd';
import { buildSearchIndex, searchEntries, type SearchEntry } from './search';
import { uid } from './tree';

/**
 * The assistant's whole vocabulary: ask what fits, capture a task, complete
 * something, move something. Closed on purpose — an action bar that "mostly
 * understands" free text is a chatbot with worse manners, so an input outside
 * these four shapes gets the examples state, never a guess.
 *
 * Nothing in this module writes. Interpreting produces an INTENT; resolving an
 * intent produces a PROPOSAL that names exactly what confirming it would do;
 * the host maps a confirmed proposal onto existing store actions (`addTask`,
 * `toggleLeaf`/`toggleTask`, `scheduleNode`/`scheduleTask`) and nothing else.
 * `fits` never produces a proposal at all — it is a question, not an action.
 */

export type AssistantIntent =
  | { kind: 'fits'; minutes: number }
  | { kind: 'capture'; draft: QuickAddParse }
  | { kind: 'complete'; query: string }
  | { kind: 'schedule'; query: string; date: string }
  | { kind: 'examples' };

/** One concrete thing a proposal points at. Serializable, ref-shaped for the host. */
export interface AssistantSubject {
  ref: WorkRef;
  title: string;
  goalTitle?: string;
}

export type AssistantProposal =
  | {
      kind: 'capture';
      id: string;
      title: string;
      goalId: string | null;
      date: string | null;
      estimateMin?: number;
    }
  | { kind: 'complete'; id: string; subject: AssistantSubject }
  | { kind: 'schedule'; id: string; subject: AssistantSubject; date: string }
  /**
   * The query matched several open items (or none: empty `choices`). The
   * pending verb and date ride along so choosing a subject can re-form the
   * real proposal without re-parsing anything.
   */
  | {
      kind: 'choose-subject';
      id: string;
      verb: 'complete' | 'schedule';
      date?: string;
      choices: AssistantSubject[];
    };

/** The most subjects an ambiguous query offers. Past five it is a search, not a choice. */
export const MAX_SUBJECT_CHOICES = 5;

/**
 * Peel a trailing natural date off `text`. Tries the last word, then the last
 * two (`aug 24`), through the same `parseDateToken` quick-add uses. The token
 * is removed ONLY when it parses — "buy milk soonish" keeps its last word.
 */
function splitTrailingDate(
  text: string,
  today: string,
): { rest: string; date: string | null } {
  const words = text.trim().split(/\s+/);
  for (const take of [2, 1]) {
    if (words.length <= take) continue;
    const token = words.slice(-take).join('-');
    const date = parseDateToken(token, today);
    if (date) return { rest: words.slice(0, -take).join(' '), date };
  }
  return { rest: text.trim(), date: null };
}

/**
 * Resolve a trailing `for <goal>` clause. Only an exact or unique goal match
 * counts (the same rule `#token` has); anything ambiguous stays in the title,
 * because filing work under the wrong course is quiet and stays wrong.
 */
function splitGoalClause(
  text: string,
  goals: readonly Goal[],
): { rest: string; goalId: string | null } {
  const at = text.toLowerCase().lastIndexOf(' for ');
  if (at === -1) return { rest: text, goalId: null };
  const candidate = text.slice(at + 5).trim();
  const goal = candidate ? resolveGoalToken(candidate, goals) : null;
  if (!goal) return { rest: text, goalId: null };
  return { rest: text.slice(0, at).trim(), goalId: goal.id };
}

const FITS_RE = /^what\s+fits(?:\s+in)?\s+(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours)?\s*\??$/i;
const ADD_RE = /^(?:add|capture)\s+(.+)$/i;
const COMPLETE_RE = /^(?:complete|finish|check\s+off)\s+(.+)$/i;
const SCHEDULE_RE = /^(?:move|schedule|reschedule)\s+(.+)$/i;

export function interpretAssistantInput(
  text: string,
  goals: readonly Goal[],
  today: string,
): AssistantIntent {
  const line = text.trim();
  if (!line) return { kind: 'examples' };

  const fits = FITS_RE.exec(line);
  if (fits) {
    const amount = Number(fits[1]);
    const unit = (fits[2] ?? 'm').toLowerCase();
    const minutes = unit.startsWith('h') ? amount * 60 : amount;
    return minutes > 0 ? { kind: 'fits', minutes } : { kind: 'examples' };
  }

  const add = ADD_RE.exec(line);
  if (add) {
    // Sigil tokens first (`#goal @date ~30m` still work), then the natural
    // forms: a trailing date word, then a `for <goal>` clause.
    const parsed = parseQuickAdd(add[1], goals, today);
    let { title } = parsed;
    let { goalId, date } = parsed;
    if (date === null) {
      const split = splitTrailingDate(title, today);
      title = split.rest;
      date = split.date;
    }
    if (goalId === null) {
      const split = splitGoalClause(title, goals);
      title = split.rest;
      goalId = split.goalId;
    }
    if (!title) return { kind: 'examples' };
    return { kind: 'capture', draft: { ...parsed, title, goalId, date } };
  }

  const complete = COMPLETE_RE.exec(line);
  if (complete) {
    const query = complete[1].trim();
    return query ? { kind: 'complete', query } : { kind: 'examples' };
  }

  const schedule = SCHEDULE_RE.exec(line);
  if (schedule) {
    // "move X to saturday" / "schedule X on friday" / "move X saturday".
    const rest = schedule[1].trim();
    const prep = / (?:to|on|for) /i;
    let query = rest;
    let dateText = '';
    const at = rest.toLowerCase().lastIndexOf(' to ');
    const on = rest.toLowerCase().lastIndexOf(' on ');
    const cut = Math.max(at, on);
    if (cut !== -1 && prep.test(rest)) {
      query = rest.slice(0, cut).trim();
      dateText = rest.slice(cut + 4).trim();
      const date = parseDateToken(dateText.replace(/\s+/g, '-'), today);
      if (query && date) return { kind: 'schedule', query, date };
      return { kind: 'examples' };
    }
    const split = splitTrailingDate(rest, today);
    if (split.date && split.rest) return { kind: 'schedule', query: split.rest, date: split.date };
    return { kind: 'examples' };
  }

  return { kind: 'examples' };
}

function subjectOf(entry: SearchEntry): AssistantSubject {
  const ref: WorkRef = entry.kind === 'step'
    ? { kind: 'step', id: entry.id, goalId: entry.goalId ?? '' }
    : { kind: 'task', id: entry.id, goalId: entry.goalId };
  return {
    ref,
    title: entry.title,
    ...(entry.context === undefined ? {} : { goalTitle: entry.context }),
  };
}

/**
 * The open, actionable things `query` could mean: leaf steps and tasks that
 * are not done and whose project is not archived. An exact normalized title
 * match beats everything; otherwise the palette's own search decides, and more
 * than one hit is a choice for the user, never a guess by the machine.
 */
function resolveSubjects(query: string, goals: Goal[], tasks: Task[]): AssistantSubject[] {
  const entries = buildSearchIndex(goals, tasks, []).filter(
    (e) => (e.kind === 'step' || e.kind === 'task') && !e.container && !e.done && !e.archived,
  );

  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const exact = entries.filter((e) => norm(e.title) === norm(query));
  if (exact.length === 1) return [subjectOf(exact[0])];
  if (exact.length > 1) return exact.slice(0, MAX_SUBJECT_CHOICES).map(subjectOf);

  const hits = searchEntries(entries, query, MAX_SUBJECT_CHOICES);
  return hits.map((h) => subjectOf(h.entry));
}

/**
 * Turn an intent into the preview the user must confirm — or null for the two
 * intents (`fits`, `examples`) that never write and so never need one.
 */
export function proposeAssistant(
  intent: AssistantIntent,
  goals: Goal[],
  tasks: Task[],
): AssistantProposal | null {
  switch (intent.kind) {
    case 'fits':
    case 'examples':
      return null;
    case 'capture':
      return {
        kind: 'capture',
        id: uid(),
        title: intent.draft.title,
        goalId: intent.draft.goalId,
        date: intent.draft.date,
        ...(intent.draft.estimateMin === null ? {} : { estimateMin: intent.draft.estimateMin }),
      };
    case 'complete': {
      const subjects = resolveSubjects(intent.query, goals, tasks);
      if (subjects.length === 1) return { kind: 'complete', id: uid(), subject: subjects[0] };
      return { kind: 'choose-subject', id: uid(), verb: 'complete', choices: subjects };
    }
    case 'schedule': {
      const subjects = resolveSubjects(intent.query, goals, tasks);
      if (subjects.length === 1) {
        return { kind: 'schedule', id: uid(), subject: subjects[0], date: intent.date };
      }
      return {
        kind: 'choose-subject', id: uid(), verb: 'schedule', date: intent.date, choices: subjects,
      };
    }
  }
}

/** The zero-state / unknown-verb examples, one per verb in the closed vocabulary. */
export const ASSISTANT_EXAMPLES: readonly string[] = [
  'What fits in 30m?',
  'Add lab report Friday',
  'Complete problem set 3',
  'Move lab report to Saturday',
];
