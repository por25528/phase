import { useAppStore } from '../../state/store';
import { CardSection } from '../../components/CardSection';
import { goalPct } from '../../lib/pct';
import { firstOpenLeaf } from '../../lib/tree';
import { deadlineChip } from '../../lib/today';
import { todayStr } from '../../lib/dates';

export function GoalsCard({ onAddGoal }: { onAddGoal: () => void }) {
  const { goals, actions } = useAppStore();
  const today = todayStr();

  return (
    <CardSection
      label="Goals & projects"
      className="pb-[6px]"
      right={
        <button
          type="button"
          onClick={onAddGoal}
          className="px-[13px] py-[6px] rounded-field bg-ink text-paper text-[.8rem] font-semibold hover:bg-ink-hover"
        >
          + Goal
        </button>
      }
    >
      {goals.length === 0 && (
        <div className="text-faint text-[.85rem] italic py-[6px]">No goals yet — add your first above.</div>
      )}
      {goals.map((g) => {
        const pct = Math.round(goalPct(g));
        const next = firstOpenLeaf(g.nodes);
        return (
          <button
            key={g.id}
            type="button"
            onClick={() => actions.openDrawer(g.id)}
            className="w-full text-left py-[11px] flex flex-col gap-[7px] border-b border-line-soft last:border-b-0 hover:bg-hover -mx-[8px] px-[8px] rounded-field"
          >
            <span className="flex items-baseline gap-[10px]">
              <span className="font-disp text-[.98rem] font-semibold flex-1 min-w-0 truncate">{g.title}</span>
              <span className="font-mono text-[.62rem] tracking-[.05em] text-muted flex-none tabular-nums">
                {deadlineChip(g.deadline, today)}
              </span>
            </span>
            <span className="block h-[4px] rounded-full bg-track overflow-hidden">
              <span
                className={`block h-full rounded-full ${pct > 0 ? 'bg-fill' : 'bg-[#D5C9AE]'}`}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </span>
            <span className="flex items-baseline gap-[10px]">
              <span className="text-[.76rem] text-muted flex-1 min-w-0 truncate">
                Next: {next ? next.title : 'Define the first step'}
              </span>
              <span className="font-mono text-[.7rem] text-ink-soft flex-none tabular-nums">{pct}%</span>
            </span>
          </button>
        );
      })}
    </CardSection>
  );
}
