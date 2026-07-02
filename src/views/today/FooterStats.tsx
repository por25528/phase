import { useAppStore } from '../../state/store';
import { todayStr, streak } from '../../lib/dates';
import { minutesThisWeek, fmtMinutes } from '../../lib/sessions';
import { habitHitPct } from '../../lib/today';

export function FooterStats() {
  const { habits, sessions } = useAppStore();
  const today = todayStr();
  const weekMin = minutesThisWeek(sessions, today);
  const best = habits.reduce<{ n: number; title: string } | null>((acc, h) => {
    const n = streak(h);
    return !acc || n > acc.n ? { n, title: h.title } : acc;
  }, null);

  const stats: { value: string; label: string }[] = [
    { value: weekMin > 0 ? fmtMinutes(weekMin).toLowerCase() : '0m', label: 'LOGGED THIS WEEK' },
  ];
  if (best) stats.push({ value: `${best.n}d`, label: `BEST STREAK — ${best.title.toUpperCase()}` });
  if (habits.length > 0) stats.push({ value: `${habitHitPct(habits, today, 20)}%`, label: 'HABIT HITS — LAST 20 DAYS' });

  return (
    <footer className="mt-[24px] border-t border-line pt-[16px] pb-[26px] flex gap-[56px] items-baseline flex-wrap">
      {stats.map((s) => (
        <div key={s.label}>
          <div className="font-disp text-[1.4rem] font-semibold">{s.value}</div>
          <div className="font-mono text-[.6rem] tracking-[.1em] text-muted mt-[2px]">{s.label}</div>
        </div>
      ))}
      <div className="flex-1" />
      <span className="font-mono text-[.6rem] tracking-[.08em] text-faint">
        1–4 SWITCH VIEWS · T TODAY · ESC CLOSES
      </span>
    </footer>
  );
}
