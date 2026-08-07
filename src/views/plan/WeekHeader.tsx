import type { WeekCapacity } from '../../lib/capacity';
import type { PlanMode } from '../../db/db';
import { fmtD, addDays } from '../../lib/dates';
import { ymOf, ymLabel } from '../../lib/calendar';
import { loadParts, unestimatedLabel, capacityNote, isOverCommitted } from './capacityLabel';

/**
 * The week calendar's header: date range, capacity readout, and week
 * navigation. A past week is shown read-only here (label only) — the actual
 * enforcement is the disabled droppable threaded through WeekGrid/DayColumn
 * in Plan.tsx; this component only reflects that state, it does not create it.
 */
export function WeekHeader({
  weekStart, isPast, capacity, calendarAvailable = false, onPrev, onNext, onToday,
  unestimatedOpen, onToggleUnestimated, mode = 'week', onModeChange,
}: {
  weekStart: string;
  isPast: boolean;
  capacity: WeekCapacity;
  /**
   * Which shape the grid below is in.
   *
   * The header derives its own heading from this rather than taking a `label`
   * string: it must receive `mode` anyway for the toggle's pressed state, so a
   * separate label prop would be a second source of truth for the same fact.
   */
  mode?: PlanMode;
  /** Omitted where there is no mode to switch (tests, future hosts). */
  onModeChange?: (mode: PlanMode) => void;
  /**
   * Whether a calendar integration exists at all. Until one does, the
   * "calendar not connected" caveat is a permanent notice about a feature that
   * has not shipped — noise rather than information. Once slice 2 lands this
   * flips true and the caveat becomes meaningful again (it then distinguishes
   * "connected but empty" from "not connected").
   */
  calendarAvailable?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  /** Whether the unestimated list below the header is open. */
  unestimatedOpen?: boolean;
  /** Omitted where there is nowhere to show the list (tests, future hosts). */
  onToggleUnestimated?: () => void;
}) {
  const isMonth = mode === 'month';
  const note = calendarAvailable && !isMonth ? capacityNote(capacity) : null;
  const unestimated = isMonth ? null : unestimatedLabel(capacity);
  return (
    <div className="flex items-baseline gap-[10px] mb-[10px] flex-wrap">
      <h3 className="font-mono text-tiny tracking-[.13em] uppercase text-muted font-semibold">
        {isMonth ? ymLabel(ymOf(weekStart)) : `${fmtD(weekStart)} – ${fmtD(addDays(weekStart, 6))}`}
      </h3>
      {/*
        Every figure here is a WEEK figure from `weekCapacity`, so month mode
        hides them rather than relabelling them. A month's capacity is a
        different computation; leaving a week's numbers under a month's heading
        would be exactly the contradiction the planned/to-place split exists to
        prevent.
      */}
      {!isMonth && (
        <span className={`text-ui tabular-nums ${isOverCommitted(capacity) ? 'text-warn' : 'text-muted'}`}>
          {loadParts(capacity).join(' · ')}
        </span>
      )}
      {/* The unestimated count is the one part of the readout that names a
          problem the user can fix, so it is a control rather than a statement.
          It stays plain text when there is no host to open a list into, which
          keeps this component usable without the panel. */}
      {unestimated && (
        onToggleUnestimated ? (
          <button
            type="button"
            onClick={onToggleUnestimated}
            aria-expanded={unestimatedOpen ?? false}
            title="Show the work that has no estimate"
            className="text-ui tabular-nums text-muted underline decoration-dotted underline-offset-[3px] min-h-[24px] inline-flex items-center px-[2px] rounded-[4px] hover:text-ink hover:bg-hover"
          >
            {unestimated}
          </button>
        ) : (
          <span className="text-ui tabular-nums text-muted">{unestimated}</span>
        )
      )}
      {note && (
        <span className="text-eyebrow text-muted truncate max-w-[240px]" title={note}>{note}</span>
      )}
      {isPast && (
        <span className="text-meta text-muted italic">past week — read only</span>
      )}
      <span className="flex-1" />
      {onModeChange && (
        // `aria-pressed`, not `role="tab"`: these are two states of one
        // control, and a tablist would promise arrow-key navigation between
        // tabpanels that do not exist.
        <div className="flex items-center rounded-field border border-line-2 overflow-hidden">
          {(['week', 'month'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              aria-pressed={mode === m}
              className={`px-[10px] py-[3px] text-meta capitalize min-h-[24px] ${
                mode === m ? 'bg-fill text-bg' : 'text-muted hover:text-ink hover:bg-hover'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      )}
      <button type="button" onClick={onPrev} aria-label={isMonth ? 'Previous month' : 'Previous week'} className="text-muted hover:text-ink px-[6px] min-w-[24px] min-h-[24px] inline-flex items-center justify-center rounded-[6px] hover:bg-hover">‹</button>
      <button type="button" onClick={onToday} className="text-meta text-muted hover:text-ink min-h-[24px] px-[6px] rounded-[6px] hover:bg-hover">today</button>
      <button type="button" onClick={onNext} aria-label={isMonth ? 'Next month' : 'Next week'} className="text-muted hover:text-ink px-[6px] min-w-[24px] min-h-[24px] inline-flex items-center justify-center rounded-[6px] hover:bg-hover">›</button>
    </div>
  );
}
