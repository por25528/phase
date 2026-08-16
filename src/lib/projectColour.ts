/**
 * Project identity colour, hashed from the id. No picker: a palette of six
 * assigned automatically is one less decision per project.
 */
export const PROJECT_COLOURS = 6;

/**
 * The block treatment per palette entry, written out in full.
 *
 * Tailwind's content scanner reads source TEXT — it cannot evaluate
 * `bg-proj-${i}/12`, so a template literal would generate no CSS at all and
 * every block would render untinted. This array is the whole reason the module
 * exists rather than the index being interpolated at the call site.
 *
 * Two alphas per entry. 12% over the white panel is a legible wash; the same
 * 12% over the warm charcoal panel (#1E1D1B) is far too faint, so the dark
 * theme takes 22%. Ink stays `text-ink` at both: a near-black/near-white on a
 * 12–22% wash clears AA comfortably, whereas colouring the text to match would
 * land around 4.2:1 and fail it.
 */
const BLOCK_CLASSES = [
  'bg-proj-0/12 dark:bg-proj-0/22 border-l-proj-0',
  'bg-proj-1/12 dark:bg-proj-1/22 border-l-proj-1',
  'bg-proj-2/12 dark:bg-proj-2/22 border-l-proj-2',
  'bg-proj-3/12 dark:bg-proj-3/22 border-l-proj-3',
  'bg-proj-4/12 dark:bg-proj-4/22 border-l-proj-4',
  'bg-proj-5/12 dark:bg-proj-5/22 border-l-proj-5',
] as const;

/**
 * A loose task belongs to no project. Inventing a colour for it would assert a
 * membership that does not exist, so it gets the panel and the neutral line.
 */
const NEUTRAL = 'bg-panel border-l-line-2';

/**
 * FNV-1a, 32-bit. Chosen over `sum of charCodes % 6` because ids come from
 * `uid()` — 7 characters of base-36 — and a plain sum clusters badly on short
 * strings of a fixed length, which would hand most projects the same colour.
 * `>>> 0` keeps it unsigned so the modulo can never go negative.
 */
export function projectColourIndex(goalId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < goalId.length; i += 1) {
    hash ^= goalId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % PROJECT_COLOURS;
}

/** Fill plus left rail for a block belonging to `goalId` (null ⇒ loose task). */
export function projectBlockClass(goalId: string | null): string {
  return goalId === null ? NEUTRAL : BLOCK_CLASSES[projectColourIndex(goalId)];
}

/**
 * The rail's group spine — the same hue that project's blocks wear on the
 * calendar, as a plain left border.
 *
 * Written out in full for the same reason `BLOCK_CLASSES` is: Tailwind's
 * scanner reads source TEXT and cannot evaluate `border-proj-${i}`, so an
 * interpolated class generates no CSS and every spine would render invisible.
 *
 * No fill and no alpha. A block on the calendar is an object and takes a wash;
 * a spine is a grouping mark on a 249px rail, and a tinted background behind
 * four rows of text would be the loudest thing in the sidebar.
 */
const SPINE_CLASSES = [
  'border-proj-0',
  'border-proj-1',
  'border-proj-2',
  'border-proj-3',
  'border-proj-4',
  'border-proj-5',
] as const;

/** Left rail for a rail group belonging to `goalId` (null ⇒ loose tasks). */
export function projectSpineClass(goalId: string | null): string {
  return goalId === null ? 'border-line-2' : SPINE_CLASSES[projectColourIndex(goalId)];
}
