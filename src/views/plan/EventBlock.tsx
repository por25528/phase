import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Interval } from '../../lib/capacity';
import { minuteToPct } from '../../lib/grid';
import type { PlanDragData } from './dropTarget';

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
 * A block can end after midnight (e.g. a 23:00–00:30 span has `endMin` 1470).
 * `% 24` alone would wrap that back to "12am", making a tooltip read
 * `11:30pm–12am` for something that actually ends half an hour later, the
 * NEXT day. A trailing "+1" marks that case instead of silently wrapping.
 */
function timeLabel(minute: number): string {
  const dayOffset = Math.floor(minute / 1440);
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const suffix = h < 12 ? 'am' : 'pm';
  const display = h % 12 === 0 ? 12 : h % 12;
  const base = m === 0 ? `${display}${suffix}` : `${display}:${String(m).padStart(2, '0')}${suffix}`;
  return dayOffset > 0 ? `${base}+${dayOffset}` : base;
}

export function EventBlock({
  block, lane, laneCount, range, onRemove, drag, onResize, gridHeightPx,
}: {
  block: GridBlock;
  lane: number;
  laneCount: number;
  range: Interval;
  onRemove?: () => void;
  /** Present only for placed work — a busy/calendar block is never draggable. */
  drag?: PlanDragData;
  onResize?: (minutes: number) => void;
  gridHeightPx: number;
}) {
  const isBusy = block.kind === 'busy';

  // Hooks cannot be conditional, so useDraggable is always called with a
  // stable id; `disabled: !drag` (busy/calendar blocks) makes `listeners`
  // undefined. `attributes` (role="button", tabIndex, aria-roledescription)
  // is returned unconditionally by dnd-kit regardless of `disabled` — so it
  // must be spread only when `drag` is set, same as `ref`/`listeners` below,
  // or every busy block gets announced as a focusable draggable button and
  // ends up nesting an interactive element inside the real `<button>` below.
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

  const top = minuteToPct(block.startMin, range);
  const committedHeight = minuteToPct(block.endMin, range) - top;
  const height =
    previewMinutes != null
      ? (minuteToPct(block.startMin + previewMinutes, range) - top)
      : committedHeight;
  const width = 100 / laneCount;

  return (
    <div
      ref={drag ? setNodeRef : undefined}
      {...(drag ? attributes : {})}
      {...(drag ? listeners : {})}
      className={`absolute rounded-[6px] px-[5px] py-[2px] overflow-hidden text-[.66rem] leading-[1.2] border ${
        isBusy
          ? 'bg-hover border-line-2 text-muted italic'
          : `bg-panel border-line-2 border-l-[3px] border-l-accent text-ink touch-none ${block.done ? 'opacity-55 line-through' : ''} ${block.estimated ? '' : 'border-dashed'} cursor-grab`
      } ${isDragging ? 'opacity-40' : ''}`}
      style={{
        top: `${top}%`,
        height: `${Math.max(height, 1.6)}%`,
        left: `calc(${lane * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
      }}
      title={`${block.title} · ${timeLabel(block.startMin)}–${timeLabel(block.endMin)}${block.estimated ? '' : ' · no estimate'}`}
    >
      <div className="truncate font-medium">{block.title}</div>
      <div className="truncate text-faint text-[.6rem] tabular-nums">{timeLabel(block.startMin)}</div>
      {onRemove && !isBusy && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          aria-label={`Unschedule ${block.title}`}
          className="absolute top-0 right-[2px] text-faint hover:text-warn text-[.7rem] leading-none px-[2px]"
        >
          ×
        </button>
      )}
      {onResize && !isBusy && (
        <ResizeHandle
          startDuration={block.endMin - block.startMin}
          pxPerMinute={gridHeightPx / (range.endMin - range.startMin)}
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
