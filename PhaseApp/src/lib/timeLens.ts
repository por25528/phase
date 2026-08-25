import type { AdviceReason } from './executionAdvisor';
import type { ExpectedTime } from './expectedTime';
import { isValidLocalDate } from './schedule';

/**
 * How long you have, and what the shelf may offer you because of it.
 *
 * This is a LENS, not a ranking. `executionAdvisor` states its own
 * constitution — "This module deliberately contains no ranking of its own… two
 * opinions is how the assistant and the Today page start disagreeing" — and
 * nothing here touches order. Membership is the only thing a level changes,
 * exactly as `lifeScope` changes which cards the board shows without touching
 * their ranks.
 *
 * The number is one you SET, never one Phase predicts. A gap computed from
 * your calendar is wrong exactly when the day goes sideways — a class runs
 * late, a friend calls — which is exactly when this surface gets opened. The
 * one figure it trusts is the one you are holding when you summon it, and it
 * spends that figure on CHOOSING work and never on bounding the session that
 * follows. Once you start, nothing counts down.
 *
 * The caps are monotone: every level admits everything the level below it
 * admits, plus more. A dial whose middle setting hid something its lowest
 * setting showed would not be a dial.
 */

export type TimeLevel = 'low' | 'medium' | 'high';

export const TIME_LEVELS: readonly TimeLevel[] = ['low', 'medium', 'high'];

/** What a new day starts at. Nobody has to remember to put the dial back. */
export const DEFAULT_TIME_LEVEL: TimeLevel = 'medium';

/**
 * The longest piece of DISCRETIONARY work each level will offer, in minutes.
 *
 * `medium` reads `1h` and admits 75: a quarter-hour of slack, because an
 * estimate is a round guess and a 75-minute task is an hour's work that was
 * priced honestly rather than rounded down to pass. The slack is on the MIDDLE
 * setting only — `low` stays exact at 30, since that is the level whose whole
 * promise is a short sitting, and `high` has nothing to be slack about.
 * `TIME_CAP_SLACK_MIN` is that allowance, so the chip word and the cap can be
 * checked against each other in `timeLens.test.ts`.
 */
export const TIME_CAP_SLACK_MIN = 15;

export const TIME_CAP: Record<TimeLevel, number> = {
  low: 30,
  medium: 60 + TIME_CAP_SLACK_MIN,
  high: Infinity,
};

/**
 * What each level is called on the dial. The words are DURATIONS because the
 * caps always were: a control that asked how you felt while filtering by
 * minutes made you translate a mood into a number it already had.
 *
 * 30 rather than the 25 this cap carried for its first life. The number is a
 * self-report now, and nobody has a twenty-five-minute gap — they have half an
 * hour. A threshold nobody would choose is a threshold that gets ignored.
 */
export const TIME_WORD: Record<TimeLevel, string> = {
  low: '30m',
  medium: '1h',
  high: 'Any',
};

export function isTimeLevel(raw: unknown): raw is TimeLevel {
  return raw === 'low' || raw === 'medium' || raw === 'high';
}

/**
 * The stored form: the level, and the day it was set. Both, because the reset
 * is arithmetic over the date at READ time rather than a write at midnight —
 * a machine asleep for three days comes back at Medium without anything having
 * run while it slept. `focusSession` banks timestamps for the same reason.
 */
export interface StoredTimeLevel {
  level: TimeLevel;
  date: string; // 'YYYY-MM-DD'
}

export function serializeTimeLevel(stored: StoredTimeLevel): string {
  return JSON.stringify(stored);
}

/**
 * A stored row, or null. Total: any malformed shape — a hand-edited settings
 * row, a value written by a future build, plain corruption — reads as "nothing
 * stored" rather than as an exception at startup.
 */
export function parseStoredTimeLevel(raw: unknown): StoredTimeLevel | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as Record<string, unknown>;
  if (!isTimeLevel(row.level)) return null;
  if (typeof row.date !== 'string' || !isValidLocalDate(row.date)) return null;
  return { level: row.level, date: row.date };
}

/** The level in force today: what was set, if it was set today. */
export function timeLevelFor(stored: StoredTimeLevel | null, today: string): TimeLevel {
  if (!stored || stored.date !== today) return DEFAULT_TIME_LEVEL;
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
export function fitsWindow(level: TimeLevel, expected: ExpectedTime): boolean {
  if (level === 'high') return true;
  if (expected.kind === 'starter') return level !== 'low';
  const cap = TIME_CAP[level];
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
  level: TimeLevel,
  reason: AdviceReason,
  expected: ExpectedTime,
): boolean {
  return isCommitment(reason) || fitsWindow(level, expected);
}
