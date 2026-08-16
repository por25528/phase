import type { WeekCapacity } from '../../lib/capacity';
import type { PlanMode } from '../../db/db';
import { SegmentedSwitch } from '../../components/SegmentedControl';
import { IconChevronLeft, IconChevronRight } from '../../components/Icons';
import { fmtD, addDays } from '../../lib/dates';
import { ymOf, ymLabel } from '../../lib/calendar';
import { weekLoadParts, loadParts, capacityNote } from './capacityLabel';
import { CapacityMeter } from './CapacityMeter';

/** Capitalised here rather than by `capitalize`: a label is written, not cased. */
const PLAN_RANGES = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
] as const;

/**
 * The week calendar's header: date range, capacity readout, and week
 * navigation. A past week is shown read-only here (label only) — the actual
 * enforcement is the disabled droppable threaded through WeekGrid/DayColumn
 * in Plan.tsx; this component only reflects that state, it does not create it.
 */
export function WeekHeader({
  weekStart, today, isPast, capacity, calendarAvailable = false, onPrev, onNext, onToday,
  unestimatedOpen, onToggleUnestimated, mode = 'week', onModeChange,
  monthCapacity, monthSpanLabel,
}: {
  weekStart: string;
  /**
   * Today's date, 'YYYY-MM-DD'. The free figure is split against it: a day
   * already past is time SPENT, not time free. Without this the header spends
   * the word "free" on hours that were all Mon–Fri and are all gone — the
   * question a person reads it as ("what can I still get done") answered with a
   * retrospective in the same font. See `weekLoadParts`.
   */
  today: string;
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
  /**
   * The month's figures, when the grid below is a month. Absent in week mode.
   * A separate prop rather than overloading `capacity`: the two cover
   * different spans, and one variable holding either is how a week's numbers
   * end up under a month's heading.
   */
  monthCapacity?: WeekCapacity;
  /** What `monthCapacity` covers, e.g. `Jul 27 – Sep 6`. */
  monthSpanLabel?: string;
}) {
  const isMonth = mode === 'month';
  const note = calendarAvailable && !isMonth ? capacityNote(capacity) : null;
  /*
   * Month mode reports the MONTH's figures, not the week's.
   *
   * This used to hide every figure behind `!isMonth`, and the reasoning was
   * sound — a week's numbers under a month's heading would be a lie. The fix
   * is not to relabel them but to hand down a real month figure; until one
   * arrives (`monthCapacity` absent) the header still says nothing rather than
   * guessing. See monthCapacity.ts for why that figure covers the week rows
   * drawn rather than the calendar month, and why `monthSpanLabel` therefore
   * has to be on screen beside it.
   */
  const figures = isMonth ? monthCapacity : capacity;
  const parts = isMonth
    ? (monthCapacity ? loadParts(monthCapacity) : [])
    : weekLoadParts(capacity, today);

  return (
    <div className="flex items-start gap-[14px] mb-[12px] flex-wrap">
      <h2 className="text-h1 font-semibold tracking-[-.012em] leading-[1.15] whitespace-nowrap">
        {isMonth ? ymLabel(ymOf(weekStart)) : `${fmtD(weekStart)} – ${fmtD(addDays(weekStart, 6))}`}
      </h2>

      {figures && (
        <CapacityMeter
          figures={figures}
          parts={parts}
          spanLabel={isMonth ? monthSpanLabel : undefined}
          unestimatedOpen={unestimatedOpen}
          onToggleUnestimated={onToggleUnestimated}
        />
      )}

      {note && (
        <span className="text-eyebrow text-muted truncate max-w-[240px]" title={note}>{note}</span>
      )}
      {isPast && (
        <span className="text-meta text-muted italic">past week — read only</span>
      )}

      <span className="flex-1" />

      <div className="flex items-center gap-[8px]">
        {onModeChange && (
          // `aria-pressed`, not `role="tab"`: these are two states of one
          // control, and a tablist would promise arrow-key navigation between
          // tabpanels that do not exist.
          <SegmentedSwitch
            label="Calendar range"
            value={mode}
            options={PLAN_RANGES}
            onChange={onModeChange}
            size="sm"
          />
        )}
        {/*
          One joined group, because these three are one control: step back, go
          home, step forward. As three loose glyphs — two of which were `‹` and
          `›`, typographic characters the subsetted UI face does not carry —
          they read as three unrelated bits of text floating at the page edge.
        */}
        <div className="inline-flex items-center border border-line-2 rounded-field overflow-hidden">
          <button
            type="button"
            onClick={onPrev}
            aria-label={isMonth ? 'Previous month' : 'Previous week'}
            className="text-muted hover:text-ink hover:bg-hover px-[9px] h-[26px] inline-flex items-center"
          >
            <IconChevronLeft size={13} />
          </button>
          <button
            type="button"
            onClick={onToday}
            className="text-meta text-muted hover:text-ink hover:bg-hover h-[26px] px-[12px] border-x border-line inline-flex items-center"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label={isMonth ? 'Next month' : 'Next week'}
            className="text-muted hover:text-ink hover:bg-hover px-[9px] h-[26px] inline-flex items-center"
          >
            <IconChevronRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
