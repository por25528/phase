import { useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { AvailabilityWindow } from '../../db/types';
import { minuteToPx, DAY_HEIGHT_PX, PX_PER_MINUTE, Z_NOW_LINE, Z_RULES } from '../../lib/grid';
import { canvasSpan, type CanvasSpan } from '../../lib/canvasCreate';
import { fmtD } from '../../lib/dates';

/**
 * One day. Draws the hours outside the working window, the now-line, and
 * nothing else — the blocks themselves arrive as `children` so this file stays
 * about geometry.
 *
 * A day with no window is hatched end to end and ACCEPTS drops like any other.
 * That is Job 1 on this surface: the window used to disable the droppable, so
 * a Saturday you had switched off was a column you could not use. It is now a
 * MARKING — `.hatch`, the same 45° stripe Today's frame uses for the margin of
 * a sheet — which says "you don't usually work here" and refuses nothing. The
 * heavy `bg-hover/60` wash it replaces read as disabled chrome, which is
 * exactly what it no longer is.
 *
 * The availability window prop is named `availabilityWindow` rather than
 * `window` because the latter shadows the global `window` object — a
 * neighbouring component adds `window.addEventListener` calls.
 */
export function DayColumn({
  date, isToday, availabilityWindow, nowMinute, isPast, readOnly, onCreate, children,
}: {
  date: string;
  isToday: boolean;
  availabilityWindow: AvailabilityWindow | null;
  nowMinute: number | null;
  /**
   * True when this day is already behind `today` (a past day of the current
   * week, or any day of a past week). Draws a wash over the column so elapsed
   * days do not read identically to available ones — the ambiguity that made
   * the header's "45h free" dangerous rather than merely imprecise. Distinct
   * from `readOnly`, which is about the WHOLE week and governs drops; a past
   * day of the current week is dimmed but still droppable.
   */
  isPast?: boolean;
  /** True when this column belongs to a past week — every drop is refused. */
  readOnly?: boolean;
  /** Draw a block here. Absent ⇒ no canvas, so the day accepts no gesture. */
  onCreate?: (span: CanvasSpan) => void;
  children: ReactNode;
}) {
  // Only a read-only (past) WEEK refuses drops now. A day off is no longer a
  // reason: `resolveSlot` searches the whole day, so a column that looked
  // droppable and then refused would be the last place the fence still lived.
  // Past-week read-only is a different rule and deliberately untouched — it is
  // about rescheduling history, not about working hours.
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}`, disabled: !!readOnly });

  return (
    // `group` + a label, because the blocks inside carry no day of their own.
    // Seven of these render in DOM order, so tabbing the grid was twenty-eight
    // blocks in a row with nothing saying which day any of them was on.
    <div
      ref={setNodeRef}
      data-date={date}
      role="group"
      aria-label={`${fmtD(date)}${isToday ? ' — today' : ''}${availabilityWindow ? '' : ' — outside working hours'}`}
      /*
       * The drop target. `bg-accent/5` alone is a wash a person has to look
       * for; the inset hairline on the leading edge is what makes the column
       * read as CHOSEN — the same move `RuleHeader`'s tag cell makes, a tinted
       * field terminated by a real edge rather than a tint fading into the
       * sheet. The transition is 120ms so the choice registers as a change
       * rather than as a state the column was always in.
       */
      className={`relative min-w-0 overflow-hidden border-l border-line-soft motion-safe:transition-[background-color,box-shadow] motion-safe:duration-[120ms] motion-safe:ease-out ${
        availabilityWindow ? '' : 'hatch'
      } ${isToday ? 'bg-hover/40' : ''} ${isOver ? 'bg-accent/5 shadow-[inset_2px_0_0_theme(colors.accent/0.55)]' : ''}`}
    >
      {/* Hours outside the working window: hatched, not dimmed. See the note
          above — this is a marking of the day's margin, and the two bands are
          skipped entirely on a day with no window because the column itself
          already carries the hatch. */}
      {availabilityWindow && (
        <>
          <div
            className="hatch absolute left-0 right-0 top-0 pointer-events-none"
            style={{ height: `${minuteToPx(availabilityWindow.startMin)}px` }}
          />
          <div
            className="hatch absolute left-0 right-0 bottom-0 pointer-events-none"
            style={{ height: `${DAY_HEIGHT_PX - minuteToPx(availabilityWindow.endMin)}px` }}
          />
        </>
      )}

      {/* Gated on exactly what the droppable is gated on, which is now only a
          week already spent: a drawn block and a dropped one have to agree
          about which days will take them. */}
      {onCreate && !readOnly && (
        <DayCanvas date={date} onCreate={onCreate} />
      )}

      {children}

      {/* A wash toward the page background, painted OVER the blocks so an
          elapsed day recedes as a whole rather than only in its empty gaps.
          `pointer-events-none`, so a past day of the current week stays
          droppable — the recede is a signal, not a lock. `bg-bg`, not
          `bg-hover`: hover is the "today" highlight above, and past days must
          not borrow the colour that means "now". */}
      {isPast && (
        <div
          data-testid={`day-past-${date}`}
          className="absolute inset-0 bg-bg/55 pointer-events-none"
          style={{ zIndex: Z_NOW_LINE }}
          aria-hidden="true"
        />
      )}

      {/*
        The current minute, as a hairline across today and nothing else.
        `warn`, not `accent`: accent means ACTION in this app and it is already
        the colour of a drop target and of every primary control, so a
        permanent accent rule across one column read as something to click. The
        clock is not an error either, which is why it is a HAIRLINE and a dot
        rather than a filled band — the same restraint every calendar shows it
        with. Its other half is the dot in the time gutter (`WeekGrid`), which
        is what makes the line readable when today's column is scrolled out of
        view sideways.
      */}
      {isToday && nowMinute !== null && (
        <div
          data-testid={`now-line-${date}`}
          className="absolute left-0 right-0 h-0 border-t border-warn pointer-events-none"
          style={{ top: `${minuteToPx(nowMinute)}px`, zIndex: Z_NOW_LINE }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/**
 * The empty-canvas gesture layer.
 *
 * Sits BENEATH the blocks (`Z_RULES`, and rendered before `children`) so a
 * pointerdown on a block reaches the block, not this. "Empty canvas" is
 * therefore a real DOM target rather than a target-vs-currentTarget test,
 * which would have to be re-derived every time a block grows a new child.
 *
 * Content coordinates come from this element's own live rect. The column's
 * border box IS the day's content box — `WeekGrid` gives the hour grid
 * `height: DAY_HEIGHT_PX` and each column is a grid item in that row — so the
 * rect's top is minute 0 and no scroll term is involved. `aimMinuteFor` needs
 * one only because dnd-kit hands it a translated ghost rect instead of an
 * element; reusing that formula here would count scroll twice.
 *
 * Pointer capture, as in `ResizeHandle` and `SpanBar`: it ties the remaining
 * events to this element and to React's own handlers, so there is nothing to
 * leak and no stray `pointerup` elsewhere can commit a phantom block.
 */
function DayCanvas({ date, onCreate }: { date: string; onCreate: (span: CanvasSpan) => void }) {
  const [anchorY, setAnchorY] = useState<number | null>(null);
  const [preview, setPreview] = useState<CanvasSpan | null>(null);

  function contentY(e: ReactPointerEvent<HTMLDivElement>): number {
    return e.clientY - e.currentTarget.getBoundingClientRect().top;
  }

  function end(): void {
    setAnchorY(null);
    setPreview(null);
  }

  return (
    <div
      data-testid={`day-canvas-${date}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const y = contentY(e);
        setAnchorY(y);
        setPreview(canvasSpan(y, y));
      }}
      onPointerMove={(e) => {
        if (anchorY === null) return;
        setPreview(canvasSpan(anchorY, contentY(e)));
      }}
      onPointerUp={(e) => {
        if (anchorY === null) return;
        const span = canvasSpan(anchorY, contentY(e));
        end();
        onCreate(span);
      }}
      onPointerCancel={end}
      className="absolute inset-0 touch-none"
      style={{ zIndex: Z_RULES }}
      aria-hidden="true"
    >
      {preview && (
        <div
          data-testid="canvas-preview"
          className="absolute left-[2px] right-[2px] rounded-[6px] border border-dashed border-accent bg-accent/10 pointer-events-none"
          style={{
            top: `${minuteToPx(preview.startMin)}px`,
            height: `${preview.durationMin * PX_PER_MINUTE}px`,
          }}
        />
      )}
    </div>
  );
}
