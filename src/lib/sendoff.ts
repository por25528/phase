/**
 * What the shelf says as it closes behind you.
 *
 * `source` is REQUIRED and is the point of this file. Famous-quote
 * misattribution is endemic — most of the Einstein, Ford, Twain and Churchill
 * lines in circulation were never said by them — so a quote that cannot name
 * where it is documented does not go in this list. That makes the list
 * checkable rather than a matter of taste, and it is the field to fill in
 * FIRST when adding one. Every entry here was checked against a primary
 * source or a reputable citation of one — never a quote-aggregator site —
 * before it was added; a Marie Curie line originally proposed for this list
 * was dropped for exactly that reason: it traces only to quote-aggregator
 * sites and a mismatched "as quoted in" citation, not to anything she or a
 * documented witness is known to have said.
 *
 * Selection is derived from the moment the send-off begins rather than from
 * `Math.random()`: it varies every session and a test can still pin it, which
 * is the same trick the rest of the codebase uses to stay testable.
 */

export interface Sendoff {
  text: string;
  who: string;
  /** Where the line is documented. Not decoration — the admission ticket. */
  source: string;
}

export const SENDOFFS: readonly Sendoff[] = [
  {
    text: 'The first principle is that you must not fool yourself — and you are the easiest person to fool.',
    who: 'Richard Feynman',
    source: '"Cargo Cult Science," Caltech commencement address, 1974',
  },
  {
    text: 'A wealth of information creates a poverty of attention.',
    who: 'Herbert Simon',
    source: '"Designing Organizations for an Information-Rich World," in Computers, Communications, and the Public Interest, 1971',
  },
  {
    text: 'Nothing in life is as important as you think it is, while you are thinking about it.',
    who: 'Daniel Kahneman',
    source: '"The Focusing Illusion," Edge.org, 2011',
  },
  {
    text: "If you're not embarrassed by the first version of your product, you've launched too late.",
    who: 'Reid Hoffman',
    source: '@reidhoffman on X, March 29, 2017',
  },
  {
    text: 'Startups take off because the founders make them take off.',
    who: 'Paul Graham',
    source: '"Do Things That Don\'t Scale," paulgraham.com, 2013',
  },
  {
    text: 'Real artists ship.',
    who: 'Steve Jobs',
    source: 'Andy Hertzfeld, "Credit Where Due," folklore.org, on the Macintosh team retreat, January 1983',
  },
];

/** One minute is the grain: two sessions started in the same minute are the same session's worth of intent. */
export function sendoffFor(nowMs: number): Sendoff {
  const index = Math.abs(Math.floor(nowMs / 60_000)) % SENDOFFS.length;
  return SENDOFFS[index];
}
