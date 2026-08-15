import { MAX_ALTERNATIVES } from './executionAdvisor';

/**
 * How much the shelf puts in front of you.
 *
 * The second of the shelf's two dials, and deliberately the thinner one. A
 * task in Phase carries a title, an estimate, a status, dates and blocks —
 * nothing says how HARD it is — so this cannot mean "give me easy work"
 * without inventing a field somebody has to fill in by hand, forever, for
 * every task. What it can honestly mean is how many choices you are handed,
 * because choosing is the expensive part when you are tired.
 *
 * It changes no ranking and no membership: `timeLens` decides what fits, this
 * decides how much of it you see, and the same work is behind both. That is
 * why it is applied by `AssistantSurface` and never reaches
 * `executionAdvisor` — the advisor holds no presentation, exactly as
 * `agentReads` refuses to let a shelf setting reach the agent surface.
 *
 * Pure view state, like `activeLifeId` on the board: held in memory, never
 * persisted, and never written onto a session. How many options you were shown
 * cannot affect how long you worked, so it is not evidence about anything.
 */

export type DetailLevel = 'low' | 'medium' | 'high';

export const DETAIL_LEVELS: readonly DetailLevel[] = ['low', 'medium', 'high'];

/** What a fresh shelf offers. Not stored, so this is also what every open starts at. */
export const DEFAULT_DETAIL_LEVEL: DetailLevel = 'medium';

export const DETAIL_WORD: Record<DetailLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/**
 * How many alternatives each level offers beside the primary.
 *
 * `MAX_ALTERNATIVES` (2) remains the ceiling and this caps BELOW it, never
 * above — the advisor decides what exists, this decides how much is drawn.
 * `low` is 0, which is what removes the Sidecar column entirely: one card, no
 * menu.
 */
export const ALTERNATIVE_CAP: Record<DetailLevel, number> = {
  low: 0,
  medium: 1,
  high: MAX_ALTERNATIVES,
};

export function isDetailLevel(raw: unknown): raw is DetailLevel {
  return raw === 'low' || raw === 'medium' || raw === 'high';
}
