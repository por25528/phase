import { MO, todayStr, parseD } from '../lib/dates';
import type { Habit } from '../db/types';

function p2(n: number) { return String(n).padStart(2, '0'); }

function getMonthLabel(w: number, today: Date, dow: number): string | null {
  for (let d = 0; d < 7; d++) {
    const off = -(w * 7) + (d - dow);
    const date = new Date(today);
    date.setDate(today.getDate() + off);
    if (date.getDate() === 1) return MO[date.getMonth()];
  }
  return null;
}

export function TodayHeatmap({ hb }: { hb: Habit }) {
  const WK = 15;
  const ts = todayStr();
  const today = parseD(ts);
  const dow = today.getDay();

  const cols = [];
  for (let w = WK - 1; w >= 0; w--) {
    const monthLabel = getMonthLabel(w, today, dow);
    const cells = [];

    for (let d = 0; d < 7; d++) {
      const off = -(w * 7) + (d - dow);
      const date = new Date(today);
      date.setDate(today.getDate() + off);
      const s = `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
      const isToday = s === ts;
      const fut = date > today;
      const hit = hb.checkins.includes(s);

      cells.push(
        <div
          key={d}
          className={[
            'heat-d',
            hit ? 'h' : '',
            fut ? 'fut' : '',
            isToday ? 'ring-1 ring-line-2' : '',
          ].filter(Boolean).join(' ')}
          title={s}
        />
      );
    }

    cols.push(
      <div key={w} className="flex flex-col">
        <div className="h-[11px] flex items-end">
          {monthLabel && (
            <span className="text-muted leading-none" style={{ fontSize: '0.62rem' }}>
              {monthLabel}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-[2px] mt-[2px]">
          {cells}
        </div>
      </div>
    );
  }

  return <div className="flex gap-[2px] mt-[6px] ml-[28px]">{cols}</div>;
}
