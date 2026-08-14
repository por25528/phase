import { useEffect, useRef, useState } from 'react';
import { Popover } from './Popover';
import { IconCalendar, IconChevronRight } from './Icons';
import { CONTROL_H, CONTROL_LINE } from './dialogStyles';
import { deadlinePresets, paddedMonthGrid, shiftYm, ymLabel, ymOf } from '../lib/calendar';
import { addDays, fmtD, fmtDY, parseD } from '../lib/dates';

/**
 * A date, picked rather than spelled.
 *
 * `DateField` — still the control in the project workspace — exists because
 * `<input type="date">` renders in the browser's locale, and `02/08/2026` is
 * Feb 8 to a US reader and Aug 2 to everyone else. It answered that by refusing
 * the ambiguous form, which is correct but leaves the user carrying the format:
 * `parseDateInput` is 59 lines of grammar for month names, word order and
 * omitted years, every one of them recovering from the fact that somebody had
 * to type a date out.
 *
 * A grid has no format to get wrong, no year to omit and nothing to reject.
 *
 * `size` rather than a merged `className`, for the reason `DateField` documents:
 * class lists are APPENDED, not cascaded, so a caller passing `rounded-field`
 * against a base `rounded-[6px]` leaves which one applies to the order Tailwind
 * happened to emit them in. `triggerClassName` carries TONE only.
 */
const SIZES = {
  /** A form field in a dialog — 33px, matching `fieldCls` exactly. */
  field: `w-full justify-start ${CONTROL_H} ${CONTROL_LINE} gap-[7px] px-[8px] py-[5px] rounded-field border border-line-2 text-ui`,
  /** A chip on a board card. */
  chip: 'gap-[4px] px-[6px] py-[3px] rounded-[6px] text-meta whitespace-nowrap',
} as const;

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** `Aug 30, 2026` — a cell's name must be unambiguous read out of context. */
function dayLabel(date: string): string {
  return `${fmtD(date)}, ${date.slice(0, 4)}`;
}

/** 0 = Monday … 6 = Sunday, the app's week, as `weekDates` computes it. */
function dayOfWeek(date: string): number {
  return (parseD(date).getDay() + 6) % 7;
}

export function DatePopover({
  value,
  today,
  onCommit,
  ariaLabel,
  placeholder = 'No date',
  prefix = '',
  size = 'field',
  triggerClassName = '',
  triggerRef,
}: {
  value: string;
  today: string;
  onCommit: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  prefix?: string;
  size?: keyof typeof SIZES;
  triggerClassName?: string;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Popover
      // The pattern `TaskPage` set: the name carries the VALUE, so the control
      // and the panel it opens can never drift about what is selected.
      label={`${ariaLabel}: ${value ? dayLabel(value) : 'not set'}`}
      role="dialog"
      panelWidth={252}
      triggerRef={triggerRef}
      triggerClassName={`inline-flex items-center text-left ${SIZES[size]} ${triggerClassName}`}
      trigger={
        <>
          <span className="flex-none text-muted inline-flex" aria-hidden="true">
            <IconCalendar size={13} />
          </span>
          {/*
            An unset value is `text-muted` and never `text-faint`. It is read,
            and it is the only affordance for setting one, so it takes the tone
            that clears AA.
          */}
          <span className={`flex-1 min-w-0 truncate ${value ? 'text-ink' : 'text-muted'}`}>
            {value ? `${prefix}${fmtDY(value, today)}` : placeholder}
          </span>
          <span className="flex-none text-faint inline-flex rotate-90" aria-hidden="true">
            <IconChevronRight size={11} />
          </span>
        </>
      }
    >
      {(close) => (
        <Calendar
          value={value}
          today={today}
          clearLabel={`Clear ${ariaLabel.toLowerCase()}`}
          onPick={(date) => {
            onCommit(date);
            close();
          }}
          onClear={() => {
            onCommit('');
            close();
          }}
        />
      )}
    </Popover>
  );
}

function Calendar({
  value,
  today,
  clearLabel,
  onPick,
  onClear,
}: {
  value: string;
  today: string;
  clearLabel: string;
  onPick: (date: string) => void;
  onClear: () => void;
}) {
  /*
   * `Popover` calls its children only while open, so this component mounts on
   * open and these initialisers ARE the "which month does it open on" rule:
   * the month holding the current value, else the month holding today. Focus
   * starts on the value, else on today — which by construction is inside the
   * month just chosen, so the grid never opens with focus off screen.
   */
  const [ym, setYm] = useState(() => ymOf(value || today));
  const [focused, setFocused] = useState(() => value || today);
  const gridRef = useRef<HTMLDivElement>(null);

  const weeks = paddedMonthGrid(ym);

  // Roving tabindex: the focused cell is the only tab stop, and moving focus is
  // how this component "navigates". Runs on mount too, which is what gives the
  // grid a focused cell the moment it opens.
  useEffect(() => {
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)
      ?.focus();
  }, [focused, ym]);

  function page(n: number): void {
    const next = shiftYm(ym, n);
    setYm(next);
    setFocused(`${next}-01`);
  }

  /**
   * Move the cursor, and let the month follow it off the edge.
   *
   * The test is membership of the DRAWN grid, not of `ym` — the padded days of
   * the neighbouring months are visible and live, so stepping onto one should
   * not turn the page out from under the eye. Only leaving the drawn six rows
   * pages.
   */
  function move(days: number): void {
    const next = addDays(focused, days);
    setFocused(next);
    if (!weeks.some((week) => week.includes(next))) setYm(ymOf(next));
  }

  return (
    <div className="px-[8px] pb-[4px]">
      <div className="flex items-center justify-between gap-[4px] px-[2px] pb-[6px]">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => page(-1)}
          className="w-[24px] h-[24px] grid place-items-center rounded-[6px] text-muted hover:bg-hover hover:text-ink"
        >
          <span className="inline-flex rotate-180" aria-hidden="true"><IconChevronRight size={12} /></span>
        </button>
        <div className="text-ui font-medium text-ink">{ymLabel(ym)}</div>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => page(1)}
          className="w-[24px] h-[24px] grid place-items-center rounded-[6px] text-muted hover:bg-hover hover:text-ink"
        >
          <IconChevronRight size={12} />
        </button>
      </div>

      {/* The weekday strip — the one thing a terse uppercase micro label is
          genuinely for, and the same treatment `views/plan/MonthGrid.tsx` gives
          its own. `designScale.test.ts` pins the list of files allowed to do
          this; this file is on it deliberately. */}
      <div className="grid grid-cols-7" aria-hidden="true">
        {DOW.map((d) => (
          <div key={d} className="text-center font-mono text-tiny tracking-[.12em] uppercase text-muted pb-[3px]">
            {d.slice(0, 1)}
          </div>
        ))}
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-label={ymLabel(ym)}
        onKeyDown={(e) => {
          const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
          if (step !== undefined) {
            e.preventDefault();
            move(step);
            return;
          }
          if (e.key === 'PageUp' || e.key === 'PageDown') {
            e.preventDefault();
            page(e.key === 'PageUp' ? -1 : 1);
            return;
          }
          if (e.key === 'Home') {
            e.preventDefault();
            move(-dayOfWeek(focused));
            return;
          }
          if (e.key === 'End') {
            e.preventDefault();
            move(6 - dayOfWeek(focused));
          }
        }}
      >
        {weeks.map((week) => (
          <div key={week[0]} role="row" className="grid grid-cols-7">
            {week.map((date) => {
              const inMonth = ymOf(date) === ym;
              const selected = date === value;
              return (
                <div key={date} role="gridcell" className="grid place-items-center">
                  <button
                    type="button"
                    data-date={date}
                    tabIndex={date === focused ? 0 : -1}
                    aria-label={dayLabel(date)}
                    aria-pressed={selected}
                    aria-current={date === today ? 'date' : undefined}
                    onClick={() => onPick(date)}
                    className={`w-[30px] min-h-[28px] grid place-items-center rounded-[6px] text-ui tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      selected
                        ? 'bg-ink text-paper font-semibold'
                        : `hover:bg-hover ${
                            // A day already gone is still selectable — a goal
                            // recorded after its deadline passed is a real
                            // thing to record — but it is not what you are
                            // looking for. `text-muted`, never `text-faint`:
                            // it is READ while scanning the grid. `text-faint`
                            // is spent on the neighbouring month instead,
                            // which genuinely is peripheral.
                            !inMonth ? 'text-faint' : date < today ? 'text-muted' : 'text-ink'
                          }`
                    } ${date === today && !selected ? 'ring-1 ring-accent' : ''}`}
                  >
                    {parseD(date).getDate()}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-[6px] pt-[6px] border-t border-line flex flex-wrap gap-[4px]">
        {deadlinePresets(today).map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onPick(preset.date)}
            className="text-meta text-ink-soft px-[7px] py-[3px] rounded-field hover:bg-hover hover:text-ink"
          >
            {preset.label}
          </button>
        ))}
        {value && (
          <button
            type="button"
            onClick={onClear}
            className="text-meta text-muted px-[7px] py-[3px] rounded-field hover:bg-hover hover:text-ink"
          >
            {clearLabel}
          </button>
        )}
      </div>
    </div>
  );
}
