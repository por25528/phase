import type { Goal } from '../db/types';
import { addDays, parseD } from './dates';
import { parseDateInput } from './dateInput';
import { parseEstimateInput } from './estimateInput';

/**
 * One line of typing, parsed into a task.
 *
 * The capture flow used to be a modal with a title field, three date pills, an
 * optional date picker, a "Choose project" toggle and a project select — a form
 * for the highest-frequency action in the product, and one that forced a date
 * decision before it would let go. This is the same information as three
 * optional tokens inside the sentence you were already typing.
 *
 * The parse is deliberately conservative. A token it cannot resolve is LEFT IN
 * THE TITLE and reported, never silently eaten: `#physics` with no matching
 * goal has to stay visible as text, because a capture tool that quietly drops
 * part of what you typed is worse than one that never parsed anything.
 */
export interface QuickAddToken {
  /** Exactly as typed, including the sigil. */
  raw: string;
  kind: 'goal' | 'date' | 'estimate';
  /** What it resolved to, in words — this is what the preview shows. */
  label: string;
}

/**
 * A bare temporal word left in the title that WOULD have scheduled the task if
 * it had carried an `@`. It is a suggestion, never an auto-date: capture and
 * commitment are different acts, so the word stays in the title and `date`
 * stays null until the user accepts it.
 */
export interface DateSuggestion {
  /** The literal phrase found in the title, original casing, e.g. `by thursday`. */
  match: string;
  /** The sigil form that resolves to `date`, e.g. `@tomorrow`, `@monday`, `@+7d`. */
  sigil: string;
  /** What that sigil resolves to, `YYYY-MM-DD`. */
  date: string;
}

export interface QuickAddParse {
  title: string;
  /** Resolved tokens, in the order they appeared. */
  tokens: QuickAddToken[];
  /** Tokens that looked like a sigil but matched nothing. Still in the title. */
  unresolved: string[];
  goalId: string | null;
  /**
   * `null` means UNSCHEDULED, and that is the default.
   *
   * The old modal defaulted to Today, so every thought captured on a Tuesday
   * became a Tuesday commitment and the day filled up with things nobody had
   * decided to do. Capture and commitment are different acts.
   */
  date: string | null;
  estimateMin: number | null;
  /**
   * A `@`-less date word the parser could not act on but recognised. Present
   * only when nothing scheduled the task and no `@` token was even attempted —
   * one date decision at a time. The composer renders it as one appliable
   * offer; a warning the user cannot act on just moves the failure later.
   */
  dateSuggestion: DateSuggestion | null;
}

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Lower-case, strip anything that is not a letter or digit. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * A date token: `@today`, `@tomorrow`, `@fri`, `@+3d`, `@aug-24`, `@2026-08-24`.
 *
 * Hyphens stand in for the spaces a token cannot contain, so `@aug-24` reaches
 * `parseDateInput` as `aug 24` and gets that module's real-date validation —
 * which is what stops `@feb-30` becoming March 2.
 */
export function parseDateToken(token: string, today: string): string | null {
  const t = token.trim().toLowerCase();
  if (!t) return null;
  if (t === 'today' || t === 'tod') return today;
  if (t === 'tomorrow' || t === 'tmr' || t === 'tom') return addDays(today, 1);

  const rel = /^\+(\d+)d$/.exec(t);
  if (rel) return addDays(today, Number(rel[1]));

  const dow = DOW.indexOf(t.slice(0, 3));
  if (dow !== -1 && t.length <= 9) {
    // The nearest one that is today or later: "fri" on a Friday means today,
    // not a week away.
    const from = parseD(today).getDay();
    return addDays(today, (dow - from + 7) % 7);
  }

  return parseDateInput(t.replace(/-/g, ' '), today) ?? parseDateInput(t, today);
}

/**
 * Resolve `#token` against the goals that can still take work.
 *
 * Exact normalised title wins, then a unique prefix, then a unique substring.
 * Anything matching two goals is UNRESOLVED rather than guessed at — filing a
 * task under the wrong goal is quiet, and stays wrong.
 */
export function resolveGoalToken(token: string, goals: readonly Goal[]): Goal | null {
  const needle = norm(token);
  if (!needle) return null;
  const open = goals.filter((g) => !g.completedAt);

  const exact = open.filter((g) => norm(g.title) === needle);
  if (exact.length === 1) return exact[0];

  const prefix = open.filter((g) => norm(g.title).startsWith(needle));
  if (prefix.length === 1) return prefix[0];

  const inside = open.filter((g) => norm(g.title).includes(needle));
  return inside.length === 1 ? inside[0] : null;
}

/**
 * A duration token WITHOUT the `~` sigil — `2h`, `30m`, `1h30`.
 *
 * A token carrying a time unit has no other meaning in a task title, so it is
 * an estimate on its own. A BARE INTEGER is deliberately refused: "chapter 4",
 * "problem 3", "6.006" are quantities, and reading one as a minute count is the
 * false positive this guard exists to avoid. The unit (`h`/`m`) is what
 * separates the two; `parseEstimateInput` does the rest, so the bounds and the
 * `~` form stay in one place.
 */
function bareDurationMinutes(word: string): number | null {
  if (!/[hm]/i.test(word)) return null;
  const parsed = parseEstimateInput(word);
  return typeof parsed === 'number' ? parsed : null;
}

const WEEKDAY = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun';

/** The leftmost bare temporal phrase, longest-form first so `next monday` wins over `monday`. */
const TEMPORAL_RE = new RegExp(
  `\\b(next\\s+week|next\\s+(?:${WEEKDAY})|by\\s+(?:${WEEKDAY})|today|tomorrow|tonight|(?:${WEEKDAY}))\\b`,
  'i',
);

/** The sigil body a matched phrase would need to carry to schedule the task. */
function sigilBodyFor(match: string): string {
  const m = match.trim().toLowerCase();
  if (m === 'next week') return '+7d';
  if (m === 'today' || m === 'tonight') return 'today';
  if (m === 'tomorrow') return 'tomorrow';
  // `next friday` / `by friday` / bare `friday` all reduce to the weekday word,
  // which `parseDateToken` resolves to the nearest upcoming occurrence.
  return m.replace(/^(?:next|by)\s+/, '');
}

/**
 * Find a `@`-less date word in a title and report the token that would work.
 *
 * Pure: it schedules nothing. The composer turns the result into a one-click
 * offer; accepting it rewrites the input via `applyDateSuggestion`, so the
 * sigil it carries must resolve back to the same `date` it names.
 */
export function detectBareTemporal(title: string, today: string): DateSuggestion | null {
  const hit = TEMPORAL_RE.exec(title);
  if (!hit) return null;
  const match = hit[1];
  const body = sigilBodyFor(match);
  const date = parseDateToken(body, today);
  if (!date) return null;
  return { match, sigil: `@${body}`, date };
}

const RE_META = /[.*+?^${}()|[\]\\]/g;

/**
 * Rewrite the bare temporal phrase in `text` into its sigil form, in place.
 *
 * Works on the raw input, not the parsed title, so a re-parse both strips the
 * words from the title and sets the date — one source of truth. Whitespace is
 * matched loosely (`\s+`) because the composer's text may not be normalised.
 */
export function applyDateSuggestion(text: string, s: DateSuggestion): string {
  const parts = s.match.trim().split(/\s+/).map((p) => p.replace(RE_META, '\\$&'));
  const re = new RegExp(`\\b${parts.join('\\s+')}\\b`, 'i');
  return text.replace(re, s.sigil);
}

export function parseQuickAdd(
  text: string,
  goals: readonly Goal[],
  today: string,
): QuickAddParse {
  const tokens: QuickAddToken[] = [];
  const unresolved: string[] = [];
  let goalId: string | null = null;
  let date: string | null = null;
  let estimateMin: number | null = null;

  const words = text.split(/(\s+)/);
  const kept: string[] = [];

  // An explicit `~` estimate is authoritative wherever it sits, so a bare
  // duration yields to it — otherwise a stray "2h" could override the "~90m"
  // the user typed on purpose.
  const hasExplicitEstimate = words.some(
    (w) => w[0] === '~' && w.length > 1 && typeof parseEstimateInput(w.slice(1)) === 'number',
  );

  for (const word of words) {
    const sigil = word[0];
    const body = word.slice(1);

    // Only the FIRST of each kind counts. A second `@` is text: two dates on
    // one task is not a thing the model can hold, and picking one silently
    // would make the other disappear.
    if (sigil === '#' && body && goalId === null) {
      const goal = resolveGoalToken(body, goals);
      if (goal) {
        goalId = goal.id;
        tokens.push({ raw: word, kind: 'goal', label: goal.title });
        continue;
      }
      unresolved.push(word);
      kept.push(word);
      continue;
    }
    if (sigil === '@' && body && date === null) {
      const parsed = parseDateToken(body, today);
      if (parsed) {
        date = parsed;
        tokens.push({ raw: word, kind: 'date', label: parsed });
        continue;
      }
      unresolved.push(word);
      kept.push(word);
      continue;
    }
    if (sigil === '~' && body && estimateMin === null) {
      const parsed = parseEstimateInput(body);
      if (typeof parsed === 'number') {
        estimateMin = parsed;
        tokens.push({ raw: word, kind: 'estimate', label: `${parsed}m` });
        continue;
      }
      unresolved.push(word);
      kept.push(word);
      continue;
    }

    // A duration with no `~` is still an estimate — but only the first one, and
    // only when no explicit `~` claimed the slot.
    if (estimateMin === null && !hasExplicitEstimate) {
      const bare = bareDurationMinutes(word);
      if (bare !== null) {
        estimateMin = bare;
        tokens.push({ raw: word, kind: 'estimate', label: `${bare}m` });
        continue;
      }
    }
    kept.push(word);
  }

  const title = kept.join('').replace(/\s+/g, ' ').trim();
  // Only offer a date word when nothing scheduled the task AND no `@` was even
  // attempted — a second date guess on top of a failed one is noise.
  const dateAttempted = unresolved.some((u) => u[0] === '@');
  const dateSuggestion =
    date === null && !dateAttempted ? detectBareTemporal(title, today) : null;

  return {
    title,
    tokens,
    unresolved,
    goalId,
    date,
    estimateMin,
    dateSuggestion,
  };
}
