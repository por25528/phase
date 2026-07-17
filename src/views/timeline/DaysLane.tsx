import { useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { todayStr, fmtD, parseD } from '../../lib/dates';
import { dateToX } from '../../lib/timeline';
import { pinnedDayCounts } from '../../lib/plan';
import type { CanvasSeg } from '../../lib/timeline';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Week-zoom day strip in the timeline header — the Calendar page's day-level
 * detail, absorbed: day-number buttons (accent circle on today, month name on
 * the 1st), planned-step count, and habit check-in dots. Clicking a day opens it in
 * the Today view, exactly like clicking a Calendar cell used to.
 */
export function DaysLane({
  segs, rangeStart, pxPerDay,
}: { segs: CanvasSeg[]; rangeStart: string; pxPerDay: number }) {
  const { goals, habits, actions } = useAppStore();
  const today = todayStr();

  const stepCount = useMemo(() => pinnedDayCounts(goals), [goals]);

  const habitHits = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of habits) for (const d of h.checkins) m.set(d, (m.get(d) ?? 0) + 1);
    return m;
  }, [habits]);

  return (
    <div className="relative h-[46px]">
      {segs.map((s) => {
        const x = dateToX(s.start, rangeStart, pxPerDay);
        const dt = parseD(s.start);
        const isToday = s.start === today;
        const weekend = dt.getDay() === 0 || dt.getDay() === 6;
        const nSteps = stepCount.get(s.start) ?? 0;
        const hits = habitHits.get(s.start) ?? 0;
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
              {nSteps > 0 && (
                <span className="text-[.66rem] text-ink-soft tabular-nums" aria-label={`${nSteps} planned steps`}>
                  ·{nSteps}
                </span>
              )}
            </span>
            {hits > 0 && (
              <span
                className="absolute bottom-[5px] left-[7px] flex gap-[3px]"
                aria-label={`${hits} habit check-ins`}
              >
                {Array.from({ length: Math.min(hits, 5) }, (_, i) => (
                  <span key={i} className="w-[5px] h-[5px] rounded-full bg-fill inline-block" />
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
