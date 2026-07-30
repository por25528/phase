import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { BacklogItem } from '../../../lib/backlog';
import { backlogGroups, capBacklog } from '../../../lib/backlog';
import { useAppStore } from '../../../state/store';
import type { PlanDragData } from '../dropTarget';

/**
 * One draggable row.
 *
 * No border, no fill, no radius at rest — the rail holds dozens of these and
 * every border is a decision the eye has to process for nothing. The hover
 * tint and `cursor-grab` are the whole affordance; a permanent grip glyph on
 * every row would advertise what the cursor already says, and Task 10's
 * `1`-`7` keys give a non-drag route regardless.
 */
function BacklogRow({
  item, onFocusItem,
}: {
  item: BacklogItem;
  onFocusItem: (item: BacklogItem | null) => void;
}) {
  const data: PlanDragData = {
    kind: item.kind, id: item.id, goalId: item.goalId, title: item.title,
  };
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `${item.kind}:${item.id}`,
    data,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onFocus={() => onFocusItem(item)}
      onBlur={() => onFocusItem(null)}
      className={`flex items-center gap-[6px] text-[.78rem] text-ink-soft px-[6px] py-[3px] rounded-[6px] cursor-grab touch-none ${
        isDragging ? 'opacity-40' : 'hover:bg-hover'
      }`}
    >
      <span className="flex-1 min-w-0 truncate">{item.title}</span>
      {item.estimateMin !== undefined && (
        <span className="flex-none font-mono text-[.56rem] text-faint tabular-nums">
          {item.estimateMin}m
        </span>
      )}
    </div>
  );
}

/**
 * The pinned backlog: everything not placed on the grid, grouped by project,
 * with each project capped to a shortlist.
 *
 * Both kinds of work are draggable. Tasks in particular are new here — the
 * earlier rail listed steps only, so an unplaced task had no route back onto
 * the grid at all.
 *
 * Expansion is local state, not a persisted preference: a shortlist that
 * remembers you expanded everything last week is just the long list again.
 */
export function Backlog({
  weekStart, today, onFocusItem,
}: {
  weekStart: string;
  today: string;
  onFocusItem: (item: BacklogItem | null) => void;
}) {
  const { goals, tasks } = useAppStore();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const groups = backlogGroups(goals, tasks, weekStart, today);
  const capped = capBacklog(groups, expanded);
  // Counted from `items`, never `shown`: the cap hides rows, but this number
  // is what tells you how much is unplanned, and it must stay honest.
  const total = groups.reduce((sum, g) => sum + g.items.length, 0);

  function toggle(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div>
      <h3 className="flex items-baseline gap-[6px] font-mono text-[.58rem] tracking-[.13em] uppercase text-muted font-semibold py-[6px] px-[6px]">
        <span className="flex-1">To plan</span>
        <span className="text-faint tabular-nums">{total}</span>
      </h3>

      {capped.length === 0 ? (
        <div className="text-faint text-[.82rem] italic px-[6px]">
          Nothing left to plan.
        </div>
      ) : (
        capped.map((group, i) => (
          <div key={group.key} className={i === 0 ? '' : 'mt-[14px]'}>
            <div className="flex items-baseline gap-[6px] px-[6px]">
              <span className="font-disp text-[.82rem] font-semibold text-ink flex-1 min-w-0 truncate">
                {group.goalTitle}
              </span>
              {group.goalId && (
                <span className="flex-none font-mono text-[.56rem] text-faint tabular-nums">
                  {group.pct}%
                </span>
              )}
            </div>
            {group.shown.map((item) => (
              <BacklogRow key={`${item.kind}:${item.id}`} item={item} onFocusItem={onFocusItem} />
            ))}
            {group.expandable && (
              <button
                type="button"
                onClick={() => toggle(group.key)}
                className="px-[6px] py-[3px] text-[.72rem] text-muted hover:text-ink"
              >
                {group.hidden > 0 ? `+${group.hidden} more` : 'Show less'}
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
