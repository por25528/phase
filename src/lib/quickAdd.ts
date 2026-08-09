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
    kept.push(word);
  }

  return {
    title: kept.join('').replace(/\s+/g, ' ').trim(),
    tokens,
    unresolved,
    goalId,
    date,
    estimateMin,
  };
}
