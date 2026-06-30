import { useAppStore } from '../state/store';
import { DAYS, MO, yearFrac, todayStr } from '../lib/dates';
import { goalPct } from '../lib/pct';

export function Timeline() {
  const { goals, actions } = useAppStore();
  const tf = yearFrac(todayStr()) * 100;

  return (
    <div>
      <h1 className="font-disp text-[1.74rem] font-semibold tracking-[-0.015em] mb-[3px]">Timeline</h1>
      <p className="text-muted text-[.86rem] mb-[30px]">
        Your year as production phases. Bar length is the time span; the fill is progress. Click a bar to open its plan.
      </p>

      <div className="mt-[6px] border border-line rounded-[10px] overflow-hidden bg-panel">
        {/* Header */}
        <div className="flex border-b border-line">
          <div className="w-[160px] flex-shrink-0 border-r border-line px-[12px] py-[9px] text-[.7rem] tracking-[.1em] uppercase text-muted font-semibold bg-bg">
            Goal
          </div>
          <div className="flex-1 flex relative">
            {DAYS.map((d, m) => (
              <div
                key={m}
                className={`py-[9px] pl-[7px] text-[.72rem] text-muted font-medium${m === 0 ? '' : ' border-l border-line'}`}
                style={{ flex: `${d} 0 0` }}
              >
                {MO[m]}
              </div>
            ))}
          </div>
        </div>

        {/* Goal rows */}
        {goals.map((g, i) => {
          const sf = yearFrac(g.start) * 100;
          const ef = yearFrac(g.deadline) * 100;
          const w = Math.max(ef - sf, 2);
          const p = Math.round(goalPct(g));

          return (
            <div
              key={g.id}
              className={`group flex items-stretch min-h-[46px]${i < goals.length - 1 ? ' border-b border-line' : ''}`}
            >
              {/* Lane label */}
              <div className="w-[160px] flex-shrink-0 border-r border-line px-[12px] py-[8px] flex flex-col justify-center gap-[2px] group-hover:bg-hover">
                <span className="text-[.66rem] text-faint font-semibold tracking-[.06em]">#{i + 1}</span>
                <span className="text-[.84rem] font-medium text-ink leading-[1.25]">{g.title}</span>
              </div>

              {/* Plot area */}
              <div className="flex-1 relative">
                {/* Month grid lines */}
                <div className="absolute inset-0 flex pointer-events-none">
                  {DAYS.map((d, m) => (
                    <span
                      key={m}
                      className={m === 0 ? '' : 'border-l border-line'}
                      style={{ flex: `${d} 0 0` }}
                    />
                  ))}
                </div>

                {/* Today line */}
                <div
                  className="absolute top-0 bottom-0 w-[1.5px] bg-accent opacity-55 z-[3] pointer-events-none"
                  style={{ left: `${tf}%` }}
                />

                {/* Goal bar */}
                <button
                  className="absolute top-1/2 -translate-y-1/2 h-[22px] rounded-[6px] bg-track border border-line-2 cursor-pointer overflow-hidden flex items-center z-[2] transition hover:border-accent hover:ring-2 hover:ring-accent-tint"
                  style={{ left: `${sf}%`, width: `${w}%` }}
                  onClick={() => actions.openDrawer(g.id)}
                >
                  <i className="tl-bar-fill" style={{ width: `${p}%` }} />
                  <b className="relative text-[.7rem] font-semibold text-white pl-[8px] [mix-blend-mode:difference] tabular-nums z-[2]">
                    {p}%
                  </b>
                </button>

                {/* Deadline flag */}
                <div
                  className="absolute top-[4px] bottom-[4px] w-[2px] bg-accent z-[4] pointer-events-none"
                  style={{ left: `${ef}%` }}
                >
                  <span className="absolute top-[-1px] left-[-2px] border-[3px] border-transparent border-t-accent" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[.76rem] text-muted mt-[10px]">
        The vertical line is today. Flags mark each deadline. Click any bar to check off its sub-goals — the fill updates live.
      </p>
    </div>
  );
}
