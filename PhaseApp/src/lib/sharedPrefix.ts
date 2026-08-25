/**
 * The part of a project's name that every project on screen already said.
 *
 * The assistant shelf offers one primary recommendation and up to
 * `MAX_ALTERNATIVES` others, each labelled with the project it belongs to. When
 * those projects share a prefix — `Midterm — 2301265 …`, `Midterm — 2301230 …`,
 * `Midterm — 2301274 …`, which is what a term's worth of courses actually looks
 * like — the word `Midterm` is stated four times on a 620px card and
 * distinguishes nothing. The primary states the project in FULL; the
 * alternatives only have to say what makes them different.
 *
 * Both functions are pure and neither knows about the shelf. What they know is
 * the one rule that keeps this from being clever: a prefix is only shared if
 * EVERY label has it, so nothing is ever hidden from one row that another row
 * is still showing.
 */

/** A character that can end a prefix: anything that is not a letter or a digit. */
const BOUNDARY = /[^\p{L}\p{N}]/u;

/** Below this a prefix saves nothing and only costs the reader a guess. */
const MIN_PREFIX = 4;

/** Below this the remainder is not a name any more, it is a fragment. */
const MIN_REMAINDER = 2;

/**
 * The longest prefix all of `titles` share, cut back to a token boundary — or
 * `''` when there is nothing worth dropping.
 *
 * Four refusals, and each one is a case where stripping would lie or confuse:
 *
 *   - fewer than two labels: one thing shares a prefix with nobody;
 *   - any label missing: a row with no project cannot vouch that the prefix
 *     was already stated, and the shelf's loose tasks are exactly that row;
 *   - a prefix shorter than `MIN_PREFIX`: a shared `A ` is not a fact;
 *   - a remainder shorter than `MIN_REMAINDER` on any label: two names that
 *     differ only in their last character would each be cut to that character.
 *
 * The cut-back to a boundary is what stops `Midterm — 2301265` and
 * `Midterm — 2301230` yielding the prefix `Midterm — 230` and leaving a reader
 * with `1265` and `1230` — numbers that are no longer the numbers they name.
 */
export function sharedProjectPrefix(titles: readonly (string | undefined)[]): string {
  if (titles.length < 2) return '';
  if (titles.some((title) => !title)) return '';
  const names = titles as readonly string[];

  let end = 0;
  const [first] = names;
  while (end < first.length && names.every((name) => name[end] === first[end])) end += 1;
  // Shrink until the prefix ends ON a boundary character, so the remainder
  // starts at the beginning of a word rather than in the middle of one.
  while (end > 0 && !BOUNDARY.test(first[end - 1]!)) end -= 1;

  const prefix = first.slice(0, end);
  if (prefix.length < MIN_PREFIX) return '';
  if (names.some((name) => name.length - prefix.length < MIN_REMAINDER)) return '';
  return prefix;
}

/**
 * `title` with `prefix` removed, or `title` untouched when it does not carry
 * one. Never returns an empty string: a label that vanished would read as work
 * belonging to no project, which is a different fact.
 */
export function dropSharedPrefix(title: string, prefix: string): string {
  if (prefix.length === 0 || !title.startsWith(prefix)) return title;
  const rest = title.slice(prefix.length).trimStart();
  return rest.length === 0 ? title : rest;
}
