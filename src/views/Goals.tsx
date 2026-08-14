import { useState, useRef, useEffect, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { useAppStore } from '../state/store';
import { IconCheck, IconChevronRight, IconColumns, IconDots, IconTimeline, IconX } from '../components/Icons';
import { Popover, PopoverItem } from '../components/Popover';
import { groupByColumn } from '../lib/board';
import { columnTracks } from '../lib/boardTracks';
import { focusSummary } from '../lib/plan';
import { fmtD } from '../lib/dates';
import { useLocalDate } from '../hooks/useLocalDate';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { Timeline } from './Timeline';
import { NewGoalModal } from './goals/NewGoalModal';
import { ImportGoalModal } from './goals/ImportGoalModal';
import { GoalCardVisual, BoardCard } from './goals/BoardCard';
import { FocusSummary, type FocusFilter } from './goals/FocusSummary';
import { Column } from './goals/Column';
import { LifeTabs } from './goals/LifeTabs';
import { HORIZON_LABELS } from './goals/styles';
import type { Goal } from '../db/types';
import type { GoalsMode } from '../db/db';
import { needsDateConfirmation, confirmableDateGoalIds } from '../lib/schedule';
import { goalsInScope, lifeTabs, nowLimit, resolveScope, withScopeLife } from '../lib/lifeScope';

// Commitment horizons, left → right = Now … Someday. Column order IS the model:
// a project's column is its horizon; height within a column is rank in-horizon.
const COLUMNS = HORIZON_LABELS.map((label, i) => ({ id: `col-${i}`, label }));
const COL_COUNT = COLUMNS.length;

// ── Goals view ────────────────────────────────────────────────────────────────

export function Goals() {
  const { goals, lives, activeLifeId, dateReviewDismissed, activeHorizon, goalsMode, goalModal, actions } = useAppStore();
  // Which composer is up lives in the store: ⌘K can ask for one from anywhere,
  // and a modal only its own page can open is one the palette has to lie about.
  const modal = goalModal;
  const setModal = actions.setGoalModal;
  const [filter, setFilter] = useState<FocusFilter | null>(null);
  // The card the date-review banner (or a horizon move) is pointing at, plus a
  // nonce so pointing at the SAME card twice is still two distinct events.
  // Clears itself after a moment.
  const [highlight, setHighlight] = useState<{ id: string; nonce: number } | null>(null);
  const highlightNonce = useRef(0);
  // Which unconfirmed project the banner walks to next. Kept separately from
  // the highlight, which expires; see reviewUnconfirmedDates.
  const [reviewCursor, setReviewCursor] = useState(0);
  const highlightId = highlight?.id ?? null;
  const currentDate = useLocalDate();

  // Below ~920px the four columns fold into a horizon switcher — one horizon at a
  // time — rather than compressing (spec §2.1/§6). Cross-horizon moves then go
  // through the card's ⋯ menu instead of a drag.
  const wide = useMediaQuery('(min-width: 920px)');

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const goalById = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);

  // The scope, and the goals it admits. Resolved rather than read: `removeLife`
  // can delete the life we are looking at, and an unknown id is 'all'.
  const scope = useMemo(() => resolveScope(activeLifeId, lives), [activeLifeId, lives]);
  const tabs = useMemo(() => lifeTabs(lives, goals), [lives, goals]);
  const scoped = useMemo(() => goalsInScope(goals, scope, lives), [goals, scope, lives]);
  const scopeLabel = tabs.find((t) => t.scope === scope)?.label ?? 'All';

  const active = useMemo(() => scoped.filter((g) => !g.completedAt), [scoped]);
  const unconfirmed = useMemo(() => active.filter(needsDateConfirmation), [active]);
  const confirmableCount = useMemo(() => confirmableDateGoalIds(active).length, [active]);
  const completed = useMemo(
    () => scoped.filter((g) => g.completedAt).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    [scoped],
  );

  // Board columns are built from active projects only; completed projects live
  // in their own section. setGoalBoard weaves the hidden ones back into place.
  const [columns, setColumns] = useState<string[][]>(() => groupByColumn(active, COL_COUNT));
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const [activeId, setActiveId] = useState<string | null>(null);

  // Widths follow what each column holds — except while something is in the
  // air, when they all equalise so an empty Now is a full-size drop target and
  // nothing moves under the cursor. See lib/boardTracks.ts.
  const gridTemplateColumns = useMemo(
    () => columnTracks(columns.map((c) => c.length), { dragging: activeId !== null }),
    [columns, activeId],
  );

  // Re-sync from the store whenever goals change and we're NOT mid-drag
  // (covers add / delete / complete / drawer edits from elsewhere).
  useEffect(() => {
    if (activeId) return;
    setColumns(groupByColumn(active, COL_COUNT));
  }, [active, activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function colIndexOf(id: string): number | null {
    if (id.startsWith('col-')) return Number(id.slice(4));
    const idx = columnsRef.current.findIndex((c) => c.includes(id));
    return idx === -1 ? null : idx;
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  // Live cross-column movement so cards part to show the drop target.
  function handleDragOver({ active: a, over }: DragOverEvent) {
    if (!over) return;
    const activeIdStr = String(a.id);
    const overIdStr = String(over.id);
    const from = colIndexOf(activeIdStr);
    const to = colIndexOf(overIdStr);
    if (from == null || to == null || from === to) return;

    setColumns((prev) => {
      const next = prev.map((c) => [...c]);
      const activeIndex = next[from].indexOf(activeIdStr);
      if (activeIndex === -1) return prev;
      next[from].splice(activeIndex, 1);

      const overIsColumn = overIdStr.startsWith('col-');
      const overIndex = overIsColumn ? -1 : next[to].indexOf(overIdStr);
      const insertAt = overIndex === -1 ? next[to].length : overIndex;
      next[to].splice(insertAt, 0, activeIdStr);
      return next;
    });
  }

  function handleDragEnd({ active: a, over }: DragEndEvent) {
    const activeIdStr = String(a.id);
    const current = columnsRef.current; // already reflects cross-column moves from dragOver
    let next = current;

    if (over) {
      const overIdStr = String(over.id);
      const from = colIndexOf(activeIdStr);
      const to = colIndexOf(overIdStr);
      // Same-column reorder is the only case dragOver left untouched.
      if (from != null && to != null && from === to && !overIdStr.startsWith('col-')) {
        const col = current[from];
        const oldIndex = col.indexOf(activeIdStr);
        const newIndex = col.indexOf(overIdStr);
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          next = current.map((c, i) => (i === from ? arrayMove(col, oldIndex, newIndex) : c));
        }
      }
    }

    setActiveId(null);
    setColumns(next);
    actions.setGoalBoard(next);
  }

  function handleDragCancel() {
    setActiveId(null);
    setColumns(groupByColumn(active, COL_COUNT));
  }

  // Two different nothings. `isEmpty` is "you have never made a goal" and earns
  // the onboarding block; `scopeEmpty` is "this life holds nothing", which must
  // NOT offer Load example — the example lands in a life you are not looking at.
  const isEmpty = goals.length === 0;
  const scopeEmpty = !isEmpty && active.length === 0 && completed.length === 0;
  const activeGoal = activeId ? goalById.get(activeId) : null;

  // Focus summary + spotlight filter. Buttons expose their goalId match sets, so
  // dimming is a pure set membership check — no attention predicate re-derived.
  const summary = useMemo(
    () => focusSummary(scoped, currentDate, nowLimit(scope, tabs)),
    [scoped, currentDate, scope, tabs],
  );
  const matchIds = useMemo(() => {
    if (!filter) return null;
    const src = {
      slots: summary.slots.goalIds,
      'needs-step': summary.needsFirstStep.goalIds,
      behind: summary.behind.goalIds,
      planned: summary.plannedRemaining.goalIds,
      blocked: summary.blocked.goalIds,
    }[filter];
    return new Set(src);
  }, [filter, summary]);
  const filtering = matchIds != null && matchIds.size > 0;

  /**
   * Move a project to another horizon and keep it in sight.
   *
   * Below 920px the board shows one horizon at a time, and the ⋯ menu is the
   * only route between horizons there (drag is unavailable). Moving a card
   * therefore sent it to a column that wasn't rendered, and it simply left the
   * screen — from a menu, so with no drag to explain where it went. Following
   * it across and reusing the date-review banner's highlight makes the
   * destination the answer instead of a guess. The store supplies the toast and
   * the undo.
   */
  function moveToHorizon(goalId: string, column: number) {
    // Clamped and no-opped HERE as well as in the store, because Alt+Arrow can
    // ask for one past either end: `setActiveHorizon(-1)` would blank the
    // narrow board, and highlighting a card that never moved announces a move
    // that did not happen.
    const target = Math.min(Math.max(column, 0), COL_COUNT - 1);
    const goal = goalById.get(goalId);
    // Both sides clamped, exactly as `moveGoalToColumn` compares them. Testing
    // the RAW column against a clamped target let an out-of-range `column: 7`
    // (a hand-edited import, or a future horizon count) pass here and then be
    // refused by the store — switching horizon and ringing a card for a write
    // that never happened.
    if (!goal) return;
    if (Math.min(Math.max(goal.column ?? 0, 0), COL_COUNT - 1) === target) return;
    actions.moveGoalToColumn(goalId, target);
    if (!wide) actions.setActiveHorizon(target);
    setHighlight({ id: goalId, nonce: highlightNonce.current += 1 });
  }

  /**
   * Re-rank within the horizon, keeping focus on the card.
   *
   * A rank move reorders siblings rather than remounting, so focus usually
   * survives — but `insertBefore` on an attached node is remove-then-insert at
   * spec level, so it is not guaranteed. Routing through the same highlight
   * path as a horizon move makes it deterministic, and announces the move the
   * same way.
   *
   * Only on a move that actually happened. `moveGoalRank` is deliberately
   * silent at either end of a column, and this used to ring the card anyway —
   * the same "announces a move that did not happen" bug `moveToHorizon` guards
   * against, and worse here, because the highlight effect focuses through a
   * `requestAnimationFrame`. That stray focus is not merely cosmetic: it lands
   * a frame later, so it could take focus back from a card the user had since
   * moved to and redirect their next keystroke to the wrong project.
   */
  function moveRank(goalId: string, delta: number) {
    if (!actions.moveGoalRank(goalId, delta)) return;
    setHighlight({ id: goalId, nonce: highlightNonce.current += 1 });
  }

  // Board "Plan next step" — the deep-link the modal planner used to have,
  // rebuilt on the command palette's reveal path. The card computes exactly
  // which step it means and this used to drop the id on the floor and just
  // switch view, leaving the project to be found by hand in a rail holding a
  // dozen others. `cardPrimaryAction` returns 'plan' for nearly every healthy
  // project, so that was the default action on most cards.

  /**
   * Walk the unconfirmed projects, one per click.
   *
   * This used to call `.focus()` on the card and nothing else, which read as a
   * dead button for two reasons. The card is a div focused programmatically
   * after a *mouse* click, and Chromium does not match `:focus-visible` in that
   * case — so the card's only highlight never rendered. And it always targeted
   * `unconfirmed[0]`, so a second click on a three-project banner was a no-op
   * even when it did land.
   *
   * So: an explicit highlight that does not depend on focus styling, an
   * explicit centred scroll, and a cursor that advances so the banner walks the
   * whole list. Focus still moves — that is what makes the card's Confirm/Edit
   * buttons a Tab away — but it is no longer the only feedback.
   *
   * The cursor is its own state, and the highlight carries a nonce, because
   * deriving the cursor from the highlight failed in two ways. With exactly one
   * unconfirmed project `(at + 1) % 1 === at`, so `setHighlightId` was handed
   * the value it already held, React bailed out of the render, the effect never
   * re-ran, and the second click did nothing whatsoever — the exact dead button
   * this was meant to fix. And once the highlight expired after 2.6 seconds
   * `at` fell back to -1, so the next click restarted at the first project;
   * "walks the whole list" only held if you clicked again within the window,
   * which is faster than reading the card you were just sent to.
   */
  function reviewUnconfirmedDates() {
    if (unconfirmed.length === 0) return;
    const at = reviewCursor % unconfirmed.length;
    const goal = unconfirmed[at];
    setReviewCursor(at + 1);
    if (!wide) actions.setActiveHorizon(goal.column ?? 0);
    setHighlight({ id: goal.id, nonce: highlightNonce.current += 1 });
  }

  // Scroll/focus in an effect, not in the click handler: in narrow mode the
  // click also switches horizon, and the target card does not exist in the DOM
  // until React has committed that switch. Keyed on the whole `highlight`
  // object so re-selecting the SAME card is still a new event.
  useEffect(() => {
    if (!highlight) return;
    /*
     * One frame later, deliberately.
     *
     * The board renders from local `columns` state, re-synced from the store by
     * the effect declared above this one. Effects run in declaration order, so
     * on the commit where `highlight` lands that effect has only just QUEUED
     * the re-sync — the card is still in its old column, and the next render
     * unmounts it and mounts a fresh node in the new one. Focusing here focused
     * the doomed node, so every Alt+←/→ dropped focus to `<body>` and the
     * second press did nothing. `scrollIntoView` aimed at the stale position
     * for the same reason.
     */
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`goal-card-${highlight.id}`);
      el?.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
      el?.focus({ preventScroll: true });
    });
    const t = setTimeout(() => setHighlight(null), 2600);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [highlight, reducedMotion]);


  const timeline = goalsMode === 'timeline';

  return (
    /* Timeline scrolls a semester sideways and wants the whole viewport; the
       board is a four-column read and stops being legible past ~1280px. The
       measure belongs to the mode, so it is set here rather than in App. */
    <div className={timeline ? undefined : 'max-w-[1280px] mx-auto'}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-[10px] sm:gap-[16px] mb-[6px]">
        <div className="min-w-0">
          <h1 className="text-h1 font-semibold tracking-[-0.015em]">Goals</h1>
          {/* First use only. Explaining the horizons on EVERY visit is a
              paragraph of chrome above the object people came for, and after
              the second goal it is a sentence nobody reads — the column hints
              on Later and Someday carry the same rule where it applies. */}
          {(timeline || goals.length <= 1) && (
            <p className="text-ui text-muted mt-[3px]">
              {timeline
                ? 'Every goal with a start and a deadline, laid out against the calendar.'
                : `Drag a goal between horizons to recommit it — Now is what you're actively pushing on, and ${summary.slots.limit} at a time is the target that keeps focus honest.`}
            </p>
          )}
        </div>
        <div className="flex-none flex items-center gap-[8px] self-start">
          <ViewModeSwitch mode={goalsMode} onChange={actions.setGoalsMode} />
          <Popover
            label="Goals actions"
            role="menu"
            align="end"
            panelWidth={184}
            triggerClassName="w-[26px] h-[26px] grid place-items-center rounded-[6px] text-muted hover:text-ink hover:bg-hover"
            trigger={<IconDots size={13} />}
          >
            {(close) => (
              <>
                <PopoverItem close={close} onSelect={() => setModal('import')}>Import goal</PopoverItem>
                <PopoverItem close={close} onSelect={actions.openSettings}>Manage lives</PopoverItem>
              </>
            )}
          </Popover>
        </div>
      </div>

      {tabs.length > 0 && (
        <div className="mt-[12px]">
          <LifeTabs tabs={tabs} scope={scope} onChange={actions.setGoalScope} />
        </div>
      )}

      {timeline ? (
        <div className="mt-[14px]">
          <Timeline />
        </div>
      ) : (
       <>
      {/* Empty state */}
      {isEmpty && (
        <div className="mt-[18px] grid place-items-center py-[44px] px-[20px] text-center">
          <p className="text-ink-soft text-lead max-w-[440px] mb-[16px] leading-[1.6]">
            No goals yet. A goal is one outcome you can finish — a pset, a paper, a
            launch — split into a few tasks you check off. Start one, or drop in the example
            to see how a good one decomposes.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-[10px]">
            <button
              className="text-body font-semibold text-paper bg-ink px-[14px] py-[8px] rounded-field hover:bg-ink-hover"
              onClick={() => setModal('new')}
            >
              + New goal
            </button>
            <button
              className="text-body font-semibold text-accent-deep border border-line-2 px-[13px] py-[8px] rounded-field hover:bg-accent-tint"
              onClick={() => {
                actions.addSampleProject();
                actions.showToast('Example goal added — delete it anytime');
              }}
            >
              Load example
            </button>
            <button
              className="text-body font-medium text-ink-soft border border-line-2 px-[13px] py-[8px] rounded-field hover:bg-hover"
              onClick={() => setModal('import')}
            >
              Import goal
            </button>
          </div>
          <p className="text-muted text-compact mt-[13px]">
            New here? Load the example, poke around, then delete it.
          </p>
        </div>
      )}

      {scopeEmpty && (
        <div className="mt-[18px] grid place-items-center py-[36px] px-[20px] text-center">
          <p className="text-ink-soft text-lead max-w-[420px] mb-[14px] leading-[1.6]">
            No goals in {scopeLabel} yet.
          </p>
          <button
            className="text-body font-semibold text-paper bg-ink px-[14px] py-[8px] rounded-field hover:bg-ink-hover"
            onClick={() => setModal('new')}
          >
            + New goal
          </button>
        </div>
      )}

      {unconfirmed.length > 0 && !dateReviewDismissed && (
        <div className="mt-[16px] flex items-center gap-[10px] rounded-card border border-line-2 bg-panel px-[13px] py-[10px] shadow-card">
          <p className="flex-1 text-ui text-ink-soft">
            {unconfirmed.length} {unconfirmed.length === 1 ? 'goal has' : 'goals have'} unconfirmed dates
          </p>
          {confirmableCount > 0 && (
            <button
              type="button"
              onClick={actions.confirmAllGoalDates}
              className="text-compact font-semibold text-accent-deep px-[9px] py-[5px] rounded-field hover:bg-accent-tint"
            >
              Confirm all
            </button>
          )}
          <button
            type="button"
            onClick={reviewUnconfirmedDates}
            className="text-compact font-medium text-ink-soft px-[9px] py-[5px] rounded-field hover:bg-hover hover:text-ink"
          >
            Review
          </button>
          <button
            type="button"
            aria-label="Dismiss date review" 
            onClick={actions.dismissDateReview}
            className="text-muted px-[6px] min-w-[24px] min-h-[24px] inline-flex items-center justify-center rounded-field hover:bg-hover hover:text-ink"
          >
            <IconX />
          </button>
        </div>
      )}

      {/* Focus summary — the board's four attention signals */}
      {!isEmpty && !scopeEmpty && (
        <FocusSummary
          summary={summary}
          active={filtering ? filter : null}
          onToggle={(f) => setFilter((cur) => (cur === f ? null : f))}
          onClear={() => setFilter(null)}
        />
      )}

      {/* Narrow horizon switcher — one horizon at a time under ~920px */}
      {!isEmpty && !scopeEmpty && !wide && (
        <div role="group" aria-label="Show horizon" className="mt-[16px] flex gap-[4px] p-[4px] bg-hover rounded-[11px]">
          {COLUMNS.map((col, i) => (
            <button
              key={col.id}
              type="button"
              aria-pressed={i === activeHorizon}
              aria-label={`Show ${col.label} — ${(columns[i] ?? []).length} goal${(columns[i] ?? []).length === 1 ? '' : 's'}`}
              onClick={() => actions.setActiveHorizon(i)}
              className={`flex-1 text-ui font-medium px-[6px] py-[7px] rounded-field transition-colors ${
                i === activeHorizon ? 'bg-panel text-ink shadow-card' : 'text-muted hover:text-ink'
              }`}
            >
              {col.label}
              <span className="tabular-nums text-muted"> · {(columns[i] ?? []).length}</span>
            </button>
          ))}
        </div>
      )}

      {/* Commitment-horizon board */}
      {!isEmpty && !scopeEmpty && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div
            id="goalsBoard"
            className={`mt-[20px] items-start pb-[8px] ${
              wide ? 'grid gap-[14px] xl:gap-[18px]' : 'flex gap-[18px]'
            } ${wide && !reducedMotion ? 'transition-[grid-template-columns] duration-150' : ''}`}
            style={wide ? { gridTemplateColumns } : undefined}
          >
            {COLUMNS.map((col, i) => {
              if (!wide && i !== activeHorizon) return null;
              return (
              <Column key={col.id} col={col} index={i} ids={columns[i] ?? []} solo={!wide} slim={wide && (columns[i] ?? []).length === 0} nowLimit={summary.slots.limit}>
                {(columns[i] ?? []).map((id) => {
                  const g = goalById.get(id);
                  if (!g) return null;
                  return (
                    <BoardCard
                      key={id}
                      goal={g}
                      today={currentDate}
                      onOpen={actions.openProject}
                      onMove={moveToHorizon}
                      onRank={moveRank}
                      onDelete={actions.removeGoal}
                      onRename={actions.renameGoal}
                      onSetDeadline={(id, deadline) => {
                        const g = goalById.get(id);
                        // `start` passed through: `setGoalDates` deletes any
                        // field it is not given, so omitting it would silently
                        // drop a start date the user never touched.
                        if (g) actions.setGoalDates(id, g.start, deadline);
                      }}
                      reducedMotion={reducedMotion}
                      dimmed={filtering && !matchIds!.has(id) && id !== highlightId}
                      matched={filtering && matchIds!.has(id)}
                      highlighted={id === highlightId}
                      lives={lives}
                      onSetLife={actions.setGoalLife}
                    />
                  );
                })}
              </Column>
              );
            })}
          </div>

          <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
            {activeGoal ? (
              <div className="w-[240px]">
                <GoalCardVisual goal={activeGoal} today={currentDate} overlay />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Completed projects */}
      {completed.length > 0 && <CompletedSection goals={completed} onReopen={actions.reopenGoal} />}

       </>
      )}

      <NewGoalModal
        open={modal === 'new'}
        onClose={() => setModal(null)}
        onAdd={(goal) => {
          // Created on the Startup board ⇒ belongs to Startup. A goal that
          // landed in another life would be a lie told by the only surface
          // that knows which board you were standing on.
          const placed = withScopeLife(goal, scope);
          actions.addGoals([placed]);
          setModal(null);
          // Straight into the workspace. Creation used to end on the board with
          // a toast, which is the one place the new goal is a card among
          // fifteen others and the least useful place to be standing when the
          // next thing to do is break it down.
          actions.openProject(placed.id);
        }}
      />
      <ImportGoalModal
        open={modal === 'import'}
        onClose={() => setModal(null)}
        onImport={(imported) => {
          actions.addGoals(imported);
          actions.showToast(`Imported ${imported.length} goal${imported.length === 1 ? '' : 's'}`);
          setModal(null);
        }}
      />
    </div>
  );
}

// ── View mode ─────────────────────────────────────────────────────────────────
/**
 * Board or Timeline. Icon-only now that the header carries a tab strip: two
 * words plus two more controls above the first card was the chrome soup this
 * pass exists to drain.
 *
 * `Icons.tsx` makes every glyph `aria-hidden` on purpose — an icon never
 * carries the name, the control around it does. So each segment keeps its
 * `title` for the pointer and an explicit `aria-label` for everyone else.
 * These two are the only route between the page's two modes, so losing their
 * names would be a real regression, not a cosmetic one.
 */
const MODES = [
  { value: 'board', label: 'Board' },
  { value: 'timeline', label: 'Timeline' },
] as const;

function ViewModeSwitch({ mode, onChange }: { mode: GoalsMode; onChange: (mode: GoalsMode) => void }) {
  return (
    <div role="group" aria-label="Goals view" className="inline-flex gap-[2px] bg-chip p-[2px] rounded-[6px]">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          title={m.label}
          aria-label={m.label}
          aria-pressed={mode === m.value}
          onClick={() => onChange(m.value)}
          className={`min-w-[28px] min-h-[24px] grid place-items-center rounded-[4px] transition-colors ${
            mode === m.value ? 'bg-raised text-ink shadow-card' : 'text-muted hover:text-ink'
          }`}
        >
          {m.value === 'board' ? <IconColumns size={13} /> : <IconTimeline size={13} />}
        </button>
      ))}
    </div>
  );
}

// ── Completed section ─────────────────────────────────────────────────────────
// Collapsed by default, newest-completed first; each project offers Reopen. Now
// capacity already excludes these (they carry `completedAt`), spec §2.5.
function CompletedSection({ goals, onReopen }: { goals: Goal[]; onReopen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-[22px] border-t border-line pt-[16px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-[9px] w-full text-left px-[2px] py-[4px]"
      >
        <span
          className="text-muted inline-flex transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          aria-hidden="true"
        >
          <IconChevronRight size={12} />
        </span>
        <span className="text-meta font-semibold text-muted">Completed</span>
        <span className="font-mono text-badge text-muted tabular-nums">{goals.length}</span>
      </button>
      {open && (
        <div className="mt-[13px] grid gap-[11px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
          {goals.map((g) => (
            <div
              key={g.id}
              className="flex items-center gap-[10px] px-[13px] py-[11px] border border-line rounded-card bg-panel opacity-[.86]"
            >
              <span className="text-accent inline-flex" aria-hidden="true"><IconCheck /></span>
              <span className="text-lead font-semibold flex-1 min-w-0 truncate">{g.title}</span>
              {g.completedAt && <span className="font-mono text-tiny text-muted whitespace-nowrap">{fmtD(g.completedAt)}</span>}
              <button
                type="button"
                onClick={() => onReopen(g.id)}
                className="text-meta text-muted px-[9px] py-[4px] rounded-field border border-line-2 hover:bg-hover hover:text-ink"
              >
                Reopen
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
