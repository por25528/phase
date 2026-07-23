import type { ReactNode } from 'react';
import type { DailyWorkItem } from '../../lib/dailyWork';
import { Tag } from '../../components/Tag';
import { TodayCheckbox } from './TodayCheckbox';

const SOURCE_LABELS: Partial<Record<DailyWorkItem['source'], string>> = {
  due: 'DUE',
  'task-today': 'TODAY',
  'pinned-today': 'TODAY',
  'this-week': 'THIS WEEK',
};

export function DailyWorkRow({
  item,
  onToggle,
  action,
}: {
  item: DailyWorkItem;
  onToggle: (item: DailyWorkItem) => void;
  action?: ReactNode;
}) {
  const sourceLabel = SOURCE_LABELS[item.source];

  return (
    <div className="flex items-center gap-[10px] py-[8px] border-b border-line-soft last:border-b-0">
      <TodayCheckbox
        checked={item.done}
        onToggle={() => onToggle(item)}
        ariaLabel={item.done ? `Mark "${item.title}" not done` : `Complete "${item.title}"`}
      />
      <span className={`flex-1 min-w-0 truncate text-[.88rem] ${item.done ? 'line-through text-muted' : ''}`}>
        {item.title}
      </span>
      {sourceLabel && (
        <span className="font-mono text-[.6rem] tracking-[.06em] text-accent flex-none">
          {sourceLabel}
        </span>
      )}
      {item.goalTitle && <Tag label={item.goalTitle} />}
      {action && <div className="flex items-center gap-[4px] flex-none">{action}</div>}
    </div>
  );
}
