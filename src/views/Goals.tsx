// TODO(round-2): full Goals UI — see prototype.html
import { useAppStore } from '../state/store';
import { ProgressBar } from '../components/ProgressBar';
import { goalPct } from '../lib/pct';
import { fmtD } from '../lib/dates';

export function Goals() {
  const { goals } = useAppStore();

  return (
    <div>
      <h1 className="font-disp text-[1.74rem] font-semibold tracking-[-0.015em] mb-[3px]">Goals</h1>
      <p className="text-muted text-[.86rem] mb-[30px]">
        Each goal is a tree. Tick the leaves; the percentage rolls up on its own.
      </p>

      {goals.map((g) => {
        const pct = Math.round(goalPct(g));
        return (
          <div key={g.id} className="py-[18px] pb-[8px] border-b border-line">
            <div className="flex items-baseline gap-3">
              <span className="font-disp text-[1.18rem] font-semibold tracking-[-0.01em]">{g.title}</span>
              <span className="text-[.76rem] text-muted ml-auto whitespace-nowrap">
                {fmtD(g.start)} → {fmtD(g.deadline)}
              </span>
            </div>
            <div className="flex items-center gap-[11px] mt-[10px] mb-[6px]">
              <span className="font-disp text-[1.05rem] font-semibold tabular-nums min-w-[46px]">{pct}%</span>
              <ProgressBar pct={pct} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
