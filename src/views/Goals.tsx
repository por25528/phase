import { useRef } from 'react';
import { useAppStore } from '../state/store';
import { ProgressBar } from '../components/ProgressBar';
import { GoalTree } from '../components/GoalTree';
import { goalPct } from '../lib/pct';
import { fmtD } from '../lib/dates';

export function Goals() {
  const { goals, actions } = useAppStore();

  return (
    <div>
      <h1 className="font-disp text-[1.74rem] font-semibold tracking-[-0.015em] mb-[3px]">Goals</h1>
      <p className="text-muted text-[.86rem] mb-[30px]">
        Each goal is a tree. Tick the leaves; the percentage rolls up on its own.
      </p>

      {goals.map((g) => {
        const pct = Math.round(goalPct(g));
        return (
          <div key={g.id} className="py-[18px] pb-[8px] border-b border-line group">
            <div className="flex items-baseline gap-3">
              <span
                className="font-disp text-[1.18rem] font-semibold tracking-[-0.01em] cursor-default"
                onDoubleClick={() => {
                  const v = prompt('Rename goal:', g.title);
                  if (v && v.trim()) actions.renameGoal(g.id, v.trim());
                }}
              >
                {g.title}
              </span>
              <span className="text-[.76rem] text-muted ml-auto whitespace-nowrap">
                {fmtD(g.start)} → {fmtD(g.deadline)}
              </span>
              <button
                className="text-faint text-[.8rem] opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity ml-[8px]"
                onClick={() => {
                  if (confirm('Delete this goal?')) actions.removeGoal(g.id);
                }}
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-[11px] mt-[10px] mb-[6px]">
              <span className="font-disp text-[1.05rem] font-semibold tabular-nums min-w-[46px]">
                {pct}%
              </span>
              <ProgressBar pct={pct} />
            </div>
            <GoalTree nodes={g.nodes} />
            <AddRootInput onAdd={(title) => actions.addRootNode(g.id, title)} />
          </div>
        );
      })}

      <button
        className="text-[.82rem] text-muted px-[9px] py-[5px] rounded-[6px] border border-line-2 hover:bg-hover mt-[22px]"
        onClick={() => {
          const t = prompt('Goal name:');
          if (!t) return;
          const dl = prompt('Deadline (YYYY-MM-DD):', '2026-12-31') || '2026-12-31';
          actions.addGoal(t.trim(), dl);
        }}
      >
        + new goal
      </button>
    </div>
  );
}

function AddRootInput({ onAdd }: { onAdd: (title: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="px-[6px] py-[2px]">
      <input
        ref={ref}
        className="ghost-in w-full text-[.85rem]"
        placeholder="+ add sub-goal…"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && ref.current) {
            const v = ref.current.value.trim();
            if (v) {
              onAdd(v);
              ref.current.value = '';
            }
          }
        }}
      />
    </div>
  );
}
