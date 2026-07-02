import { useAppStore } from '../../state/store';
import { CardSection } from '../../components/CardSection';
import { goalPct } from '../../lib/pct';
import { firstOpenLeaf } from '../../lib/tree';
import { deadlineChip } from '../../lib/today';
import { todayStr } from '../../lib/dates';
import { behindPaceBy } from '../../lib/timeline';

export function GoalsCard({ onAddGoal }: { onAddGoal: () => void }) {
  const { goals, tasks, actions } = useAppStore();
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
        const behind = Math.round(behindPaceBy(pct, g.start, g.deadline, today));
        const alreadyPlanned =
          !!next && tasks.some((t) => !t.done && t.goalId === g.id && t.title === next.title && t.date === today);

        function openDrawer() {
          actions.openDrawer(g.id);
        }

        return (
          <div
            key={g.id}
            role="button"
            tabIndex={0}
            onClick={openDrawer}
            onKeyDown={(e) => {
              // Ignore keydowns bubbling up from nested interactive elements
              // (e.g. the "→ today" button) so they activate normally.
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openDrawer();
              }
            }}
            className="group w-full text-left py-[11px] flex flex-col gap-[7px] border-b border-line-soft last:border-b-0 hover:bg-hover -mx-[8px] px-[8px] rounded-field cursor-pointer"
          >
            <span className="flex items-baseline gap-[10px]">
              <span className="font-disp text-[.98rem] font-semibold flex-1 min-w-0 truncate">{g.title}</span>
              {behind >= 10 && (
                <span className="text-[.66rem] font-semibold px-[7px] py-[1px] rounded-full bg-warn-tint text-warn whitespace-nowrap flex-none">
                  {behind} pts behind
                </span>
              )}
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
              {next && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (alreadyPlanned) return;
                    actions.addTask(next.title, today, g.id);
                    actions.showToast(`Added "${next.title}" to today`);
                  }}
                  disabled={alreadyPlanned}
                  aria-label={`Plan "${next.title}" for today`}
                  title={alreadyPlanned ? 'already planned' : undefined}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex-none font-mono text-[.62rem] tracking-[.03em] font-semibold text-accent hover:text-accent-deep disabled:opacity-40 disabled:cursor-not-allowed transition-opacity px-[6px] py-[2px] rounded-field"
                >
                  → today
                </button>
              )}
              <span className="font-mono text-[.7rem] text-ink-soft flex-none tabular-nums">{pct}%</span>
            </span>
          </div>
        );
      })}
    </CardSection>
  );
}
