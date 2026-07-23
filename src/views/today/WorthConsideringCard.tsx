import { CardSection } from '../../components/CardSection';
import { Tag } from '../../components/Tag';
import { buildDailyWork } from '../../lib/dailyWork';
import { weekOf } from '../../lib/plan';
import { useLocalDate } from '../../hooks/useLocalDate';
import { useAppStore } from '../../state/store';

export function WorthConsideringCard() {
  const { goals, tasks, actions } = useAppStore();
  const today = useLocalDate();
  const week = weekOf(today);
  const { suggestions } = buildDailyWork(goals, tasks, today);

  return (
    <CardSection label="Worth considering">
      {suggestions.length === 0 && (
        <div className="text-faint text-[.85rem] italic py-[6px]">
          No additional recommendation right now.
        </div>
      )}
      {suggestions.map((item) => (
        <div
          key={item.key}
          className="flex items-center gap-[10px] py-[8px] border-b border-line-soft last:border-b-0"
        >
          <span className="flex-1 min-w-0 truncate text-[.88rem]">{item.title}</span>
          {item.goalTitle && <Tag label={item.goalTitle} />}
          {item.goalId && (
            <button
              type="button"
              onClick={() => actions.planNode(item.goalId!, item.id, week, today)}
              className="flex-none text-[.7rem] font-semibold text-accent hover:text-accent-deep px-[3px]"
              aria-label={`Plan "${item.title}" for today`}
            >
              + Today
            </button>
          )}
        </div>
      ))}
    </CardSection>
  );
}
