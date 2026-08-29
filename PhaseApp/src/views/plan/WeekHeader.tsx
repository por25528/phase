import type { WeekCapacity } from '../../lib/capacity';
import type { PlanMode } from '../../db/db';
import { SegmentedSwitch } from '../../components/SegmentedControl';
import { IconChevronLeft, IconChevronRight } from '../../components/Icons';
import { fmtD, addDays, isoWeekNumber, MO, parseD } from '../../lib/dates';
import { ymOf, ymLabel } from '../../lib/calendar';
import { weekLoadCells } from './capacityLabel';
import { LoadRule } from './LoadRule';
import { stampLabel } from '../../components/sectionLabel';

/**
 * The stamp's second cell: `17 – 23 Aug 2026`.
 *
 * Deliberately NOT `fmtD(a) – fmtD(b)`, which is what the heading below it
 * already says. A stamp exists to carry what the heading cannot: the week
 * NUMBER on one side, and the YEAR on the other. Repeating the month twice in
 * one seven-day range would spend the stamp's width on nothing.
 */
function weekStampRange(weekStart: string): string {
  const end = addDays(weekStart, 6);
  const a = parseD(weekStart);
  const b = parseD(end);
  const head = a.getMonth() === b.getMonth()
    ? `${a.getDate()} – ${b.getDate()} ${MO[b.getMonth()]}`
    : `${a.getDate()} ${MO[a.getMonth()]} – ${b.getDate()} ${MO[b.getMonth()]}`;
  return `${head} ${b.getFullYear()}`;
}

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
  weekStart, isPast, capacity, caveat = null, onPrev, onNext, onToday,
  unestimatedOpen, onToggleUnestimated, mode = 'week', onModeChange,
  monthCapacity, monthSpanLabel,
}: {
  weekStart: string;
  /*
   * `today` is gone. It split the free figure by tense — a day already past
   * held time SPENT rather than time free — and there is no free figure left
   * to split. Every figure here is a commitment, which a Thursday does not
   * make less true about a Monday.
   */
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
   * The calendar caveat to show beside the figures, or `null`.
   *
   * A finished string, decided by `calendarCaveat` in
   * `src/lib/calendarHealth.ts` — this component renders it and does not
   * derive it. Its predecessor was a boolean the header turned into the fixed
   * words "calendar not connected", which stopped being true the moment a
   * calendar could be connected AND short of data for the week on screen.
   *
   * Deliberately NOT conditional on `blockedBy`: a stale or partially-covered
   * cache produces blocks AND a caveat simultaneously, which is exactly when
   * the caveat matters most.
   */
  caveat?: string | null;
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
  // Month mode reports a month; a week's caveat under a month's heading
  // would be the same category error the figures already avoid.
  const note = isMonth ? null : caveat;
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
  const cells = isMonth
    ? (monthCapacity ? weekLoadCells(monthCapacity) : [])
    : weekLoadCells(capacity);

  return (
    /*
     * A stacked instrument rather than one baseline row.
     *
     * The old header put the range, a 420px meter and the controls on one
     * `items-baseline` line, which made the meter's bar float detached above
     * everything and gave four figures of equal weight nowhere to sit. It is
     * now four bands — stamp, range, gauge, figures rule — with the mode and
     * navigation controls held to the top band, where they belong to the range
     * they change and not to the numbers they do not.
     */
    <div className="mb-[12px]">
      <div className="flex items-start gap-[14px] flex-wrap">
        <div className="min-w-0 flex-1">
          {/*
            The stamp. Two mono cells, the first inverted against the second —
            a week number is an INDEX and reads as one when it is stamped
            rather than written. Week mode only: `Week 34` is a fact about a
            week, and a month's own stamp would have nothing to carry that
            `ymLabel` below does not already say.
          */}
          {!isMonth && (
            <span className="inline-flex rounded-[4px] border border-line-2 overflow-hidden mb-[5px]">
              <span className={`${stampLabel} bg-ink text-paper font-semibold px-[7px] py-[2px]`}>
                Week {isoWeekNumber(weekStart)}
              </span>
              <span className={`${stampLabel} text-muted px-[7px] py-[2px]`}>
                {weekStampRange(weekStart)}
              </span>
            </span>
          )}

          {/*
            `text-mast`, in the UI face. Plan's grid is the most instrument-like
            surface in the app and this is the header learning to speak its
            language. The display serif is locked to three places and this is
            not one of them, which is exactly why the step is named for the
            ROLE rather than for a face — see the note on `mast` in
            tailwind.config.js.
          */}
          <h2 className="text-mast font-semibold tracking-[-.022em] leading-[1.05] whitespace-nowrap">
            {isMonth ? ymLabel(ymOf(weekStart)) : `${fmtD(weekStart)} – ${fmtD(addDays(weekStart, 6))}`}
          </h2>

          <div className="flex items-baseline gap-[10px] flex-wrap mt-[2px]">
            {note && (
              <span className="text-eyebrow text-muted truncate max-w-[240px]" title={note}>{note}</span>
            )}
            {isPast && (
              <span className="text-meta text-muted italic">past week — read only</span>
            )}
          </div>
        </div>

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

      {/*
        Guarded on the CELLS and the unestimated count rather than on `figures`:
        an untouched week has no cells, and the rule would then be a hairline
        under the heading with nothing on it — but a week with nothing planned
        and four unpriced tasks still has one thing to say.
      */}
      {figures && (cells.length > 0 || figures.unestimated > 0) && (
        <div className="mt-[11px]">
          <LoadRule
            figures={figures}
            cells={cells}
            spanLabel={isMonth ? monthSpanLabel : undefined}
            unestimatedOpen={unestimatedOpen}
            onToggleUnestimated={onToggleUnestimated}
          />
        </div>
      )}
    </div>
  );
}
