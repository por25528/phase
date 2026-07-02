import { useRef, useState } from 'react';
import type { DateWindow } from '../../lib/timeline';
import { moveSpan, resizeStart, resizeEnd, snapDelta, windowDays, windowFrac } from '../../lib/timeline';

export type Span = { start: string; deadline: string };

type Drag = {
  mode: 'move' | 'start' | 'end';
  originX: number;
  pxPerDay: number;
  orig: Span;
  preview: Span;
  moved: boolean;
};

export interface SpanBarProps {
  span: Span;
  win: DateWindow;
  pct: number;
  label: string;
  ariaLabel: string;
  height: number;
  warn?: boolean;
  onCommit(next: Span): void;
  onOpen?(): void;
  onHover?(pos: { x: number; y: number } | null): void;
  onPreview?(span: Span | null): void;
}

/**
 * A single draggable/resizable timeline bar: pointer-capture drag (move/start/end
 * zones, 8px edges), keyboard nudge (ArrowLeft/Right, Shift=week, Alt=resize end),
 * and an out-of-window `‹ earlier` / `later ›` marker. Owns its own drag state —
 * each instance manages itself; the parent only supplies the committed span and
 * receives `onCommit`/`onOpen`/`onHover` callbacks.
 */
export function SpanBar({
  span, win, pct, label, ariaLabel, height, warn, onCommit, onOpen, onHover, onPreview,
}: SpanBarProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const suppressClick = useRef(false);
  const total = windowDays(win);

  const effective = drag ? drag.preview : span;
  const sf = windowFrac(effective.start, win) * 100;
  const ef = windowFrac(effective.deadline, win) * 100;
  const out = ef < 0 || sf > 100; // span entirely outside window
  const left = Math.max(0, Math.min(100, sf));
  const right = Math.max(0, Math.min(100, ef));
  const w = Math.max(right - left, 2);

  if (out) {
    return (
      <span
        className="absolute top-1/2 -translate-y-1/2 text-[.72rem] text-faint"
        style={{ left: ef < 0 ? '8px' : undefined, right: sf > 100 ? '8px' : undefined }}
      >
        {ef < 0 ? '‹ earlier' : 'later ›'}
      </span>
    );
  }

  return (
    <button
      className={`absolute top-1/2 -translate-y-1/2 rounded-[6px] bg-track border cursor-grab active:cursor-grabbing touch-none overflow-hidden flex items-center z-[2] transition-[border-color,box-shadow] focus-visible:outline-none ${
        warn
          ? 'border-warn hover:border-warn hover:ring-2 hover:ring-warn-tint focus-visible:border-warn focus-visible:ring-2 focus-visible:ring-warn-tint'
          : 'border-line-2 hover:border-accent hover:ring-2 hover:ring-accent-tint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-tint'
      }`}
      style={{ left: `${left}%`, width: `${w}%`, height: `${height}px` }}
      aria-label={ariaLabel}
      onMouseMove={(e) => onHover?.({ x: e.clientX, y: e.clientY })}
      onMouseLeave={() => onHover?.(null)}
      onFocus={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onHover?.({ x: r.left + r.width / 2, y: r.top });
      }}
      onBlur={() => onHover?.(null)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const plotW = e.currentTarget.parentElement!.getBoundingClientRect().width;
        const off = e.clientX - rect.left;
        const mode = off < 8 ? 'start' : off > rect.width - 8 ? 'end' : 'move';
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ mode, originX: e.clientX, pxPerDay: plotW / total, orig: span, preview: span, moved: false });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const delta = snapDelta((e.clientX - drag.originX) / drag.pxPerDay, e.shiftKey ? 'week' : 'day');
        const preview =
          drag.mode === 'move' ? moveSpan(drag.orig.start, drag.orig.deadline, delta)
          : drag.mode === 'start' ? resizeStart(drag.orig.start, drag.orig.deadline, delta)
          : resizeEnd(drag.orig.start, drag.orig.deadline, delta);
        setDrag({ ...drag, preview, moved: drag.moved || Math.abs(e.clientX - drag.originX) > 3 });
        onPreview?.(preview);
      }}
      onPointerUp={() => {
        if (!drag) return;
        if (drag.moved) {
          suppressClick.current = true;
          if (drag.preview.start !== drag.orig.start || drag.preview.deadline !== drag.orig.deadline) {
            onCommit(drag.preview);
          }
        }
        setDrag(null);
        onPreview?.(null);
      }}
      onClick={() => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        onOpen?.();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 7 : 1);
        const next = e.altKey ? resizeEnd(span.start, span.deadline, d) : moveSpan(span.start, span.deadline, d);
        onCommit(next);
      }}
    >
      <span className="absolute inset-y-0 left-0 w-[8px] cursor-ew-resize" aria-hidden="true" />
      <span className="absolute inset-y-0 right-0 w-[8px] cursor-ew-resize" aria-hidden="true" />
      <i className="tl-bar-fill" style={{ width: `${pct}%` }} />
      <b className="relative text-[.7rem] font-semibold text-white pl-[8px] [mix-blend-mode:difference] tabular-nums z-[2]">
        {label}
      </b>
    </button>
  );
}
