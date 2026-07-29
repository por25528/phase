import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
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
  block, lane, laneCount, range, onRemove, drag, onResize, onPreview, gridHeightPx,
}: {
  block: GridBlock;
  lane: number;
  laneCount: number;
  range: Interval;
  onRemove?: () => void;
  /** Present only for placed work — a busy/calendar block is never draggable. */
  drag?: PlanDragData;
  onResize?: (minutes: number) => void;
  onPreview?: (minutes: number) => void;
  gridHeightPx: number;
}) {
  const top = minuteToPct(block.startMin, range);
  const height = minuteToPct(block.endMin, range) - top;
  const width = 100 / laneCount;
  const isBusy = block.kind === 'busy';

  // Hooks cannot be conditional, so useDraggable is always called with a
  // stable id; when there's no `drag` payload (busy/calendar blocks) it's
  // disabled and its output is ignored.
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: drag ? `${drag.kind}:${drag.id}` : `busy:${block.key}`,
    data: drag,
    disabled: !drag,
  });

  return (
    <div
      ref={drag ? setNodeRef : undefined}
      {...(drag ? attributes : {})}
      {...(drag ? listeners : {})}
      className={`absolute rounded-[6px] px-[5px] py-[2px] overflow-hidden text-[.66rem] leading-[1.2] border ${
        isBusy
          ? 'bg-hover border-line-2 text-muted italic'
          : `bg-panel border-line-2 border-l-[3px] border-l-accent text-ink ${block.done ? 'opacity-55 line-through' : ''} ${block.estimated ? '' : 'border-dashed'} cursor-grab`
      } ${isDragging ? 'opacity-40' : ''}`}
      style={{
        top: `${top}%`,
        height: `${Math.max(height, 1.6)}%`,
        left: `calc(${lane * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        transform: transform ? CSS.Translate.toString(transform) : undefined,
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
        <div
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const startY = e.clientY;
            const startDuration = block.endMin - block.startMin;
            const pxPerMinute = gridHeightPx / (range.endMin - range.startMin);
            const move = (ev: PointerEvent) => {
              onPreview?.(Math.round(startDuration + (ev.clientY - startY) / pxPerMinute));
            };
            const up = (ev: PointerEvent) => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
              onResize(Math.round(startDuration + (ev.clientY - startY) / pxPerMinute));
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
          className="absolute left-0 right-0 bottom-0 h-[6px] cursor-ns-resize"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
