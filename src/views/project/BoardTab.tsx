import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { Goal, GoalNode, StepStatus } from '../../db/types';
import type { useAppStore } from '../../state/store';
import { IconGrip } from '../../components/Icons';
import { formatEstimateValue } from '../../lib/estimateInput';
import { boardAreas, boardIsUseful, goalBoard, WIP_LIMIT, type BoardCard } from '../../lib/goalBoard';
import { scheduleCell } from '../../lib/rowSchedule';
import { todayStr } from '../../lib/dates';
import { STATUS_WORD } from '../../lib/status';

/**
 * The goal's tasks by workflow state.
 *
 * Kanban existed in Phase at the wrong level: the global board arranged whole
 * GOALS by commitment horizon, which is a portfolio question you answer weekly.
 * The daily question — what is ready, what am I in the middle of, what is stuck
 * — had no spatial answer at all, and the tree cannot give one, because a tree
 * shows order and this is about state.
 *
 * Everything here is a projection of `goal.nodes`. Dropping a card calls
 * `setNodeStatus` and changes exactly one dimension: its schedule, its
 * estimate and its place in the tree all survive the move.
 */
export function BoardTab({
  goal,
  actions,
  onUseWork,
}: {
  goal: Goal;
  actions: ReturnType<typeof useAppStore>['actions'];
  /** Take the user to the tab that suits this goal better. */
  onUseWork: () => void;
}) {
  const [area, setArea] = useState<string | null>(null);
  const [dragging, setDragging] = useState<GoalNode | null>(null);
  const areas = useMemo(() => boardAreas(goal), [goal]);
  // An area that was filtered to and then deleted must not leave the board
  // showing nothing with no way back.
  const activeArea = areas.some((a) => a.id === area) ? area : null;
  const columns = useMemo(() => goalBoard(goal, activeArea), [goal, activeArea]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragStart(e: DragStartEvent) {
    const found = columns.flatMap((c) => c.cards).find((c) => c.node.id === e.active.id);
    setDragging(found?.node ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const status = e.over?.id;
    if (typeof status !== 'string') return;
    const nodeId = String(e.active.id);
    const current = columns.find((c) => c.cards.some((card) => card.node.id === nodeId));
    if (!current || current.status === status) return;
    actions.setNodeStatus(nodeId, status as StepStatus);
  }

  const inProgress = columns.find((c) => c.status === 'doing')?.cards.length ?? 0;
  const total = columns.reduce((n, c) => n + c.cards.length, 0);

  /*
   * A board is not always the better view, and it should say so rather than
   * showing four large empty drop zones and letting the user conclude the
   * feature is broken. Below a handful of open tasks the tree wins: it shows
   * ORDER, which is what small goals — a reading list, a problem set — are
   * actually organised by, and four columns of one card each is more chrome
   * than content.
   */
  const thin = !boardIsUseful(goal);

  if (total === 0) {
    return (
      <section>
        <p className="text-ui text-muted px-[6px]">
          Nothing to arrange yet.{' '}
          <button type="button" onClick={onUseWork} className="font-semibold text-accent-deep hover:underline">
            Add tasks in Work
          </button>
          {' '}and they will appear here by state.
        </p>
      </section>
    );
  }

  return (
    <section>
      {thin && (
        <p className="text-ui text-muted px-[6px] mb-[10px]">
          Only a few open tasks — {' '}
          <button type="button" onClick={onUseWork} className="font-semibold text-accent-deep hover:underline">
            Work
          </button>
          {' '} shows their order, which is probably what matters here.
        </p>
      )}
      {areas.length > 0 && (
        <div role="group" aria-label="Filter by area" className="flex flex-wrap gap-[4px] mb-[12px]">
          <FilterChip label="All" active={activeArea === null} onClick={() => setArea(null)} />
          {areas.map((a) => (
            <FilterChip
              key={a.id}
              label={a.title}
              active={activeArea === a.id}
              onClick={() => setArea(a.id)}
            />
          ))}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="grid gap-[12px] items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
          {columns.map((col) => (
            <Column
              key={col.status}
              status={col.status}
              title={col.title}
              hint={col.hint}
              cards={col.cards}
              // Warn, never refuse. A hard limit would be the board deciding it
              // knows better than the person about a Tuesday, and the only way
              // past it would be to lie about a status.
              overWip={col.status === 'doing' && inProgress > WIP_LIMIT}
              onOpen={actions.openStep}
            />
          ))}
        </div>

        <DragOverlay>
          {dragging ? (
            <div className="w-[190px] opacity-95">
              <CardBody node={dragging} areaPath={[]} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </section>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`text-meta px-[9px] py-[4px] rounded-field ${
        active ? 'bg-ink text-paper font-semibold' : 'text-ink-soft border border-line-2 hover:bg-hover'
      }`}
    >
      {label}
    </button>
  );
}

function Column({
  status,
  title,
  hint,
  cards,
  overWip,
  onOpen,
}: {
  status: StepStatus;
  title: string;
  hint: string;
  cards: BoardCard[];
  overWip: boolean;
  onOpen: (nodeId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-card px-[8px] pt-[8px] pb-[10px] min-h-[120px] transition-colors ${
        // A drop target is the ONE place a tinted container earns itself; an
        // empty column at rest gets no dashed box, because a dashed border that
        // means "nothing here" stops meaning "drop here".
        isOver ? 'bg-accent-tint' : 'bg-hover'
      }`}
    >
      <div className="flex items-baseline gap-[6px] px-[4px] mb-[7px]">
        <h3 className="text-meta font-semibold text-ink-soft" title={hint}>{title}</h3>
        <span className="text-meta text-muted tabular-nums">{cards.length}</span>
        {overWip && (
          <span className="text-meta text-warn" role="status">
            over {WIP_LIMIT}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-[6px]">
        {cards.map((card) => (
          <Card key={card.node.id} card={card} onOpen={onOpen} />
        ))}
        {cards.length === 0 && (
          <p className="px-[4px] py-[6px] text-meta text-faint">Nothing here</p>
        )}
      </div>
    </div>
  );
}

function Card({ card, onOpen }: { card: BoardCard; onOpen: (nodeId: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.node.id });
  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 1 } : undefined}
      className={`group relative bg-panel border border-line rounded-[6px] ${isDragging ? 'opacity-40' : ''}`}
    >
      {/* The handle carries the drag attributes, not the card: the card body is
          a button, and `role="button"` wrapped around a button swallows its
          label. Same rule as the tree's rows. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        tabIndex={-1}
        aria-label={`Drag "${card.node.title}"`}
        className="quiet-control absolute top-[4px] right-[4px] w-[24px] h-[24px] grid place-items-center text-faint cursor-grab active:cursor-grabbing"
      >
        <IconGrip size={12} />
      </button>
      <button
        type="button"
        onClick={() => onOpen(card.node.id)}
        className="w-full text-left px-[9px] py-[8px] rounded-[6px] hover:bg-hover"
      >
        <CardBody node={card.node} areaPath={card.areaPath} />
      </button>
    </div>
  );
}

/**
 * Title, breadcrumb, estimate, schedule, and the one exception that applies.
 *
 * Deliberately not a dashboard. The global goal cards this sits beside grew a
 * due chip, a next action, a weekly sentence, a percentage, a progress bar, a
 * health badge, blocker text, a date-confirmation panel and an action footer —
 * every card a miniature of the page it links to.
 */
function CardBody({ node, areaPath }: { node: GoalNode; areaPath: string[] }) {
  const when = scheduleCell(node, todayStr());
  const estimate = formatEstimateValue(node.estimateMin);
  return (
    <>
      {areaPath.length > 0 && (
        <span className="block truncate text-meta text-muted mb-[2px]">{areaPath.join(' / ')}</span>
      )}
      <span className="block text-ui text-ink-soft line-clamp-3 pr-[18px]">{node.title}</span>
      {(estimate || when || node.blockedOn) && (
        <span className="flex items-center gap-[6px] mt-[4px] text-meta tabular-nums">
          {estimate && <span className="text-muted">{estimate}</span>}
          {when && <span className={when.tone === 'warn' ? 'text-warn' : 'text-muted'}>{when.text}</span>}
          {node.blockedOn && (
            <span className="text-warn truncate" title={`${STATUS_WORD.blocked}: ${node.blockedOn}`}>
              {node.blockedOn}
            </span>
          )}
        </span>
      )}
    </>
  );
}
