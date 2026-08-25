import type { Goal, Life } from '../db/types';
import { lifeOf } from './lives';
import { sharedProjectPrefix } from './sharedPrefix';

/**
 * What one horizon's cards may stop repeating to each other.
 *
 * A board card states six things, and on a full board most of them are the
 * SAME six words ten times over: `CU` under eight cards, `Midterm — ` at the
 * head of six titles. Neither is wrong on any one card and both are noise
 * across a bay, which is the exact shape `lib/sharedPrefix.ts` was written for
 * on the assistant shelf — a label earns its ink by DISCRIMINATING, and one
 * that every row carries discriminates nothing.
 *
 * So this is a per-BAY reading, not a per-card one: the unit is the column,
 * because a column is what a person reads down. It is a LENS and never an edit
 * — `goal.title` and `goal.lifeId` are untouched, the full title stays in the
 * card's `title` tooltip and in the rename editor, and the drag overlay
 * (`GoalCardVisual`) passes no bay at all and therefore states the card in
 * full, the same way the shelf's primary recommendation does while its
 * alternatives are cut back.
 *
 * Both rules refuse rather than guess when the bay is mixed, so nothing is ever
 * hidden from one card that the card beside it is still showing.
 */
export type BayFace = {
  /** Every card here belongs to the same named life, so none of them says so. */
  hideLife: boolean;
  /** The head of the title every card here shares, or `''`. */
  titlePrefix: string;
};

/** A bay that hides nothing — the drag overlay, and any single-card column. */
export const FULL_FACE: BayFace = { hideLife: false, titlePrefix: '' };

/**
 * The lens for one horizon's `goals`, in board order.
 *
 * `hideLife` needs a NAMED life on every card: unassigned already prints
 * nothing, so a bay of two unassigned goals plus one `CU` must keep saying
 * `CU` — dropping it there would leave the reader to infer a life from an
 * absence, which is what the other two cards' absence already means. One card
 * shares nothing with anybody, hence the `length < 2` refusal that
 * `sharedProjectPrefix` makes for itself.
 */
export function bayFace(goals: readonly Goal[], lives: readonly Life[]): BayFace {
  if (goals.length < 2) return FULL_FACE;
  const first = lifeOf(goals[0]!, lives as Life[]);
  const hideLife = first != null
    && goals.every((g) => lifeOf(g, lives as Life[])?.id === first.id);
  return { hideLife, titlePrefix: sharedProjectPrefix(goals.map((g) => g.title)) };
}
