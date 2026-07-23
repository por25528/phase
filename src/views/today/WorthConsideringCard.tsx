import { CardSection } from '../../components/CardSection';
import { Tag } from '../../components/Tag';
import type { DailyWorkSections } from '../../lib/dailyWork';
import { useAppStore } from '../../state/store';
import { scheduleSuggestionForToday } from './workActions';

export function WorthConsideringCard({
  sections,
  today,
}: {
  sections: DailyWorkSections;
  today: string;
}) {
  const { actions } = useAppStore();
  const { suggestions } = sections;

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
              onClick={() => scheduleSuggestionForToday(item, today, actions)}
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
