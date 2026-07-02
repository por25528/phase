import type { Habit } from '../../db/types';
import { lastNDays } from '../../lib/today';

export function HabitDots({ hb, today }: { hb: Habit; today: string }) {
  return (
    <div className="hb-dots flex gap-[2.5px] flex-none" aria-hidden="true">
      {lastNDays(today, 15).map((d) => {
        const hit = hb.checkins.includes(d);
        const isToday = d === today;
        const cls = isToday
          ? hit
            ? 'bg-accent'
            : 'bg-[#F5F4F0] shadow-[inset_0_0_0_1.5px_#C9C5BD]'
          : hit
            ? 'bg-dot'
            : 'bg-dot-off';
        return <span key={d} className={`w-[7px] h-[7px] rounded-[2px] ${cls}`} />;
      })}
    </div>
  );
}
