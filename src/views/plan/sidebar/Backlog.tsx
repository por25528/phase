import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { BacklogItem } from '../../../lib/backlog';
import { backlogGroups, capBacklog } from '../../../lib/backlog';
import { useAppStore, actions } from '../../../state/store';
import type { PlanDragData } from '../dropTarget';
import { EstimateField } from '../EstimateField';

/**
 * One draggable row.
 *
 * No border, no fill, no radius at rest — the rail holds dozens of these and
 * every border is a decision the eye has to process for nothing. The hover
 * tint and `cursor-grab` are the whole affordance; a permanent grip glyph on
 * every row would advertise what the cursor already says, and Task 10's
 * `1`-`7` keys give a non-drag route regardless.
 *
 * The complete/delete controls follow the same rule: text at rest, revealed on
 * hover or keyboard focus (the pattern `Habits.tsx` already uses in this rail).
 * They are the only route to `toggleTask`/`removeTask` now that the Today view
 * is gone, so they cannot be hover-only in the pointer sense —
 * `focus-visible:opacity-100` keeps them reachable by keyboard.
 *
 * Both buttons stop the pointer-down from reaching the row: `listeners` is
 * spread onto the row itself, so an un-stopped press would arm the drag sensor
 * and a 5px twitch would turn the click into a drag instead of an action.
 *
 * The estimate badge is the same idea taken one step further: it is the only
 * route to `setTaskEstimate`/`setNodeEstimate` left in the app, because the
 * modal that used to host the editor is gone and resize — the other way to
 * change an estimate — only exists for work already on the grid. Backlog work
 * is by definition not on the grid, so without this it is stuck at whatever
 * estimate it was created with. Clicking the badge swaps it for the field;
 * blur, Enter or Escape swap it back.
 */
function BacklogRow({
  item, onFocusItem,
}: {
  item: BacklogItem;
  onFocusItem: (item: BacklogItem | null) => void;
}) {
  const [editingEstimate, setEditingEstimate] = useState(false);
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
      // Plain `:focus`, NOT `:focus-visible`. dnd-kit's `attributes` put
      // `tabIndex: 0` on this row, so a mouse click focuses it and arms the
      // `1`-`7` weekday placement — but Chromium does not match
      // `:focus-visible` on a tabIndex div focused by pointer, so the app's
      // global focus ring (index.css) never shows. Without this the user sits
      // in an invisible mode where `2` schedules onto Tuesday instead of
      // switching to Goals, and `scheduleNode` has no undo. The mode has to be
      // visible for as long as it is active.
      className={`group flex items-center gap-[6px] text-[.78rem] text-ink-soft px-[6px] py-[3px] rounded-[6px] cursor-grab touch-none focus:outline-none focus:ring-2 focus:ring-accent-tint ${
        isDragging ? 'opacity-40' : 'hover:bg-hover'
      }`}
    >
      <span className="flex-1 min-w-0 truncate">{item.title}</span>
      {editingEstimate ? (
        // onBlur bubbles (React maps it to focusout), so this catches the
        // field's own blur — whether it came from Enter, Escape or a click
        // elsewhere — after the field's handler has already committed or
        // reverted, and puts the badge back.
        <span className="flex-none" onBlur={() => setEditingEstimate(false)}>
          <EstimateField
            minutes={item.estimateMin}
            label={item.title}
            onChange={(minutes) => {
              if (item.kind === 'task') actions.setTaskEstimate(item.id, minutes);
              else actions.setNodeEstimate(item.id, minutes);
            }}
          />
        </span>
      ) : (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setEditingEstimate(true);
          }}
          aria-label={`Set estimate for "${item.title}"`}
          // An existing estimate stays legible at rest — it is information, not
          // a control. A missing one only advertises itself on hover/focus, the
          // rail's rule for everything that is purely an affordance.
          className={`flex-none font-mono text-[.56rem] text-faint hover:text-ink-soft tabular-nums ${
            item.estimateMin === undefined
              ? 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity'
              : ''
          }`}
        >
          {item.estimateMin === undefined ? '+ est' : `${item.estimateMin}m`}
        </button>
      )}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (item.kind === 'task') actions.toggleTask(item.id);
          else actions.toggleLeaf(item.id);
        }}
        aria-label={`Complete "${item.title}"`}
        className="flex-none text-[.72rem] text-muted hover:text-ink opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
      >
        ✓
      </button>
      {/*
        Tasks only. A step belongs to a project's structure — it is deleted in
        the Goals view, where the tree it lives in is visible; offering that
        here would let a stray click amputate a branch from a flat list.
      */}
      {item.kind === 'task' && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            actions.removeTask(item.id);
          }}
          aria-label={`Delete "${item.title}"`}
          className="flex-none text-[.72rem] text-muted hover:text-warn opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          ✕
        </button>
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
