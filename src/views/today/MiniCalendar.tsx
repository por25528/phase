import { useState } from 'react';
import { useAppStore } from '../../state/store';
import { todayStr, parseD } from '../../lib/dates';
import { ymOf, shiftYm, ymLabel, monthGrid } from '../../lib/calendar';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function MiniCalendar() {
  const { tasks, selDate, actions } = useAppStore();
  const today = todayStr();
  const [ym, setYm] = useState(ymOf(today));
  const [monthName, year] = ymLabel(ym).split(' ');
  const planned = new Set(tasks.filter((t) => !t.done).map((t) => t.date));

  const navBtn =
    'w-[24px] h-[24px] rounded-[7px] border border-line-2 text-[.8rem] text-chip-ink hover:bg-hover grid place-items-center';

  return (
    <section className="bg-panel border border-line rounded-card shadow-card px-[18px] pt-[15px] pb-[12px]">
      <div className="flex items-center mb-[10px]">
        <span className="font-disp text-[.98rem] font-semibold">
          {monthName} <span className="text-muted font-medium">{year}</span>
        </span>
        <div className="flex-1" />
        <div className="flex gap-[4px]">
          <button type="button" aria-label="Previous month" className={navBtn} onClick={() => setYm(shiftYm(ym, -1))}>
            ‹
          </button>
          <button type="button" aria-label="Next month" className={navBtn} onClick={() => setYm(shiftYm(ym, 1))}>
            ›
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-[1px] mb-[4px]">
        {DAY_LETTERS.map((l, i) => (
          <span key={i} className="text-center font-mono text-[.58rem] text-faint">
            {l}
          </span>
        ))}
      </div>
      {monthGrid(ym).map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 gap-[1px]">
          {week.map((d) => {
            const inMonth = d.slice(0, 7) === ym;
            if (!inMonth) return <span key={d} className="h-[32px]" />;
            const isToday = d === today;
            const sel = d === selDate;
            const hasDot = planned.has(d) && !isToday;
            return (
              <button
                key={d}
                type="button"
                onClick={() => actions.setSelDate(d)}
                aria-label={`Plan ${d}`}
                aria-pressed={sel}
                className="h-[32px] flex flex-col items-center justify-center gap-[1px]"
              >
                <span
                  className={`w-[24px] h-[24px] rounded-full grid place-items-center text-[.76rem] ${
                    isToday
                      ? 'bg-accent text-accent-contrast font-semibold'
                      : sel
                        ? 'shadow-[inset_0_0_0_1.5px_#211E19] text-ink font-medium'
                        : d < today
                          ? 'text-faint hover:bg-hover'
                          : 'text-ink-soft hover:bg-hover'
                  }`}
                >
                  {parseD(d).getDate()}
                </span>
                <span className={`w-[4px] h-[4px] rounded-full ${hasDot ? 'bg-accent' : 'bg-transparent'}`} />
              </button>
            );
          })}
        </div>
      ))}
      <div className="mt-[6px] text-[.72rem] text-faint">Dots mark planned items · click a day to plan it</div>
    </section>
  );
}
