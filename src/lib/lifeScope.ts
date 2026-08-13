import type { Goal, Life } from '../db/types';
import { lifeOf, sortedLives } from './lives';
import { NOW_WIP_LIMIT } from './plan';

/**
 * Which slice of the board is on screen: every goal, one named life, or the
 * goals that belong to no life at all.
 *
 * A bare `string` is a `Life.id`. It MAY name a life that no longer exists —
 * `removeLife` can delete the one you are looking at — and `resolveScope` is
 * what turns that into `'all'` at read time, the same licence `Goal.lifeId`
 * and `Session.nodeId` already hold.
 */
export type LifeScope = 'all' | 'unassigned' | string;

export interface LifeTab {
  scope: LifeScope;
  label: string;
}

/** True when a goal belongs to no life, INCLUDING one whose life was deleted. */
function isUnassigned(goal: Goal, lives: Life[]): boolean {
  return lifeOf(goal, lives) === null;
}

export function resolveScope(current: LifeScope, lives: Life[]): LifeScope {
  if (current === 'all' || current === 'unassigned') return current;
  return lives.some((l) => l.id === current) ? current : 'all';
}

/**
 * The strip: All, then each life, then Unassigned when it holds something.
 *
 * Empty when no life has been named — a lone `All` tab is chrome that explains
 * nothing to someone who has never made a life, and `Goals.tsx` renders no
 * strip at all in that case.
 *
 * A named life is kept even when empty (you made it); the unassigned group is
 * omitted when empty (it is not a life). That asymmetry is not invented here —
 * it is the semantics slice 1 wrote down for the `groupByLife` it deliberately
 * did not build.
 *
 * Completed goals do not summon the Unassigned tab. They live in their own
 * collapsed section, and a tab that exists only to hold finished work is a tab
 * you open once.
 */
export function lifeTabs(lives: Life[], goals: Goal[]): LifeTab[] {
  if (lives.length === 0) return [];
  const tabs: LifeTab[] = [{ scope: 'all', label: 'All' }];
  for (const l of sortedLives(lives)) tabs.push({ scope: l.id, label: l.title });
  if (goals.some((g) => !g.completedAt && isUnassigned(g, lives))) {
    tabs.push({ scope: 'unassigned', label: 'Unassigned' });
  }
  return tabs;
}

/** Identity for `'all'` — the caller's array, not a copy, so memo keys hold. */
export function goalsInScope(goals: Goal[], scope: LifeScope, lives: Life[]): Goal[] {
  if (scope === 'all') return goals;
  if (scope === 'unassigned') return goals.filter((g) => isUnassigned(g, lives));
  return goals.filter((g) => lifeOf(g, lives)?.id === scope);
}

/**
 * Three per life — and for `All`, the sum of the caps of the tabs beside it.
 *
 * Stated that way so the figure on `All` is the arithmetic of the tabs you can
 * see and can be checked by eye rather than believed. It moves when you add a
 * life or empty the unassigned group, which is honest: the groups on the board
 * changed.
 *
 * The clamp is load-bearing, not defensive. `lifeTabs` returns an EMPTY array
 * when no life has been named — the common case for anyone who has not used
 * this feature — and the bare product would be `3 × -1`.
 */
export function nowLimit(scope: LifeScope, tabs: LifeTab[]): number {
  if (scope !== 'all') return NOW_WIP_LIMIT;
  return Math.max(NOW_WIP_LIMIT, NOW_WIP_LIMIT * (tabs.length - 1));
}

/**
 * A goal created on the Startup board belongs to Startup.
 *
 * Applied at the composer's callback in `Goals.tsx` rather than inside
 * `NewGoalModal`, so the modal stays a pure builder and there is one place
 * that knows what the board is currently showing.
 */
export function withScopeLife<T extends Goal>(goal: T, scope: LifeScope): T {
  if (scope === 'all' || scope === 'unassigned') return goal;
  return { ...goal, lifeId: scope };
}
