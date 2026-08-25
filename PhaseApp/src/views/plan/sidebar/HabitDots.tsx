import type { Habit } from '../../../db/types';
import { lastNDays } from '../../../lib/today';
import { fmtD } from '../../../lib/dates';

// The 15-day trail. Decorative by default; when `onToggleDay` is supplied each
// day the habit already existed on becomes a click target so a missed day can be
// backfilled (or an accidental check cleared) straight from the trail. Kept out
// of the tab order — 15 stops per habit would drown keyboard nav — so it's a
// mouse/pointer affordance layered over the always-available today checkbox.
export function HabitDots({
  hb,
  today,
  onToggleDay,
}: {
  hb: Habit;
  today: string;
  onToggleDay?: (date: string) => void;
}) {
  return (
    <div
      className="hb-dots flex gap-[2.5px] flex-none"
      aria-hidden={onToggleDay ? undefined : true}
      onPointerDown={onToggleDay ? (e) => e.stopPropagation() : undefined}
    >
      {lastNDays(today, 15).map((d) => {
        const hit = hb.checkins.includes(d);
        const isToday = d === today;
        // Today-not-yet-done must read as EMPTY, so it takes the same fill as
        // every other missed day and distinguishes itself with a ring. It used
        // to hardcode a light-theme swatch (#F5F4F0 on #C9C5BD); in dark mode
        // that near-white fill was brighter than `--c-dot` — the colour that
        // means *done* — so the one cell standing for "not done yet" was the
        // most completed-looking cell in the trail. Both values are theme
        // tokens now, and neither may go back to a literal.
        const cls = isToday
          ? hit
            ? 'bg-accent'
            : 'bg-dot-off shadow-[inset_0_0_0_1.5px_rgb(var(--c-check))]'
          : hit
            ? 'bg-dot'
            : 'bg-dot-off';
        const editable = onToggleDay && (!hb.createdAt || d >= hb.createdAt);
        if (editable) {
          const when = isToday ? 'today' : fmtD(d);
          return (
            <button
              key={d}
              type="button"
              tabIndex={-1}
              title={`${hit ? 'Clear' : 'Mark'} ${when}`}
              aria-label={`${hit ? 'Clear' : 'Mark'} "${hb.title}" ${isToday ? 'today' : `on ${when}`}`}
              onClick={(e) => { e.stopPropagation(); onToggleDay(d); }}
              className={`w-[7px] h-[7px] rounded-[4px] ${cls} hover:ring-2 hover:ring-accent/40`}
            />
          );
        }
        return <span key={d} className={`w-[7px] h-[7px] rounded-[4px] ${cls}`} />;
      })}
    </div>
  );
}
