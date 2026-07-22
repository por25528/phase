import { useEffect, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Modal } from '../../components/Modal';
import { getState, useAppStore } from '../../state/store';
import { todayStr, addDays, fmtD, weekDates, parseD } from '../../lib/dates';
import { goalPct } from '../../lib/pct';
import { behindPaceBy } from '../../lib/timeline';
import { firstOpenLeaf } from '../../lib/tree';
import {
  weekOf, plannedLeaves, attentionRank, paceStatus, weekRecap, planOpeningStep,
  PACE_THRESHOLD_PTS, unplannedOpenLeaves, railTree, groupPlannedByGoal,
  type PlannedLeaf, type RailTreeNode,
} from '../../lib/plan';

const SOFT_CAPACITY = 7;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function PlanWeekOverlay({
  open,
  onClose,
  focusGoalId,
}: {
  open: boolean;
  onClose: () => void;
  focusGoalId?: string | null;
}) {
  const { planReview, actions } = useAppStore();
  const [step, setStep] = useState<'recap' | 'plan'>('plan');

  useEffect(() => {
    if (open) {
      actions.ensureWeekRollover();
      // A focused open (board "Plan next step") jumps straight to planning and
      // must NOT consume the pending recap — leave planReview unreviewed.
      setStep(focusGoalId ? 'plan' : planOpeningStep(getState().planReview));
    }
  }, [open, actions, focusGoalId]);

  if (!open) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={step === 'recap' ? 'Last week' : 'Plan your week'}
      size="full"
    >
      {step === 'recap' && planReview ? (
        <RecapStep
          onDone={() => {
            actions.markWeekReviewed();
            setStep('plan');
          }}
          onCloseAll={onClose}
        />
      ) : (
        <PlanStep onClose={onClose} focusGoalId={focusGoalId ?? null} />
      )}
    </Modal>
  );
}

// ── Step 1: recap ─────────────────────────────────────────────────────────────

function RecapStep({ onDone, onCloseAll }: { onDone: () => void; onCloseAll: () => void }) {
  const { goals, planReview, actions } = useAppStore();
  const today = todayStr();
  const week = weekOf(today);
  if (!planReview) return null;
  const r = weekRecap(planReview, goals);

  return (
    <div className="flex flex-col gap-[14px]">
      <p className="text-[.95rem] text-ink">
        <span className="font-disp text-[1.2rem] font-semibold tabular-nums">
          {r.nowComplete.length} of {r.planned}
        </span>{' '}
        of last week's commitments are now complete.
      </p>

      {r.nowComplete.length > 0 && (
        <section>
          <h3 className="font-mono text-[.62rem] tracking-[.1em] uppercase text-muted font-semibold mb-[4px]">Done</h3>
          {r.nowComplete.map((e) => (
            <div key={e.nodeId} className="flex items-center gap-[8px] py-[4px] text-[.86rem]">
              <span className="text-accent">✓</span>
              <span className="flex-1 min-w-0 truncate">{e.leafTitle}</span>
              <span className="text-[.72rem] text-muted truncate">{e.goalTitle}</span>
            </div>
          ))}
        </section>
      )}

      {r.unfinished.length > 0 && (
        <section>
          <h3 className="font-mono text-[.62rem] tracking-[.1em] uppercase text-warn font-semibold mb-[4px]">
            Unfinished — decide
          </h3>
          {r.unfinished.map((e) => (
            <div key={e.nodeId} className="flex items-center gap-[8px] py-[4px] text-[.86rem]">
              <span className="flex-1 min-w-0 truncate">{e.leafTitle}</span>
              <span className="text-[.72rem] text-muted truncate">{e.goalTitle}</span>
              <button
                type="button"
                onClick={() => actions.planNode(e.goalId, e.nodeId, week)}
                className="text-[.72rem] font-semibold text-accent hover:text-accent-deep px-[4px]"
              >
                Replan
              </button>
              <button
                type="button"
                onClick={() => {
                  onCloseAll();
                  actions.openDrawer(e.goalId, e.nodeId);
                }}
                className="text-[.72rem] font-semibold text-ink-soft hover:text-ink px-[4px]"
              >
                Break down
              </button>
              <button
                type="button"
                onClick={() => actions.unplanNode(e.goalId, e.nodeId)}
                className="text-[.72rem] font-semibold text-muted hover:text-ink px-[4px]"
              >
                Remove
              </button>
            </div>
          ))}
        </section>
      )}

      {r.removed.length > 0 && (
        <section>
          <h3 className="font-mono text-[.62rem] tracking-[.1em] uppercase text-faint font-semibold mb-[4px]">Removed</h3>
          {r.removed.map((e) => (
            <div key={e.nodeId} className="py-[3px] text-[.82rem] text-faint line-through">
              {e.leafTitle} <span className="no-underline text-[.72rem]">· {e.goalTitle}</span>
            </div>
          ))}
        </section>
      )}

      <div className="flex items-center gap-[10px] mt-[6px]">
        <button
          type="button"
          onClick={onDone}
          className="px-[16px] py-[8px] rounded-field bg-ink text-paper text-[.84rem] font-semibold hover:bg-ink-hover"
        >
          Continue to planning
        </button>
        <button
          type="button"
          onClick={onDone}
          className="px-[12px] py-[8px] rounded-field text-[.82rem] text-muted hover:bg-hover"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

// ── Step 2: plan — the week grid ──────────────────────────────────────────────

function PlanStep({ onClose, focusGoalId }: { onClose: () => void; focusGoalId: string | null }) {
  const { goals, actions } = useAppStore();
  const today = todayStr();
  const week = weekOf(today);
  const days = weekDates(today); // Mon … Sun (ISO)

  // Rail: each active project (attention order) as a collapsible section, its open,
  // not-yet-planned steps shown as a subgoal tree. `count` (flat leaves) powers the
  // header; a project with no steps (needs-breakdown) collapses to a first-step prompt.
  const railGroups = attentionRank(goals, today)
    .map((goal) => ({
      goal,
      tree: railTree(goal, week),
      count: unplannedOpenLeaves(goal, week).length,
      pace: paceStatus(goal, today),
    }))
    .filter((g) => g.count > 0 || g.pace === 'needs-breakdown');

  // Grid: everything committed to the week, bucketed by day (undated → Any day).
  const placed = plannedLeaves(goals, week);
  const byDay = new Map<string, PlannedLeaf[]>(days.map((d) => [d, []]));
  const anyDay: PlannedLeaf[] = [];
  for (const l of placed) {
    if (l.plannedDay && byDay.has(l.plannedDay)) byDay.get(l.plannedDay)!.push(l);
    else anyDay.push(l);
  }
  const openCount = placed.filter((l) => !l.done).length;

  const focusNodeId = focusGoalId
    ? firstOpenLeaf(goals.find((g) => g.id === focusGoalId)?.nodes ?? [])?.id
    : undefined;

  // Accordion: one project open at a time, so the rail shows one project's steps
  // instead of every project's at once. Defaults to the focused project, else the
  // top of attention order; clicking the open header collapses it.
  const [openId, setOpenId] = useState<string | null>(() =>
    focusGoalId && railGroups.some((g) => g.goal.id === focusGoalId)
      ? focusGoalId
      : railGroups[0]?.goal.id ?? null,
  );
  const toggleProject = (id: string) => setOpenId((cur) => (cur === id ? null : id));

  const [dragTitle, setDragTitle] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // Focus (T9): scroll the target project's rail group into view and pulse it.
  useEffect(() => {
    if (!focusGoalId) return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-project="${CSS.escape(focusGoalId)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
      if (!reduced && typeof el.animate === 'function') {
        el.animate(
          [{ boxShadow: '0 0 0 2px rgb(var(--c-accent))', borderRadius: '10px' }, { boxShadow: '0 0 0 2px rgba(0,0,0,0)', borderRadius: '10px' }],
          { duration: 1400, easing: 'ease-out' },
        );
      }
    }, 70);
    return () => clearTimeout(t);
  }, [focusGoalId]);

  function handleDragStart(e: DragStartEvent) {
    setDragTitle((e.active.data.current as { title?: string } | undefined)?.title ?? '');
  }
  function handleDragEnd(e: DragEndEvent) {
    setDragTitle(null);
    if (!e.over) return;
    const data = e.active.data.current as { goalId: string; nodeId: string } | undefined;
    if (!data) return;
    const zone = String(e.over.id);
    if (zone === 'rail') actions.unplanNode(data.goalId, data.nodeId);
    else if (zone === 'anyday') actions.planNode(data.goalId, data.nodeId, week);
    else if (zone.startsWith('day:')) actions.planNode(data.goalId, data.nodeId, week, zone.slice(4));
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-[14px]">
        <p className="text-[.8rem] text-muted leading-[1.5]">
          Drag a step onto a day — or <span className="text-ink-soft font-medium">Any day</span> to commit it without a
          date. Hover a step and hit <span className="text-ink-soft font-medium">Break</span> to split it into
          day-sized tasks.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-[232px_1fr] gap-[18px] items-start">
          {/* Rail */}
          <RailZone>
            <h3 className="sticky top-0 z-[1] bg-panel font-mono text-[.58rem] tracking-[.13em] uppercase text-muted font-semibold py-[2px] mb-[6px]">
              To plan
            </h3>
            {railGroups.length === 0 ? (
              <div className="text-faint text-[.82rem] italic">
                {goals.some((g) => !g.completedAt)
                  ? 'All caught up — every open step is planned.'
                  : 'No projects yet — add one on the Goals board first.'}
              </div>
            ) : (
              railGroups.map(({ goal, tree, count, pace }) => {
                const isOpen = openId === goal.id;
                const pct = Math.round(goalPct(goal));
                const behind = Math.round(behindPaceBy(pct, goal.start, goal.deadline, today));
                const isBehind = pace === 'behind' && behind >= PACE_THRESHOLD_PTS;
                return (
                  <div key={goal.id} data-project={goal.id} className="border-b border-line-soft last:border-b-0">
                    <button
                      type="button"
                      onClick={() => toggleProject(goal.id)}
                      aria-expanded={isOpen}
                      className="flex items-center gap-[8px] w-full text-left px-[4px] py-[8px] rounded-[8px] hover:bg-hover transition-colors"
                    >
                      <span
                        aria-hidden="true"
                        className={`text-faint text-[.6rem] flex-none transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}
                      >
                        ▶
                      </span>
                      <span className="font-disp text-[.9rem] font-semibold flex-1 min-w-0 truncate">{goal.title}</span>
                      {isBehind && (
                        <span
                          className="flex-none w-[7px] h-[7px] rounded-full bg-warn"
                          title={`${behind} pts behind pace · ${pct}% done`}
                          aria-label={`${behind} points behind pace`}
                        />
                      )}
                      <span className="font-mono text-[.56rem] text-faint tabular-nums flex-none">
                        {count > 0 ? `${count} step${count === 1 ? '' : 's'}` : 'no steps'}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="pb-[10px] pl-[6px] pr-[2px]">
                        {count === 0 ? (
                          <button
                            type="button"
                            onClick={() => { onClose(); actions.openDrawer(goal.id); }}
                            className="text-[.76rem] text-muted italic text-left hover:text-ink px-[3px] py-[2px]"
                          >
                            No steps yet — <span className="not-italic font-semibold text-accent-deep">define a first step</span>
                          </button>
                        ) : (
                          <RailTreeView
                            nodes={tree}
                            goalId={goal.id}
                            week={week}
                            actions={actions}
                            focusNodeId={focusNodeId}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </RailZone>

          {/* Week grid */}
          <div className="min-w-0">
            <div className="flex items-baseline gap-[10px] mb-[10px]">
              <h3 className="font-mono text-[.58rem] tracking-[.13em] uppercase text-muted font-semibold">
                Your week · {fmtD(week)} – {fmtD(addDays(week, 6))}
              </h3>
              <span className="text-[.78rem] text-muted tabular-nums">
                {openCount} planned{openCount > SOFT_CAPACITY && <span className="text-warn"> · big week</span>}
              </span>
            </div>

            <div className="overflow-x-auto pb-[6px]">
              <div className="grid gap-[8px]" style={{ gridTemplateColumns: '1.2fr repeat(7, minmax(66px, 1fr))' }}>
                <DayZone id="anyday" label="Any day" sub="this wk" anyday>
                  <DayContent leaves={anyDay} onRemove={(l) => actions.unplanNode(l.goalId, l.nodeId)} />
                </DayZone>
                {days.map((iso, i) => (
                  <DayZone key={iso} id={`day:${iso}`} label={DOW[i]} sub={String(parseD(iso).getDate())} today={iso === today}>
                    <DayContent leaves={byDay.get(iso)!} onRemove={(l) => actions.unplanNode(l.goalId, l.nodeId)} />
                  </DayZone>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-[12px] mt-[16px] pt-[14px] border-t border-line">
              <span className="text-[.82rem] text-ink-soft">
                <span className="font-disp font-semibold">{openCount}</span> step{openCount === 1 ? '' : 's'} committed this week
              </span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={onClose}
                className="px-[16px] py-[8px] rounded-field bg-ink text-paper text-[.84rem] font-semibold hover:bg-ink-hover"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>

      <DragOverlay>
        {dragTitle != null ? (
          <div className="px-[9px] py-[6px] rounded-[9px] bg-panel border border-accent shadow-today text-[.8rem] text-ink cursor-grabbing max-w-[220px] truncate">
            {dragTitle}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ── Drag zones + chips ────────────────────────────────────────────────────────

function RailZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'rail' });
  return (
    <div
      ref={setNodeRef}
      className={`min-w-0 rounded-card px-[8px] pb-[8px] max-h-[440px] overflow-y-auto transition-colors ${
        isOver ? 'bg-hover' : ''
      }`}
    >
      {children}
    </div>
  );
}

function DayZone({
  id, label, sub, today, anyday, children,
}: {
  id: string; label: string; sub: string; today?: boolean; anyday?: boolean; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col gap-[5px] min-h-[300px] px-[7px] py-[8px] rounded-[11px] border transition-colors ${
        anyday ? 'border-dashed border-line-2' : 'bg-panel border-line'
      } ${today ? 'border-accent' : ''} ${isOver ? 'bg-accent-tint border-accent' : ''}`}
    >
      <div className="flex items-baseline justify-between gap-[4px] pb-[3px] mb-[2px] border-b border-line-soft">
        <span
          className={`font-mono text-[.62rem] font-semibold tracking-[.04em] uppercase ${
            today ? 'text-accent-deep' : anyday ? 'text-ink-soft' : 'text-muted'
          }`}
        >
          {label}
        </span>
        <span className="font-mono text-[.56rem] text-faint tabular-nums">{sub}</span>
      </div>
      {children}
    </div>
  );
}

// A day's steps, stacked under a per-project heading so several projects sharing
// a day never blur together (the "group by project in a day" rule).
function DayContent({ leaves, onRemove }: { leaves: PlannedLeaf[]; onRemove: (l: PlannedLeaf) => void }) {
  if (leaves.length === 0) {
    return <div className="flex-1 grid place-items-center text-faint text-[.62rem] italic min-h-[40px]">—</div>;
  }
  return (
    <>
      {groupPlannedByGoal(leaves).map((grp) => (
        <div key={grp.goalId} className="flex flex-col gap-[3px]">
          <span className="font-mono text-[.5rem] tracking-[.08em] uppercase text-faint truncate px-[1px]">
            {grp.goalTitle}
          </span>
          {grp.leaves.map((l) => (
            <PlacedChip key={l.nodeId} leaf={l} onRemove={() => onRemove(l)} />
          ))}
        </div>
      ))}
    </>
  );
}

// Renders a project's rail tree: leaves as draggable steps, containers as subgoal
// sub-headings with their children nested and indented. Recurses, so a step broken
// into subtasks shows those subtasks in place beneath it. Indentation is absolute
// (depth × 10px per item), so nesting never compounds.
function RailTreeView({
  nodes, goalId, week, actions, focusNodeId, depth = 0,
}: {
  nodes: RailTreeNode[];
  goalId: string;
  week: string;
  actions: ReturnType<typeof useAppStore>['actions'];
  focusNodeId?: string;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((n) =>
        n.isLeaf ? (
          <RailStep
            key={n.id}
            goalId={goalId}
            nodeId={n.id}
            title={n.title}
            focus={n.id === focusNodeId}
            week={week}
            actions={actions}
            depth={depth}
          />
        ) : (
          <div key={n.id} className="mt-[7px]">
            <div style={{ marginLeft: depth * 10 }} className="flex items-center gap-[6px] px-[2px] mb-[1px]">
              <span className="font-mono text-[.52rem] tracking-[.09em] uppercase text-faint truncate">{n.title}</span>
              <span className="h-px flex-1 bg-line-soft" />
            </div>
            <RailTreeView
              nodes={n.children}
              goalId={goalId}
              week={week}
              actions={actions}
              focusNodeId={focusNodeId}
              depth={depth + 1}
            />
          </div>
        ),
      )}
    </>
  );
}

// A rail step: click/drag to plan it, or "Break" (revealed on hover/focus) to split
// a too-big step into day-sized child tasks inline. Breaking down runs
// actions.addChildren, so the step stops being a leaf and its children take its
// place in the rail — no manual refresh, no leaving the overlay.
function RailStep({
  goalId, nodeId, title, focus, week, actions, depth,
}: {
  goalId: string;
  nodeId: string;
  title: string;
  focus: boolean;
  week: string;
  actions: ReturnType<typeof useAppStore>['actions'];
  depth: number;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: nodeId,
    data: { goalId, nodeId, title },
  });

  function close() {
    setText('');
    setEditing(false);
  }
  function commit() {
    // addChildren re-trims and drops blanks; count the clean lines for the toast.
    const lines = text.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
    if (lines.length > 0) {
      actions.addChildren(nodeId, lines);
      actions.showToast(`Added ${lines.length} task${lines.length === 1 ? '' : 's'}`);
    }
    close();
  }

  return (
    <div
      ref={setNodeRef}
      data-step={nodeId}
      style={{ marginLeft: depth * 10 }}
      className={`group my-[4px] rounded-[9px] border bg-panel shadow-card ${
        focus ? 'border-accent ring-2 ring-accent-tint' : 'border-line-2'
      } ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center gap-[4px] px-[8px] py-[5px]">
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={() => actions.planNode(goalId, nodeId, week)}
          className="flex items-center gap-[7px] flex-1 min-w-0 text-left text-[.79rem] text-ink-soft cursor-grab hover:text-ink"
        >
          <span className="text-faint text-[.7rem] flex-none">⠿</span>
          <span className="flex-1 min-w-0 truncate">{title}</span>
        </button>
        <button
          type="button"
          aria-label={`Break "${title}" into daily tasks`}
          aria-expanded={editing}
          onClick={() => (editing ? close() : setEditing(true))}
          className={`flex-none font-mono text-[.54rem] tracking-[.08em] uppercase px-[5px] py-[3px] rounded-[6px] transition-opacity ${
            editing
              ? 'text-accent-deep bg-accent-tint opacity-100'
              : 'text-faint hover:text-ink hover:bg-hover opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          }`}
        >
          Break
        </button>
      </div>
      {editing && (
        <div className="px-[9px] pb-[8px] pt-[1px] flex flex-col gap-[6px]">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
            rows={3}
            placeholder="One task per line…"
            className="w-full resize-y rounded-field border border-line-2 bg-transparent px-[7px] py-[5px] text-[.76rem] leading-[1.5] text-ink outline-none focus-visible:border-accent"
          />
          <div className="flex items-center gap-[8px]">
            <button
              type="button"
              onClick={commit}
              disabled={!text.trim()}
              className="text-[.74rem] font-semibold text-paper bg-ink px-[10px] py-[4px] rounded-field hover:bg-ink-hover disabled:opacity-40"
            >
              Add tasks
            </button>
            <button
              type="button"
              onClick={close}
              className="text-[.74rem] text-muted px-[6px] py-[4px] rounded-field hover:bg-hover"
            >
              Cancel
            </button>
            <span className="text-[.64rem] text-faint ml-auto tabular-nums">⌘↵ to add</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PlacedChip({ leaf, onRemove }: { leaf: PlannedLeaf; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: leaf.nodeId,
    data: { goalId: leaf.goalId, nodeId: leaf.nodeId, title: leaf.title },
    disabled: leaf.done,
  });
  if (leaf.done) {
    return (
      <div className="flex items-center gap-[5px] px-[7px] py-[5px] rounded-[7px] opacity-60 text-[.72rem]">
        <span className="text-accent flex-none">✓</span>
        <span className="flex-1 min-w-0 truncate line-through text-muted">{leaf.title}</span>
      </div>
    );
  }
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`group flex items-center gap-[5px] px-[7px] py-[5px] rounded-[7px] bg-hover text-[.72rem] cursor-grab ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <span className="flex-1 min-w-0 truncate text-ink">{leaf.title}</span>
      <button
        type="button"
        aria-label={`Unplan "${leaf.title}"`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onRemove}
        className="text-faint text-[.66rem] flex-none opacity-0 group-hover:opacity-100 hover:text-ink"
      >
        ✕
      </button>
    </div>
  );
}
