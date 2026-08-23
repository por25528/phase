/**
 * The parts of a block's drawing that more than one surface has to get right.
 *
 * Three things draw a block on the week grid: `EventBlock` (the bar itself),
 * `BlockGhost` (the drag overlay, which is the bar in the air) and
 * `BlockComposer` (the bar being named, which is the bar before it exists).
 * They have to agree on the spine, the type and the height thresholds or the
 * gesture reads as three different objects — the composer's title being 2px
 * larger than the bar it became was exactly that failure, and it survived for
 * as long as it did because nothing forced the two to be the same number.
 *
 * Only the drawing lives here. Geometry stays in `lib/grid.ts` and the
 * scheduling rules stay in `lib/slot.ts`; this file has no opinion about time.
 */

/**
 * Two lines of 13px text plus padding. Google Calendar enforces a comparable
 * floor and switches to an inline `time — title` for sub-30-minute events.
 */
export const MIN_BLOCK_PX = 34;

/** Below this, there is no room for a second line, so use the inline layout. */
export const COMPACT_BLOCK_PX = 40;

/**
 * At or above this, a block gets its footer RULE — a hairline with the span at
 * one end and the length at the other.
 *
 * Measured, not derived: 56px is a wrapped title line, the rule, and the
 * footer's own line, with the 2px padding at each end. Below it the rule
 * would have to sit on the title, and a cell crowding the thing it describes
 * is worse than no cell — the span keeps its own plain line instead.
 */
export const FOOTER_BLOCK_PX = 56;

/**
 * Every time printed on a block.
 *
 * Mono, because a start and an end are MEASURED FIGURES and mono is already
 * this app's voice for those — the hour gutter, the day-load figures,
 * `stampLabel`, every `sectionLabel`. A block's times were the conspicuous
 * exception, set in the UI face beside a gutter that was not.
 *
 * `text-micro` (11px) rather than `text-meta` (12px): a mono face reads a step
 * larger than the UI face at the same nominal size, and the title has to stay
 * the loudest thing in the block. This is the app's smallest role and the
 * floor — see the note on `micro` in tailwind.config.js.
 */
export const blockTimeCls = 'font-mono text-micro tabular-nums';

/**
 * The padding a block, a ghost and a composer share — room for the spine.
 *
 * 8px on the left, MEASURED and not chosen: the spine is 3px, so 8 clears it by
 * five, and at 10 the footer's span clipped in a real day column. A week column
 * is ~105px (the grid is `min-w-[780px]`, less the 46px axis, over seven days),
 * a block insets 2px per side, and what is left after the borders and this
 * padding is 85px — against the 86px `9am – 10:30am` wants. Two pixels of
 * padding were the whole difference between a time that reads and a time that
 * ends in an ellipsis.
 */
export const blockPadCls = 'pl-[8px] pr-[5px] py-[2px]';

/**
 * The footer rule itself: a hairline pulled out to the block's own edges.
 *
 * The negative margins are the mirror of `blockPadCls` and have to stay that
 * way — a rule that stops short of either edge reads as an underline under the
 * time rather than as a division of the block. Shared because the bar, the
 * ghost and the composer all draw it, and a rule that reached the edge on two
 * of them and not the third is precisely the class of drift this file exists
 * to prevent.
 */
export const blockFootCls =
  'flex items-baseline flex-none border-t border-line-soft -mr-[5px] -ml-[8px] pl-[8px] pr-[5px] pt-[2px] mt-[2px]';

/**
 * The dimension line down a block's left edge.
 *
 * This replaces `border-l-[3px]` and the difference is the CAPS. A coloured
 * border says "this belongs to project X". A capped spine says "this span runs
 * from HERE to HERE, and it belongs to project X" — and the second fact is the
 * one a calendar exists to state. It is the mark a dimension line carries on a
 * technical drawing, which is the reading the whole surface is after.
 *
 * A border cannot do it: caps need real elements, so the spine is painted
 * rather than stroked and takes `projectFillClass` rather than
 * `projectAccentClass`. Both index the same palette, so the hue cannot
 * disagree with itself.
 *
 * `aria-hidden`, and the block's own `overflow-hidden` clips it to the corner
 * radius without restating it.
 */
export function BlockSpine({ className }: { className: string }) {
  return (
    <div aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[3px] pointer-events-none z-[2]">
      <div className={`absolute inset-0 ${className}`} />
      {/*
        The caps. 9px wide, so they read past the 3px spine as a TICK rather
        than as a thickening of it, and 2px tall rather than 1: a hairline cap
        is invisible at 1x, and the caps are the entire difference between a
        dimension line and a coloured edge. Losing them loses the idea.
      */}
      <div className={`absolute left-0 top-0 h-[2px] w-[9px] ${className}`} />
      <div className={`absolute left-0 bottom-0 h-[2px] w-[9px] ${className}`} />
    </div>
  );
}

/**
 * The time a block prints: its full span where there is room, its start alone
 * where there is not.
 *
 * Both are rendered and CSS picks one (`.blk-span` / `.blk-start`, with the
 * `@container` query in index.css), because the answer depends on the block's
 * own width — which is the column's width divided by however many lanes an
 * overlap split it into, and neither of those is knowable here.
 *
 * `aria-hidden` on both: the block's `aria-label` already states the span and
 * the length, so announcing the visible readout would say the time twice and,
 * worse, would announce BOTH forms — the CSS hides one visually and hiding
 * something visually does not remove it from the accessible tree.
 */
export function BlockTime({ start, end }: { start: string; end: string }) {
  return (
    <span aria-hidden="true" className={`${blockTimeCls} text-ink-soft truncate`}>
      <span className="blk-span">{start} – {end}</span>
      <span className="blk-start">{start}</span>
    </span>
  );
}
