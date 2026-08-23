import { minuteToPx, PX_PER_MINUTE, Z_BLOCK_REVEALED } from '../../lib/grid';
import { clockLabel } from '../../lib/clock';
import { blockTimeCls, MIN_BLOCK_PX } from './blockChrome';

/**
 * Where the block in the air will land, drawn in the column it will land in.
 *
 * The slot is RESOLVED (`previewPlacement`), never the raw aim. A drag over a
 * busy morning slides to the nearest gap that fits, and an outline that
 * followed the pointer instead would promise 10:00 and deliver 11:30 — the
 * feedback arriving after the commit, which is the whole complaint the day
 * headings' `fits`/`full` chips already answer on the other axis. This is that
 * answer at the minute rather than at the day.
 *
 * `border-dashed border-accent` with an `accent/10` wash is the app's drop
 * vocabulary and is deliberately the same drawing `DayCanvas`'s draw-preview
 * uses — both mean "a block is going to be here and is not here yet". It is
 * the one place `border-dashed` may be spent besides that preview and a
 * guessed-hour block, per CLAUDE.md.
 *
 * It EASES between slots rather than jumping. When the resolution steps past
 * occupied work the outline travels there, and a slide reads as a decision the
 * app made where a jump reads as a glitch. `motion-safe` so the app's
 * reduced-motion block reaches it.
 *
 * `aria-hidden`: it states nothing the drag does not already state — the ghost
 * carries the same span in its own footer, and the day heading carries the
 * fits/full verdict. A live region announcing a new time on every pointer move
 * would be unusable.
 */
export function LandingOutline({ startMin, durationMin }: { startMin: number; durationMin: number }) {
  return (
    <div
      data-testid="landing-outline"
      aria-hidden="true"
      className="absolute left-[2px] right-[2px] rounded-[6px] border border-dashed border-accent bg-accent/10 pointer-events-none motion-safe:transition-[top,height] motion-safe:duration-[110ms] motion-safe:ease-out"
      style={{
        top: `${minuteToPx(startMin)}px`,
        height: `${Math.max(durationMin * PX_PER_MINUTE, MIN_BLOCK_PX)}px`,
        /*
         * Above the blocks it is landing among — which is the whole point: a
         * dashed outline hidden behind the bar it is going to displace states
         * nothing, and `vacating` excludes the bar being moved, so on every
         * move-drag the outline lands directly on top of it. `bg-accent/10`
         * therefore washes OVER that bar rather than under it. That is
         * deliberate, and `pointer-events-none` is what keeps it free: the
         * block's own controls stay clickable through the wash.
         *
         * It shares `Z_BLOCK_REVEALED` with `BlockComposer` and with a revealed
         * `EventBlock`, and among equal z-indices DOM order decides. Both of
         * those render AFTER the outline inside the day column (see the
         * `WeekGrid` children in `Plan.tsx`), so both sit above it — which is
         * the order we want, the composer especially, since it is a textbox.
         * It is a TIE, not its own layer, and it cannot be made one: CSS
         * `z-index` is an integer, so there is no value strictly between
         * `Z_BLOCK` (1) and `Z_BLOCK_REVEALED` (2), and buying one would mean
         * renumbering the whole scale in `lib/grid.ts` to separate three things
         * that already paint in the right order. If that scale ever is
         * renumbered, this is the layer that wants the gap.
         */
        zIndex: Z_BLOCK_REVEALED,
      }}
    >
      {/* The START, like every other time on this grid — the outline's own
          height already draws the extent, and a full span needs 113px in a
          column that has 88. See the footer note in `EventBlock`. */}
      <span className={`absolute left-[8px] top-[3px] ${blockTimeCls} text-accent font-semibold`}>
        {clockLabel(startMin)}
      </span>
    </div>
  );
}
