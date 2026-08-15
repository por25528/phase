import { DEMAND_RANK, type ResolvedDemand } from './demand';
import type { AdviceReason } from './executionAdvisor';
import { isCommitment } from './timeLens';
import { isValidLocalDate } from './schedule';

/**
 * How much focus you have, and what the shelf may offer you because of it.
 *
 * The second of the shelf's two dials and the honest version of a control that
 * used to be called Focus while capping how many alternatives were DRAWN
 * (`shelfDetail`, retired). `timeLens` asks how long you have; this asks how
 * much of you is available, and reads the `demand` the work declares.
 *
 * A LENS, never a ranking: order never changes, membership does — the same move
 * `lifeScope` makes on the board.
 */

export type FocusLevel = 'low' | 'medium' | 'high';

export const FOCUS_LEVELS: readonly FocusLevel[] = ['low', 'medium', 'high'];

/** What a new day starts at. Nobody has to remember to put the dial back. */
export const DEFAULT_FOCUS_LEVEL: FocusLevel = 'medium';

export const FOCUS_WORD: Record<FocusLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/** The heaviest `DEMAND_RANK` each level will offer. Monotone, so a dial is a dial. */
export const FOCUS_ADMITS: Record<FocusLevel, number> = {
  low: DEMAND_RANK.light,
  medium: DEMAND_RANK.moderate,
  high: DEMAND_RANK.deep,
};

export function isFocusLevel(raw: unknown): raw is FocusLevel {
  return raw === 'low' || raw === 'medium' || raw === 'high';
}

/**
 * Whether this level offers work of this demand.
 *
 * **An untagged item is admitted at every level, and that is deliberate.**
 * `fitsWindow` refuses a `starter` at its narrowest setting as a RULE, because
 * duration always has fallback evidence — history, an estimate, and failing
 * both a 30-minute guess. Demand has none: there is no history that reveals how
 * hard something was, and no default worth inventing. Treating untagged as
 * `moderate` would hide most of a real backlog on the strength of a value
 * nobody entered, and falling back to the duration cap would make this a SECOND
 * time dial, filtering on the axis the dial beside it just filtered on.
 *
 * So this only ever removes work that has positively claimed to be heavier than
 * the level allows. On an untagged database it does nothing at all.
 */
export function admitsDemand(level: FocusLevel, demand: ResolvedDemand | undefined): boolean {
  if (demand === undefined) return true;
  return DEMAND_RANK[demand.level] <= FOCUS_ADMITS[level];
}

/**
 * The one membership question, commitments included.
 *
 * `isCommitment` is imported from `timeLens` rather than restated: your 2pm
 * block is a FACT about today, and one definition of that is what stops the two
 * dials disagreeing about which rows are facts.
 */
export function admitsWork(
  level: FocusLevel,
  reason: AdviceReason,
  demand: ResolvedDemand | undefined,
): boolean {
  return isCommitment(reason) || admitsDemand(level, demand);
}

/**
 * The stored form: the level, and the day it was set.
 *
 * Both, because the reset is arithmetic over the date at READ time rather than
 * a write at midnight — a machine asleep for three days comes back at the
 * default without anything having run while it slept.
 */
export interface StoredFocusLevel {
  level: FocusLevel;
  date: string; // 'YYYY-MM-DD'
}

export function serializeFocusLevel(stored: StoredFocusLevel): string {
  return JSON.stringify(stored);
}

/** Total: any malformed shape reads as "nothing stored" rather than throwing at startup. */
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
