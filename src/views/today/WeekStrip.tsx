import { useAppStore } from '../../state/store';
import { todayStr, weekDates, parseD } from '../../lib/dates';

const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function WeekStrip() {
  const { tasks, habits, selDate, actions } = useAppStore();
  const today = todayStr();
  const habitsLeft = habits.filter((h) => !h.checkins.includes(today)).length;

  return (
    <div className="grid grid-cols-7 gap-[10px]">
      {weekDates(today).map((d) => {
        const isToday = d === today;
        const sel = selDate === d;
        const open = tasks.filter((t) => t.date === d && !t.done);
        const summary = isToday
          ? `${open.length} task${open.length === 1 ? '' : 's'} · ${habitsLeft} habit${habitsLeft === 1 ? '' : 's'} due`
          : open.length === 0
            ? '—'
            : open.length === 1
              ? open[0].title
              : `${open.length} tasks planned`;
        const date = parseD(d);
        const border = isToday ? 'border-accent-soft' : sel ? 'border-ink' : 'border-line hover:bg-hover';
        return (
          <button
            key={d}
            onClick={() => actions.setSelDate(d)}
            aria-pressed={sel}
            aria-label={`Select ${d}`}
            className={`text-left rounded-[12px] border px-[12px] py-[10px] min-h-[72px] flex flex-col gap-[5px] ${
              isToday ? 'bg-panel-bright shadow-today' : 'bg-panel'
            } ${border}`}
          >
            <span className="flex items-baseline gap-[7px]">
              <span className={`font-mono text-[.6rem] tracking-[.1em] ${isToday ? 'text-accent' : 'text-faint'}`}>
                {WD[date.getDay()]}
              </span>
              <span className="font-disp text-[1.06rem] font-semibold text-ink">{date.getDate()}</span>
              {isToday && (
                <span className="font-mono text-[.55rem] tracking-[.1em] text-accent font-bold">TODAY</span>
              )}
            </span>
            <span className={`text-[.72rem] leading-[1.4] truncate ${open.length || isToday ? 'text-chip-ink' : 'text-faint-2'}`}>
              {summary}
            </span>
          </button>
        );
      })}
    </div>
  );
}
