import { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { BacklogItem } from '../../../lib/backlog';
import { backlogGroups, capBacklog, hiddenProjectCounts, dueChip } from '../../../lib/backlog';
import { revealDomId, groupKeyContaining, type RevealTarget } from '../../../lib/reveal';
import { countOpenCarryOver } from '../../../lib/deferWork';
import { weekOf } from '../../../lib/plan';
import { durationOf } from '../../../lib/slot';
import { useAppStore, actions } from '../../../state/store';
import type { PlanDragData } from '../dropTarget';
import { EstimateControl } from '../../../components/EstimateControl';
import { IconCheck, IconX } from '../../../components/Icons';
import { containerDragAttributes } from '../../../lib/dragAttributes';

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
 * The estimate is `EstimateControl` — the shared badge/field/preset control,
 * identical here and in the drawer's step tree. It used to be inline here, and
 * that was the whole problem: the rail lists only unplaced work from Now/Next
 * projects, so being the sole host made `estimateMin` unreachable for most of
 * the data the capacity engine reads.
 */
function BacklogRow({
  item, onFocusItem, revealed, today,
}: {
  item: BacklogItem;
  onFocusItem: (item: BacklogItem | null) => void;
  /** The palette sent the user to this row — mark it so the search has a visible answer. */
  revealed: boolean;
  today: string;
}) {
  const due = dueChip(item.due, today);
  const data: PlanDragData = {
    kind: item.kind, id: item.id, goalId: item.goalId, title: item.title,
    durationMin: durationOf(item.estimateMin),
  };
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `${item.kind}:${item.id}`,
    data,
  });

  return (
    <div
      ref={setNodeRef}
      id={revealDomId(item.kind, item.id)}
      data-backlog-row=""
      {...containerDragAttributes(attributes, { keyboardDraggable: true })}
      {...listeners}
      aria-label={`${item.title} — drag onto a day, or press 1–7`}
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
      className={`group flex items-center gap-[6px] text-ui text-ink-soft px-[6px] py-[3px] rounded-[6px] cursor-grab touch-none focus:outline-none focus:ring-2 focus:ring-accent-tint ${
        isDragging ? 'opacity-40' : 'hover:bg-hover'
      } ${revealed ? 'ring-2 ring-accent bg-accent-tint' : ''}`}
    >
      <span className="flex-1 min-w-0 truncate">{item.title}</span>
      {/* Only inside the next week, and always for anything overdue. Printing a
          date on every row would make the urgent ones harder to find, not
          easier — the sort already put them on top; this says why. */}
      {due && (
        <span
          className={`flex-none font-mono text-eyebrow tabular-nums ${
            due.overdue ? 'text-warn font-semibold' : 'text-muted'
          }`}
        >
          {due.text}
        </span>
      )}
      <EstimateControl
        minutes={item.estimateMin}
        label={item.title}
        onChange={(minutes) => {
          if (item.kind === 'task') actions.setTaskEstimate(item.id, minutes);
          else actions.setNodeEstimate(item.id, minutes);
        }}
      />
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (item.kind === 'task') actions.toggleTask(item.id);
          else actions.toggleLeaf(item.id);
        }}
        aria-label={`Complete "${item.title}"`}
        className="quiet-control flex-none text-muted hover:text-ink rounded-[4px] hover:bg-hover"
      >
        <IconCheck size={13} />
      </button>
      {/*
        Loose tasks only. A goal's task belongs to its structure — it is deleted in
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
          className="quiet-control flex-none text-muted hover:text-warn rounded-[4px] hover:bg-hover"
        >
          <IconX size={13} />
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
  weekStart, today, onFocusItem, reveal,
}: {
  weekStart: string;
  today: string;
  onFocusItem: (item: BacklogItem | null) => void;
  /** Task the palette is pointing at, if any. */
  reveal?: RevealTarget | null;
}) {
  const { goals, tasks } = useAppStore();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  /*
   * Both of these walk every goal's leaf tree several times over —
   * `backlogGroups` runs `attentionRank`, which is ~7 passes per project, then
   * walks each tree again to build its items; `countOpenCarryOver` adds
   * `buildDailyWork`'s passes on top. This component subscribes to the whole
   * store and re-renders on Plan's 60-second now-line tick, so leaving them
   * bare meant several thousand node visits a minute to move one CSS `top` —
   * in the one file Plan.tsx's memo block was written to protect.
   */
  const groups = useMemo(
    () => backlogGroups(goals, tasks, weekStart, today),
    [goals, tasks, weekStart, today],
  );
  // Only when there is nothing to show: an empty rail must not read as "you
  // are finished" while hidden projects hold the work — deferred to Later/
  // Someday, or blocked with nothing committed. Guarded on `groups.length` so
  // the extra tree walk never runs in the normal case.
  const hidden = useMemo(
    () => (groups.length === 0 ? hiddenProjectCounts(goals, today) : { parked: 0, blocked: 0 }),
    [groups, goals, today],
  );
  const isCurrentWeek = weekStart === weekOf(today);
  const carryOver = useMemo(
    () => (isCurrentWeek ? countOpenCarryOver(goals, tasks, today) : 0),
    [isCurrentWeek, goals, tasks, today],
  );

  // A revealed row that the cap is hiding must be uncollapsed, or the palette
  // scrolls to an element that isn't in the DOM. Derived rather than pushed
  // into `expanded` by an effect, for two reasons: the row is then present in
  // the very commit Plan's rAF measures (an effect would need a second paint),
  // and the expansion retires with the highlight instead of silently becoming
  // a preference the user never asked for.
  const revealKey = reveal ? groupKeyContaining(groups, reveal) : null;
  const effectiveExpanded = revealKey === null || expanded.has(revealKey)
    ? expanded
    : new Set([...expanded, revealKey]);
  const capped = capBacklog(groups, effectiveExpanded);
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
      <h3 className="flex items-baseline gap-[6px] font-mono text-tiny tracking-[.13em] uppercase text-muted font-semibold py-[6px] px-[6px]">
        <span className="flex-1">To plan</span>
        <span className="text-muted tabular-nums">{total}</span>
      </h3>

      {/*
        The exam-week escape valve. `deferOpenToNextWeek` has existed, undoable
        and tested, since the carry-over work landed — with no caller anywhere,
        so the only way to clear a pile of slipped work was one row at a time.

        The label names the count so it can be checked against what moves, and
        the set it moves is `buildDailyWork`'s carry-overs: overdue tasks and
        steps whose planned week has passed. Never a step merely due soon — a
        real commitment is not swept along.

        Shown only on the current week: "next week" is measured from today, so
        offering it while looking at March would move work the user is not
        looking at.
      */}
      {isCurrentWeek && carryOver > 0 && (
        <button
          type="button"
          onClick={() => actions.deferOpenToNextWeek()}
          className="w-full text-left px-[6px] py-[4px] mb-[2px] min-h-[24px] inline-flex items-center text-meta text-muted hover:text-ink rounded-[6px] hover:bg-hover"
        >
          Push {carryOver} overdue item{carryOver === 1 ? '' : 's'} to next week
        </button>
      )}

      {capped.length === 0 ? (
        <div className="text-muted text-body italic px-[6px]">
          {hidden.parked === 0 && hidden.blocked === 0 ? (
            'Nothing left to plan.'
          ) : (
            <>
              Nothing to plan in Now or Next.
              {' '}
              {hidden.parked > 0 && (
                <span className="not-italic">
                  {hidden.parked} deferred goal{hidden.parked === 1 ? ' is' : 's are'} not shown
                  — move one to Now to plan it.
                </span>
              )}
              {hidden.parked > 0 && hidden.blocked > 0 && ' '}
              {hidden.blocked > 0 && (
                <span className="not-italic">
                  {hidden.blocked} goal{hidden.blocked === 1 ? ' has' : 's have'} blocked tasks
                  not shown — unblock one to plan it.
                </span>
              )}
            </>
          )}
        </div>
      ) : (
        capped.map((group, i) => (
          <div key={group.key} className={i === 0 ? '' : 'mt-[14px]'}>
            <div className="flex items-baseline gap-[6px] px-[6px]">
              <span className="font-disp text-body font-semibold text-ink flex-1 min-w-0 truncate">
                {group.goalTitle}
              </span>
              {group.goalId && (
                <span className="flex-none font-mono text-eyebrow text-muted tabular-nums">
                  {group.pct}%
                </span>
              )}
            </div>
            {group.shown.map((item) => (
              <BacklogRow
                key={`${item.kind}:${item.id}`}
                item={item}
                onFocusItem={onFocusItem}
                revealed={reveal?.kind === item.kind && reveal.id === item.id}
                today={today}
              />
            ))}
            {group.expandable && (
              <button
                type="button"
                onClick={() => toggle(group.key)}
                className="px-[6px] py-[3px] min-h-[24px] inline-flex items-center text-meta text-muted hover:text-ink rounded-[6px] hover:bg-hover"
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
