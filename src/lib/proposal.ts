import { parseEstimateInput } from './estimateInput';
import { parseSubtasks } from './goalImport';
import type { GoalNode } from '../db/types';

/**
 * Minutes past which a task is more than one focused sitting.
 *
 * Ninety minutes is the point at which the work stops fitting into an
 * uninterrupted block most people actually get, so it is where "should I break
 * this up?" becomes a real question rather than a nag. It is a suggestion
 * threshold and nothing else — no roll-up, no capacity maths reads it.
 */
export const SESSION_MIN = 90;

/**
 * Whether a leaf is big enough that breaking it down is worth suggesting.
 *
 * A container is already broken down, and an unestimated leaf is UNKNOWN
 * rather than big — offering to decompose everything nobody has priced yet is
 * how a contextual invitation turns into permanent chrome.
 */
export function looksOversized(node: GoalNode): boolean {
  if (node.children && node.children.length > 0) return false;
  return node.estimateMin !== undefined && node.estimateMin > SESSION_MIN;
}

/**
 * A proposed breakdown, before any of it is real.
 *
 * The flow this replaces was: choose a task, copy a prompt, leave Phase, pick a
 * model, paste, wait, copy the reply, come back, paste it into a dialog,
 * inspect a parser preview, submit. Nine steps, a modal, and visible JSON — and
 * the modal's own body had to explain the workflow because none of it was
 * self-evident. A heavy user tries that once.
 *
 * The parse is the same forgiving one it always was. What changes is what
 * happens next: every row is EDITABLE and SELECTABLE before it becomes work,
 * because a proposal you cannot correct is one you either accept wholesale or
 * throw away, and both of those are worse than typing.
 */
export interface ProposalRow {
  /** Stable across edits, so React keys and the selection survive typing. */
  id: string;
  title: string;
  estimateMin?: number;
  selected: boolean;
}

/**
 * Pull a trailing duration off a proposed line.
 *
 * Models asked for "a task and how long it takes" answer in whatever shape they
 * like — `Read chapter 7 — 45m`, `Read chapter 7 (45m)`, `Read chapter 7 ~45m`.
 * All three become an estimate and a clean title; anything else is left in the
 * title untouched, because half-eating a line is worse than not parsing it.
 */
export function splitEstimate(line: string): { title: string; estimateMin?: number } {
  /*
   * The separator must be preceded by whitespace and the duration must carry a
   * UNIT. Both guards exist because of one line: `Problems 1–15`. Without the
   * space rule the en dash inside a range reads as a separator and the title
   * becomes "Problems 1"; without the unit rule a bare trailing number does the
   * same thing on `Chapter 7 - 15`.
   */
  const match = /^(.*\S)\s+[—–\-~(]\s*([0-9]+(?:\.[0-9]+)?\s*(?:h|hr|hrs|hour|hours|m|min|mins|minutes)(?:\s*[0-9]+\s*m?)?)\s*\)?$/i
    .exec(line.trim());
  if (!match) return { title: line.trim() };
  const title = match[1].trim();
  if (!title) return { title: line.trim() };
  const minutes = parseEstimateInput(match[2]);
  return typeof minutes === 'number' ? { title, estimateMin: minutes } : { title: line.trim() };
}

/**
 * Turn pasted text into rows.
 *
 * `nextId` is injected rather than generated here so the module stays pure and
 * the rows are deterministic in tests — the same reason `Now` is injected into
 * the capacity math.
 */
export function parseProposal(
  raw: string,
  nextId: (index: number) => string,
): { rows: ProposalRow[] } | { error: string } {
  const parsed = parseSubtasks(raw);
  if ('error' in parsed) return parsed;
  const rows = parsed.titles.map((line, i) => ({
    id: nextId(i),
    ...splitEstimate(line),
    // Everything starts accepted. The common case is "yes, all of it, with two
    // words changed", and making the user tick five boxes to reach it would be
    // charging them for the feature working.
    selected: true,
  }));
  return { rows };
}

/** What acceptance would actually create. */
export function acceptedRows(rows: ProposalRow[]): ProposalRow[] {
  return rows.filter((r) => r.selected && r.title.trim().length > 0);
}
