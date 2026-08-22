import { useEffect, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { minuteToPx, PX_PER_MINUTE, Z_BLOCK, Z_BLOCK_REVEALED } from '../../lib/grid';
import { clockLabel } from '../../lib/clock';
import { fmtMinutes } from '../../lib/effort';
import { SLOT_GRANULARITY_MIN } from '../../lib/slot';
import { projectFillClass, projectTintClass } from '../../lib/projectColour';
import type { PlanDragData } from './dropTarget';
import { containerDragAttributes } from '../../lib/dragAttributes';
import { IconCheck, IconX } from '../../components/Icons';
import {
  BlockSpine, blockFootCls, blockPadCls, blockTimeCls,
  MIN_BLOCK_PX, COMPACT_BLOCK_PX, FOOTER_BLOCK_PX,
} from './blockChrome';

/**
 * A block on the grid — either committed work or a calendar event.
 *
 * `estimated: false` means the block's height is a guess (`DEFAULT_SLOT_MIN`
 * fallback from `durationOf`), not a real estimate — rendered with a dashed
 * border so a guessed hour never reads as a real commitment.
 */
export interface GridBlock {
  key: string;
  kind: 'step' | 'task' | 'busy';
  title: string;
  startMin: number;
  endMin: number;
  done: boolean;
  estimated: boolean;
  /** Owning project, or null for a loose task. Drives the identity colour. */
  goalId?: string | null;
}

export function EventBlock({
  block, lane, laneCount, onRemove, onComplete, drag, onResize,
  domId, revealed = false,
}: {
  block: GridBlock;
  lane: number;
  laneCount: number;
  onRemove?: () => void;
  /**
   * Marks the block's work done/undone in place. Without it the only route to
   * completion is unscheduling first, which is the opposite of what finishing
   * a piece of work means.
   *
   * Unlike `onRemove` and `onResize`, callers pass this on past weeks too:
   * recording that something got done is not rescheduling history, and a block
   * on a past week has no other route to done (it is placed, so it never
   * appears in the backlog). See the `readOnly` note in DayBlocks.tsx.
   */
  onComplete?: () => void;
  /** Present only for placed work — a busy/calendar block is never draggable. */
  drag?: PlanDragData;
  onResize?: (minutes: number) => void;
  /** Stable DOM id so the command palette can scroll to this block. */
  domId?: string;
  /** The palette is pointing at this block — mark it. */
  revealed?: boolean;
}) {
  const isBusy = block.kind === 'busy';

  // Hooks cannot be conditional, so useDraggable is always called with a
  // stable id; `disabled: !drag` (busy/calendar blocks) makes `listeners`
  // undefined. `attributes` is returned unconditionally by dnd-kit regardless
  // of `disabled` — so it must be spread only when `drag` is set, same as
  // `ref`/`listeners` below, or a busy block becomes focusable for a drag it
  // cannot start. What it carries beyond `tabIndex` is stripped by
  // `containerDragAttributes`: this element holds real buttons, so it must not
  // claim `role="button"` itself. That fix used to live here as "don't spread
  // it for busy blocks"; it now applies to work blocks too.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: drag ? `${drag.kind}:${drag.id}` : `busy:${block.key}`,
    data: drag,
    disabled: !drag,
  });

  // Live resize preview: while dragging the handle, the block's own displayed
  // height tracks the pointer instead of waiting for `onResize` to commit —
  // same idea as SpanBar's onPreview, just held locally since only this
  // block's geometry needs to react to it.
  const [previewMinutes, setPreviewMinutes] = useState<number | null>(null);
  /*
   * The press. dnd-kit's activation constraint is 5px, so a bar does nothing
   * at all for the first five pixels of a drag — and a surface that answers
   * late reads as slow even when the drag itself is instant. This is the
   * cheapest honest answer: the bar acknowledges the pointer on `pointerdown`,
   * before the sensor has decided anything. It is suppressed once the drag
   * actually arms (`!isDragging` below), where the ghost's own lift takes over.
   */
  const [pressed, setPressed] = useState(false);
  /*
   * Released from ANYWHERE. Once dnd-kit arms the drag the pointer is over the
   * grid rather than over this bar, so a `pointerup` handler on the element
   * itself never fires and the press would latch — leaving the bar drawn 0.6%
   * small for the rest of the session. `window`, both events, and only while
   * something is actually pressed.
   */
  useEffect(() => {
    if (!pressed) return;
    const clear = () => setPressed(false);
    window.addEventListener('pointerup', clear);
    window.addEventListener('pointercancel', clear);
    return () => {
      window.removeEventListener('pointerup', clear);
      window.removeEventListener('pointercancel', clear);
    };
  }, [pressed]);

  const top = minuteToPx(block.startMin);
  const committedMinutes = block.endMin - block.startMin;
  const minutes = previewMinutes ?? committedMinutes;
  // A 1.6% floor works out to ~11px, which clipped the start-time line
  // entirely and left a hairline with text floating over the gridline.
  // Every calendar accepts a little overlap for very short events instead.
  const heightPx = Math.max(minutes * PX_PER_MINUTE, MIN_BLOCK_PX);
  const width = 100 / laneCount;
  // A property of the block's own duration now, not of the week it sits on.
  // The old form compared a percentage of a variable grid height, so the same
  // 30-minute block was compact on a busy week and not on a quiet one.
  const compact = heightPx < COMPACT_BLOCK_PX;
  /*
   * Tall enough for the footer rule — a hairline with the span at one end and
   * the LENGTH at the other, which is the `RuleHeader` grammar restated inside
   * a block.
   *
   * Gated on height rather than offered always, because a cell that has to sit
   * on the title is worse than no cell. Below this the span keeps its own
   * line; below `COMPACT_BLOCK_PX` it shares one with the title.
   */
  const hasFooter = heightPx >= FOOTER_BLOCK_PX;
  /*
   * What the footer prints: the START, and nothing else.
   *
   * Measured against a real week column, twice, and both richer forms lost.
   * The grid is `min-w-[780px]`, less the 46px axis, over seven days — ~105px a
   * column, 84px inside a block after the insets, borders and padding. A span
   * (`9am – 10:30am`) needs 86 and an afternoon one (`10:15am – 11:45am`) needs
   * 113, so the shipped design already clipped every pm block to `12:45pm – 2:…`
   * and a duration cell beside it would have clipped every block at all.
   *
   * A start alone needs 46 at its widest and therefore never clips — and the
   * two facts it drops are both DRAWN rather than written. The end is where the
   * bar's bottom edge meets the hour axis; the length is the bar's height, at
   * one pixel per minute. Writing either one into the narrowest cell on the
   * screen, badly, to restate what the geometry already states exactly, is the
   * trade this surface should never make.
   *
   * It is also what the compact layout below has always done — so the block now
   * reads the same way at every height, rather than switching vocabularies at
   * 40 pixels. Both dropped facts are in the tooltip and the accessible name.
   *
   * While resizing it states the PREVIEW's start (unchanged) and the badge on
   * the grip states the new end and length — the two readouts of one gesture,
   * neither of them guessing.
   */
  const startLabel = clockLabel(block.startMin);

  return (
    <div
      ref={drag ? setNodeRef : undefined}
      id={domId}
      {...(drag ? containerDragAttributes(attributes, { keyboardDraggable: true }) : {})}
      {...(drag ? listeners : {})}
      /*
       * COMPOSED with dnd-kit's own handler, never replacing it. A bare
       * `onPointerDown` here sits after the `{...listeners}` spread, and later
       * JSX props win — so it would silently overwrite the sensor's activator
       * and dragging would stop working entirely, with no error anywhere.
       */
      onPointerDown={drag ? (e) => {
        setPressed(true);
        listeners?.onPointerDown?.(e);
      } : undefined}
      // The block's own name. Without it the accessible name fell back to the
      // concatenation of its children — "pset Complete pset Unschedule pset".
      // The LENGTH lives here and in the tooltip, because the footer rule has
      // no room for it in a ~105px column — see the note on the rule below.
      aria-label={`${block.title}, ${clockLabel(block.startMin)}–${clockLabel(block.endMin)}, ${fmtMinutes(committedMinutes)}`}
      /*
       * `bg-panel` is an OPAQUE ground, and the tint is a layer over it.
       *
       * A block's colour has always been an alpha (12% light, 22% dark), which
       * was fine over a plain column. The hours outside the working window are
       * `.hatch` now, so an alpha there composited over a 45° stripe and the
       * block read as texture rather than as an object sitting on the sheet.
       * Painting the ground first also puts the hue on exactly the background
       * `projectColour.test.ts` measures its contrast against.
       *
       * `border-line-soft` on ALL FOUR sides now. The left edge used to carry
       * the project hue as a 3px border; it is a drawn SPINE below, because a
       * border cannot carry the end caps that make a block read as a measured
       * span rather than as a card with a coloured edge.
       */
      className={`group absolute rounded-[6px] overflow-hidden text-badge leading-[1.2] border ${
        isBusy
          // The same left inset as a work block, though it carries no spine:
          // the footer rule's negative margin is written against that inset,
          // and a calendar event's title belongs at the same x as every bar
          // beside it rather than 5px to their left.
          ? `bg-hover border-line-2 text-muted italic ${blockPadCls}`
          : `bg-panel border-line-soft text-ink touch-none ${blockPadCls} ${
            block.done ? 'opacity-55 line-through' : ''
          } ${block.estimated ? 'border-solid' : 'border-dashed border-line-2'} cursor-grab ${
            // The press and the lift. `motion-safe` rather than a hand-rolled
            // media query: the whole app's reduced-motion escape hatch is the
            // block in index.css, and this is one more thing it must reach.
            'motion-safe:transition-[transform,box-shadow] motion-safe:duration-[110ms] motion-safe:ease-out'
          } ${pressed && !isDragging ? 'scale-[.994] shadow-card' : ''}`
      } ${
        /*
         * The hole. A bar in the air is not a bar that vanished, so the space
         * it came from keeps its outline until the drop spends it — and a
         * dashed outline is exactly what this app already spells a pending
         * placement with. `opacity-40` (what this replaces) left a ghost of the
         * bar behind the ghost of the bar.
         */
        isDragging ? 'bg-transparent border-dashed border-line-2 [&>*]:opacity-0' : ''
      } ${revealed ? 'ring-2 ring-inset ring-accent' : ''}`}
      style={{
        top: `${top}px`,
        height: `${heightPx}px`,
        left: `calc(${lane * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        zIndex: revealed ? Z_BLOCK_REVEALED : Z_BLOCK,
      }}
      title={`${block.title} · ${clockLabel(block.startMin)}–${clockLabel(block.endMin)} · ${fmtMinutes(committedMinutes)}${block.estimated ? '' : ' · no estimate'}`}
    >
      {/* The project tint, over the opaque ground and under everything else.
          Clipped by the root's own `overflow-hidden`, so it takes the corners
          without restating the radius. */}
      {!isBusy && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 pointer-events-none ${projectTintClass(block.goalId ?? null)}`}
        />
      )}

      {/* The dimension line. A busy block is not yours and states no identity,
          so it keeps the plain box. */}
      {!isBusy && <BlockSpine className={projectFillClass(block.goalId ?? null)} />}

      {/* Below two lines' worth of height, collapse to `9am Title` on one row
          rather than rendering a title with its time cut off. */}
      {compact ? (
        <div className="relative truncate">
          <span className={`${blockTimeCls} text-muted mr-[4px]`}>{clockLabel(block.startMin)}</span>
          <span title={block.title} className="font-medium">{block.title}</span>
        </div>
      ) : (
        <div className="relative h-full flex flex-col">
          {/*
            TWO elements, and the nesting is the point.
            A tall block has room to wrap, so the title clamps at three lines
            rather than truncating to one — but `flex-1 min-h-0` and
            `line-clamp-3` cannot live on the SAME element: the clamp needs
            `display:-webkit-box` and the flex sizing needs a flex item, and
            with both the clamp stopped cutting (a four-line title rendered
            four lines with an ellipsis on the third).
            Moving the fill to the footer via `mt-auto` does not work either —
            it needs free space to distribute, and the container was hugging
            its content. So the outer div is the flex item that takes the slack
            and the inner one is the clamp, each doing one job.
          */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <div className="font-medium line-clamp-3">{block.title}</div>
          </div>
          {hasFooter ? (
            /*
             * The footer rule: a hairline, and the span PINNED to the bottom of
             * the block rather than floating under the title with the rest of
             * the height empty beneath it. That is the whole of what this buys,
             * and it is what turns a bar into a bounded object.
             *
             * The negative margins pull it out to the block's own edges, so it
             * divides the BLOCK rather than drawing a line inside the padding —
             * a rule that stops short of both edges reads as an underline.
             *
             * ONE cell, and that was measured rather than chosen. The design
             * called for a second cell stating `1h 30m` on the reading edge,
             * the `RuleHeader` grammar restated inside a block — and a real
             * week column cannot hold it. A column is ~105px, which leaves 85px
             * inside the block, and a duration cell takes 46 of them: the span
             * then had 39px and clipped at `9am – 10:…`, on every block, to
             * state a figure the block's own HEIGHT already states. The grid is
             * one pixel per minute, so a 90-minute bar is 90 pixels tall; the
             * length is the one fact here that is drawn rather than written.
             * It went to the tooltip and the accessible name instead, where
             * there is room for it and it costs nothing.
             */
            <div className={blockFootCls}>
              <span className={`${blockTimeCls} text-ink-soft truncate`}>{startLabel}</span>
            </div>
          ) : (
            /* The full span, not just the start. A calendar's job is to say how
               long something takes; the end time was already in the aria-label
               and the tooltip, so it was known and simply not shown. */
            /* The same start, for the same reason — so the block reads one
               way at every height instead of switching vocabularies at 56px.
               This layout has no rule, only the height for a second line. */
            <div className={`${blockTimeCls} text-ink-soft truncate flex-none`}>{startLabel}</div>
          )}
        </div>
      )}
      {onComplete && !isBusy && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onComplete}
          // The label tracks `done` because the action is a toggle — a control
          // announced as "Complete" that actually reopens the work is the same
          // lie as a button naming a date it does not open.
          aria-label={`${block.done ? 'Reopen' : 'Complete'} ${block.title}`}
          // Hover-revealed like its ✕ sibling. It used to be the one control
          // that showed at rest, so every block carried a grey tick it did not
          // need — noise on a surface whose whole job is to be scannable. A
          // DONE block keeps it visible: that tick is state, not an offer.
          className={`absolute w-[24px] h-[24px] grid place-items-center text-faint hover:text-accent ${
            block.done ? 'opacity-100 transition-opacity duration-150' : 'quiet-control'
          } ${
            compact ? 'top-1/2 -translate-y-1/2 right-[22px] bg-panel/90 rounded-[4px]' : 'top-0 right-[20px]'
          }`}
        >
          <IconCheck size={12} />
        </button>
      )}
      {onRemove && !isBusy && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          aria-label={`Unschedule ${block.title}`}
          // 24x24 target on a block that can itself be only 34px tall — the
          // icon stays small, the hit area does not.
          className={`absolute right-0 w-[24px] h-[24px] grid place-items-center text-faint hover:text-warn quiet-control ${
            compact ? 'top-1/2 -translate-y-1/2 bg-panel/90 rounded-[4px]' : 'top-0'
          }`}
        >
          {/* Was `×` (U+00D7, the MULTIPLICATION SIGN) while every other dismiss
              in the app was `✕` — the same affordance drawn with two different
              characters, one of which was not even in the font. */}
          <IconX size={12} />
        </button>
      )}
      {onResize && !isBusy && (
        <ResizeHandle
          startMin={block.startMin}
          startDuration={committedMinutes}
          pxPerMinute={PX_PER_MINUTE}
          onPreview={setPreviewMinutes}
          onResize={onResize}
        />
      )}
    </div>
  );
}

/**
 * The bottom-edge resize grip. Uses pointer capture (the idiom already used
 * by `src/views/timeline/SpanBar.tsx`) rather than `window`-level
 * `pointermove`/`pointerup` listeners: capture ties the remaining pointer
 * events to this element and to React's own handlers, so there is nothing to
 * leak — no `pointercancel` gap, no unmount-without-cleanup case, and no way
 * for a stray `pointerup` anywhere else on the page to commit a phantom
 * resize against stale closed-over state.
 */
function ResizeHandle({
  startMin,
  startDuration,
  pxPerMinute,
  onPreview,
  onResize,
}: {
  /** The block's start, so the badge can name the END the drag is aiming at. */
  startMin: number;
  startDuration: number;
  pxPerMinute: number;
  onPreview: (minutes: number | null) => void;
  onResize: (minutes: number) => void;
}) {
  const [startY, setStartY] = useState<number | null>(null);
  /** The live figure, for the badge. Null while the grip is not held. */
  const [held, setHeld] = useState<number | null>(null);

  /**
   * Snapped to `SLOT_GRANULARITY_MIN`, which is the grain `resolveSlot`
   * already rounds every START to.
   *
   * Unsnapped this rounded to the minute, so the preview moved a pixel at a
   * time and the block jittered under the cursor — and it produced lengths
   * (`47m`) on a grid whose every other figure is a multiple of five. The
   * store's `clampResize` still has the last word about the next bar; this
   * only decides which figures the drag can propose.
   */
  function minutesFor(clientY: number): number {
    const raw = startDuration + (clientY - startY!) / pxPerMinute;
    return Math.max(
      SLOT_GRANULARITY_MIN,
      Math.round(raw / SLOT_GRANULARITY_MIN) * SLOT_GRANULARITY_MIN,
    );
  }

  function end(): void {
    setStartY(null);
    setHeld(null);
    onPreview(null);
  }

  return (
    <div
      data-testid="resize-handle"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setStartY(e.clientY);
      }}
      onPointerMove={(e) => {
        if (startY == null) return;
        const next = minutesFor(e.clientY);
        setHeld(next);
        onPreview(next);
      }}
      onPointerUp={(e) => {
        if (startY == null) return;
        onResize(minutesFor(e.clientY));
        end();
      }}
      onPointerCancel={() => {
        if (startY == null) return;
        end();
      }}
      className="group/grip absolute left-0 right-0 bottom-0 h-[8px] cursor-ns-resize touch-none"
    >
      {/*
        The grip is a DECORATION, not the control — the 8px strip around it is
        always live, on touch as much as on a mouse, so this is the one case
        the `.quiet-control` rule explicitly exempts: `pointer-events-none`,
        nothing to click, and a 24px interactive floor imposed on something
        that is not interactive would be taller than the shortest block.
        `designScale.test.ts` carries that exemption in words.

        A flat 22×2 rule rather than the 20×3 pill it was: the block it sits on
        is a measured object now, and a rounded pill is the one shape on it
        that states nothing.
      */}
      <span
        aria-hidden="true"
        className="absolute left-1/2 -translate-x-1/2 bottom-[2px] h-[2px] w-[22px] bg-ink-soft opacity-0 transition-opacity duration-150 group-hover:opacity-70 pointer-events-none"
      />
      {/*
        What the release will commit, stated BEFORE the release.
        `role="status"` so it is announced rather than merely drawn — the
        figure is the whole point of holding the grip, and a sighted user reads
        it off the badge while everyone else was previously told nothing until
        the toast that follows a refusal.
      */}
      {held !== null && (
        <span
          role="status"
          data-testid="resize-badge"
          className="absolute right-0 bottom-[-2px] translate-y-full rounded-[4px] bg-ink text-paper px-[6px] py-[2px] font-mono text-micro tabular-nums whitespace-nowrap shadow-today pointer-events-none"
        >
          → {clockLabel(startMin + held)} · {fmtMinutes(held)}
        </span>
      )}
    </div>
  );
}
