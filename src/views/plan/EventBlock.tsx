import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { minuteToPx, PX_PER_MINUTE, Z_BLOCK, Z_BLOCK_REVEALED } from '../../lib/grid';
import { clockLabel } from '../../lib/clock';
import type { PlanDragData } from './dropTarget';
import { containerDragAttributes } from '../../lib/dragAttributes';

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
}

/**
 * Two lines of 13px text plus padding. Google Calendar enforces a comparable
 * floor and switches to an inline `time — title` for sub-30-minute events.
 */
const MIN_BLOCK_PX = 34;
/** Below this, there is no room for a second line, so use the inline layout. */
const COMPACT_BLOCK_PX = 40;

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

  return (
    <div
      ref={drag ? setNodeRef : undefined}
      id={domId}
      {...(drag ? containerDragAttributes(attributes, { keyboardDraggable: true }) : {})}
      {...(drag ? listeners : {})}
      // The block's own name. Without it the accessible name fell back to the
      // concatenation of its children — "pset Complete pset Unschedule pset".
      aria-label={`${block.title}, ${clockLabel(block.startMin)}–${clockLabel(block.endMin)}`}
      className={`group/blk absolute rounded-[6px] px-[5px] py-[2px] overflow-hidden text-badge leading-[1.2] border ${
        isBusy
          ? 'bg-hover border-line-2 text-muted italic'
          : `bg-panel border-line-2 border-l-[3px] border-l-accent text-ink touch-none ${block.done ? 'opacity-55 line-through' : ''} ${block.estimated ? '' : 'border-dashed'} cursor-grab`
      } ${isDragging ? 'opacity-40' : ''} ${revealed ? 'ring-2 ring-inset ring-accent' : ''}`}
      style={{
        top: `${top}px`,
        height: `${heightPx}px`,
        left: `calc(${lane * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        zIndex: revealed ? Z_BLOCK_REVEALED : Z_BLOCK,
      }}
      title={`${block.title} · ${clockLabel(block.startMin)}–${clockLabel(block.endMin)}${block.estimated ? '' : ' · no estimate'}`}
    >
      {/* Below two lines' worth of height, collapse to `9am Title` on one row
          rather than rendering a title with its time cut off. */}
      {compact ? (
        <div className="truncate">
          <span className="text-muted text-tiny tabular-nums mr-[4px]">{clockLabel(block.startMin)}</span>
          <span className="font-medium">{block.title}</span>
        </div>
      ) : (
        <>
          {/* A tall block has room to wrap; `truncate` clipped a long title to
              one line and left the space below it empty. */}
          <div className="font-medium line-clamp-3">{block.title}</div>
          <div className="truncate text-muted text-tiny tabular-nums">{clockLabel(block.startMin)}</div>
        </>
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
          className={`absolute w-[24px] h-[24px] grid place-items-center text-faint hover:text-accent text-meta leading-none ${
            compact ? 'top-1/2 -translate-y-1/2 right-[22px] bg-panel/90 rounded-[4px]' : 'top-0 right-[20px]'
          }`}
        >
          ✓
        </button>
      )}
      {onRemove && !isBusy && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          aria-label={`Unschedule ${block.title}`}
          // 24x24 target on a block that can itself be only 34px tall — the
          // glyph stays small, the hit area does not.
          className={`absolute right-0 w-[24px] h-[24px] grid place-items-center text-faint hover:text-warn text-meta leading-none opacity-0 group-hover/blk:opacity-100 focus-visible:opacity-100 transition-opacity ${
            compact ? 'top-1/2 -translate-y-1/2 bg-panel/90 rounded-[4px]' : 'top-0'
          }`}
        >
          ×
        </button>
      )}
      {onResize && !isBusy && (
        <ResizeHandle
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
  startDuration,
  pxPerMinute,
  onPreview,
  onResize,
}: {
  startDuration: number;
  pxPerMinute: number;
  onPreview: (minutes: number | null) => void;
  onResize: (minutes: number) => void;
}) {
  const [startY, setStartY] = useState<number | null>(null);

  function minutesFor(clientY: number): number {
    return Math.round(startDuration + (clientY - startY!) / pxPerMinute);
  }

  return (
    <div
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setStartY(e.clientY);
      }}
      onPointerMove={(e) => {
        if (startY == null) return;
        onPreview(minutesFor(e.clientY));
      }}
      onPointerUp={(e) => {
        if (startY == null) return;
        onResize(minutesFor(e.clientY));
        setStartY(null);
        onPreview(null);
      }}
      onPointerCancel={() => {
        if (startY == null) return;
        setStartY(null);
        onPreview(null);
      }}
      className="absolute left-0 right-0 bottom-0 h-[6px] cursor-ns-resize touch-none"
      aria-hidden="true"
    />
  );
}
