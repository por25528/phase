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
 * 12% over the OLED panel (#0D0D0E) is invisible, so the dark theme takes 22%.
 * Ink stays `text-ink` at both: a near-black/near-white on a 12–22% wash clears
 * AA comfortably, whereas colouring the text to match would land around 4.2:1
 * and fail it.
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
