import { PX_PER_MINUTE } from '../../lib/grid';
import { clockLabel } from '../../lib/clock';
import { fmtMinutes } from '../../lib/effort';
import { projectFillClass, projectTintClass } from '../../lib/projectColour';
import {
  BlockSpine, BlockTime, blockFootCls, blockPadCls, blockTimeCls,
  MIN_BLOCK_PX, COMPACT_BLOCK_PX, FOOTER_BLOCK_PX,
} from './blockChrome';

/**
 * The bar in the air.
 *
 * This replaces a 220px text pill, and the pill's failure was not that it was
 * plain — it was that it answered the wrong question. A pill says WHAT you
 * picked up, which you already know, because you are holding it. What a drag
 * on a calendar needs to say is WHERE IT WILL GO, and the two halves of that
 * answer are this ghost's height (how much of the day it takes) and its time
 * line (which minutes), neither of which a pill can carry.
 *
 * It is deliberately the same drawing as `EventBlock` — same spine, same
 * padding, same footer rule at the same threshold — because the ghost is a
 * PROMISE about what will be on the grid a moment from now, and a promise
 * drawn differently from the thing it promises is a worse promise.
 *
 * `startMin` is the RESOLVED start from `previewPlacement`, not the raw aim.
 * When there is no resolution — the pointer is off the calendar, or the day is
 * booked solid — the ghost states the length alone rather than inventing a
 * time it might not get.
 */
export function BlockGhost({
  title, durationMin, goalId, startMin,
}: {
  title: string;
  durationMin: number;
  /** Owning project, or null for a loose task. Drives the identity colour. */
  goalId: string | null;
  /** Resolved start, or null when the drop has nowhere to land right now. */
  startMin: number | null;
}) {
  const heightPx = Math.max(durationMin * PX_PER_MINUTE, MIN_BLOCK_PX);
  const compact = heightPx < COMPACT_BLOCK_PX;
  const hasFooter = heightPx >= FOOTER_BLOCK_PX;
  /*
   * The resolved START, matching the bar it is promising — see the note on the
   * footer in `EventBlock`. A ghost is the same width as the block it will
   * become, so a span clips here for exactly the same reason it clips there.
   *
   * With no resolution yet (off the calendar, or a day booked solid) it states
   * the LENGTH instead: the ghost is never blank, and "1h 30m, nowhere yet" is
   * a truer thing to say than a time it may not get.
   */
  const label = startMin === null ? fmtMinutes(durationMin) : clockLabel(startMin);
  const endLabel = startMin === null ? null : clockLabel(startMin + durationMin);

  return (
    <div
      /*
       * `w-full`: dnd-kit sizes the overlay to the ACTIVE node's rect, so a bar
       * dragged off the grid keeps its column's width and a row dragged from
       * the rail keeps the rail's. Fixing a width here would make one of the
       * two lie about the space it is going to take.
       *
       * `shadow-today` and `border-accent` are the lift. `scale-[1.018]` is
       * applied on mount rather than declared statically, so it animates FROM
       * rest — a ghost that appears already lifted has no lift.
       */
      className={`relative blk-cq w-full rounded-[6px] overflow-hidden ${blockPadCls} border border-accent bg-panel text-badge leading-[1.2] text-ink cursor-grabbing shadow-today motion-safe:animate-[block-lift_130ms_cubic-bezier(.2,.9,.3,1)_both]`}
      style={{ height: `${heightPx}px` }}
      aria-hidden="true"
    >
      <div className={`absolute inset-0 pointer-events-none ${projectTintClass(goalId)}`} />
      <BlockSpine className={projectFillClass(goalId)} />

      {compact ? (
        <div className="relative truncate">
          <span className={`${blockTimeCls} text-muted mr-[4px]`}>{label}</span>
          <span className="font-medium">{title}</span>
        </div>
      ) : (
        <div className="relative h-full flex flex-col">
          <div className="flex-1 min-h-0 overflow-hidden">
            <div className="font-medium line-clamp-3">{title}</div>
          </div>
          {hasFooter ? (
            <div className={blockFootCls}>
              {/* The length, ONLY while there is no resolved time to state —
                  the ghost is never empty, and "90m in the air over nowhere"
                  is more useful than a blank rule. See EventBlock's note on
                  why the length is not a standing cell. */}
              {endLabel === null
                ? <span className={`${blockTimeCls} text-ink-soft truncate`}>{label}</span>
                : <BlockTime start={label} end={endLabel} />}
            </div>
          ) : (
            <div className="flex-none">
              {endLabel === null
                ? <span className={`${blockTimeCls} text-ink-soft truncate`}>{label}</span>
                : <BlockTime start={label} end={endLabel} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
