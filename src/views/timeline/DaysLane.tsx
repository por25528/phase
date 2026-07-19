import { useAppStore } from '../../state/store';
import { todayStr, fmtD, parseD } from '../../lib/dates';
import { dateToX } from '../../lib/timeline';
import type { CanvasSeg } from '../../lib/timeline';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Week-zoom day strip in the timeline header: day-number buttons (accent circle
 * on today, month name on the 1st). Clicking a day opens it in the Today view as
 * a navigation convenience — the Timeline no longer schedules actions, so the
 * per-day planned counts and habit dots are gone (spec §3.3).
 */
export function DaysLane({
  segs, rangeStart, pxPerDay,
}: { segs: CanvasSeg[]; rangeStart: string; pxPerDay: number }) {
  const { actions } = useAppStore();
  const today = todayStr();

  return (
    <div className="relative h-[46px]">
      {segs.map((s) => {
        const x = dateToX(s.start, rangeStart, pxPerDay);
        const dt = parseD(s.start);
        const isToday = s.start === today;
        const weekend = dt.getDay() === 0 || dt.getDay() === 6;
        return (
          <button
            key={s.start}
            type="button"
            aria-label={`Open ${fmtD(s.start)}`}
            onClick={() => {
              actions.setSelDate(s.start);
              actions.setView('today');
            }}
            className={`absolute inset-y-0 text-left px-[7px] py-[5px] hover:bg-hover transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint${
              weekend ? ' bg-hover/50' : ''
            }${x <= 0 ? '' : s.major ? ' border-l border-line-2' : ' border-l border-line'}`}
            style={{ left: `${x}px`, width: `${s.days * pxPerDay}px` }}
          >
            <span className="flex items-baseline gap-[5px]">
              <span
                className={`text-[.74rem] tabular-nums font-medium ${
                  isToday
                    ? 'inline-grid place-items-center w-[20px] h-[20px] rounded-full bg-accent text-white'
                    : weekend
                    ? 'text-faint'
                    : 'text-muted'
                }`}
              >
                {!isToday && dt.getDate() === 1 ? fmtD(s.start) : s.label}
              </span>
              <span className="text-[.6rem] uppercase tracking-[.08em] text-faint">{DOW[dt.getDay()]}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
