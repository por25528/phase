import type { Goal, Life } from '../db/types';

/**
 * The vocabulary for a person's handful of lives.
 *
 * Everything here is a pure read. The one rule that is not obvious: a goal's
 * `lifeId` MAY point at a life that no longer exists, and every reader here
 * resolves that to "unassigned" rather than treating it as an error. That is
 * what makes deleting a life cheap — it rewrites `lives` and nothing else — and
 * it is the same licence `Session.nodeId` already has.
 */

/**
 * Three.
 *
 * Scarcity is the mechanism this product already trusts, and a fourth life is
 * the point at which "which life is this?" stops being obvious and the concept
 * degrades into the tag system CLAUDE.md refuses.
 */
export const MAX_LIVES = 3;

export function canAddLife(lives: Life[]): boolean {
  return lives.length < MAX_LIVES;
}

export function sortedLives(lives: Life[]): Life[] {
  return [...lives].sort((a, b) => a.order - b.order);
}

/** The `order` a newly created life should take: one past the highest in use. */
export function nextLifeOrder(lives: Life[]): number {
  return lives.reduce((max, l) => Math.max(max, l.order), -1) + 1;
}

/** The life a goal belongs to, or null when unassigned OR pointing at a deleted life. */
export function lifeOf(goal: Goal, lives: Life[]): Life | null {
  if (goal.lifeId === undefined) return null;
  return lives.find((l) => l.id === goal.lifeId) ?? null;
}

/**
 * Lives off an imported backup, made safe.
 *
 * Mirrors `sanitizeBackupGoal`/`sanitizeBackupHabit` in `goalImport.ts` — the
 * file is user-editable JSON, so every field is checked. The cap is applied
 * HERE as well as at creation: a backup written by a build with a higher limit
 * must not smuggle a fourth life past a build that enforces three.
 */
export function sanitizeBackupLives(raw: unknown): Life[] {
  if (!Array.isArray(raw)) return [];
  const out: Life[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (out.length === MAX_LIVES) break;
    if (!row || typeof row !== 'object') continue;
    const { id, title, order } = row as Partial<Life>;
    if (typeof id !== 'string' || id === '') continue;
    if (typeof title !== 'string') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title,
      order: typeof order === 'number' && Number.isFinite(order) ? order : out.length,
    });
  }
  return out;
}
