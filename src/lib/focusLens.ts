import type { AdviceReason } from './executionAdvisor';
import type { ExpectedTime } from './expectedTime';
import { isValidLocalDate } from './schedule';

/**
 * How much focus the room you are in will support, and what the shelf may
 * offer you because of it.
 *
 * This is a LENS, not a ranking. `executionAdvisor` states its own
 * constitution — "This module deliberately contains no ranking of its own… two
 * opinions is how the assistant and the Today page start disagreeing" — and
 * nothing here touches order. Membership is the only thing a level changes,
 * exactly as `lifeScope` changes which cards the board shows without touching
 * their ranks.
 *
 * The caps are monotone: every level admits everything the level below it
 * admits, plus more. A dial whose middle setting hid something its lowest
 * setting showed would not be a dial.
 */

export type FocusLevel = 'low' | 'medium' | 'high';

export const FOCUS_LEVELS: readonly FocusLevel[] = ['low', 'medium', 'high'];

/** What a new day starts at. Nobody has to remember to put the dial back. */
export const DEFAULT_FOCUS_LEVEL: FocusLevel = 'medium';

/** The longest piece of DISCRETIONARY work each level will offer, in minutes. */
export const FOCUS_CAP: Record<FocusLevel, number> = {
  low: 25,
  medium: 60,
  high: Infinity,
};

export const FOCUS_WORD: Record<FocusLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export function isFocusLevel(raw: unknown): raw is FocusLevel {
  return raw === 'low' || raw === 'medium' || raw === 'high';
}

/**
 * The stored form: the level, and the day it was set. Both, because the reset
 * is arithmetic over the date at READ time rather than a write at midnight —
 * a machine asleep for three days comes back at Medium without anything having
 * run while it slept. `focusSession` banks timestamps for the same reason.
 */
export interface StoredFocusLevel {
  level: FocusLevel;
  date: string; // 'YYYY-MM-DD'
}

export function serializeFocusLevel(stored: StoredFocusLevel): string {
  return JSON.stringify(stored);
}

/**
 * A stored row, or null. Total: any malformed shape — a hand-edited settings
 * row, a value written by a future build, plain corruption — reads as "nothing
 * stored" rather than as an exception at startup.
 */
export function parseStoredFocusLevel(raw: unknown): StoredFocusLevel | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as Record<string, unknown>;
  if (!isFocusLevel(row.level)) return null;
  if (typeof row.date !== 'string' || !isValidLocalDate(row.date)) return null;
  return { level: row.level, date: row.date };
}

/** The level in force today: what was set, if it was set today. */
export function focusLevelFor(stored: StoredFocusLevel | null, today: string): FocusLevel {
  if (!stored || stored.date !== today) return DEFAULT_FOCUS_LEVEL;
  return stored.level;
}

/**
 * Whether the evidence about this work's length clears the level's cap.
 *
 * A history range is judged on its HIGH end — "probably 20 to 45 minutes" does
 * not claim to fit half an hour — and a plain estimate at face value. Both
 * rules are inherited verbatim from the retired `workThatFits`, which is where
 * they were first written down.
 *
 * A `starter` is refused at Low as a RULE and not as arithmetic. It is the
 * app's own 30-minute default standing in for evidence it does not have, and
 * Low is the one level that demands positive evidence of shortness. Medium and
 * High admit it because their caps are not asking for a promise.
 */
export function fitsFocus(level: FocusLevel, expected: ExpectedTime): boolean {
  if (level === 'high') return true;
  if (expected.kind === 'starter') return level !== 'low';
  const cap = FOCUS_CAP[level];
  return expected.kind === 'history' ? expected.highMin <= cap : expected.minutes <= cap;
}

/**
 * The reasons that are FACTS about today rather than offers.
 *
 * Your 2pm block is true whether you are sharp or wrecked, so no level may
 * hide it: a shelf that dropped your afternoon because you told it you were
 * tired would be lying about your day, and being believable at a glance is the
 * one thing this surface has to be.
 */
const COMMITMENT_REASONS: ReadonlySet<AdviceReason> = new Set<AdviceReason>([
  'scheduled-now', 'scheduled-next', 'due', 'committed-today',
]);

export function isCommitment(reason: AdviceReason): boolean {
  return COMMITMENT_REASONS.has(reason);
}

/** The one membership question: does this level offer this piece of work? */
export function admits(
  level: FocusLevel,
  reason: AdviceReason,
  expected: ExpectedTime,
): boolean {
  return isCommitment(reason) || fitsFocus(level, expected);
}
