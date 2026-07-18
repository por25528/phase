import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Goal } from '../../db/types';
import { ProgressBar } from '../../components/ProgressBar';
import { goalPct } from '../../lib/pct';
import { firstOpenLeaf } from '../../lib/tree';
import { todayStr } from '../../lib/dates';
import { deadlineChip } from '../../lib/today';
import { behindPaceBy, expectedPct } from '../../lib/timeline';
import { BehindChip } from '../../components/BehindChip';
import { leafCount } from '../../lib/board';
import { paceStatus } from '../../lib/plan';

// ── Card visual (shared by sortable card + drag overlay) ──────────────────────

export function GoalCardVisual({ goal, overlay }: { goal: Goal; overlay?: boolean }) {
  const today = todayStr();
  const pct = Math.round(goalPct(goal));
  const leaves = leafCount(goal.nodes);
  const next = firstOpenLeaf(goal.nodes);
  const behind = Math.round(behindPaceBy(pct, goal.start, goal.deadline, today));
  const expected = Math.round(expectedPct(goal.start, goal.deadline, today));
  const pace = paceStatus(goal, today);

  return (
    <div
      className={`flex flex-col gap-[9px] p-[13px] rounded-card bg-panel border border-line ${
        overlay ? 'shadow-today rotate-[1.5deg] cursor-grabbing' : 'shadow-card'
      }`}
    >
      <span className="font-disp text-[.96rem] font-semibold tracking-[-0.01em] leading-[1.25] line-clamp-2 pr-[2px]">
        {goal.title}
      </span>
      <div className="flex items-center gap-[9px]">
        <span className="font-disp text-[.9rem] font-semibold tabular-nums min-w-[36px]">{pct}%</span>
        <ProgressBar pct={pct} />
      </div>
      <div className="flex items-center gap-[7px] flex-wrap">
        <span className="text-[.72rem] text-muted tabular-nums">{leaves.done}/{leaves.total}</span>
        <span className="text-faint text-[.66rem]">·</span>
        <span className="font-mono text-[.6rem] tracking-[.04em] text-muted tabular-nums">
          {deadlineChip(goal.deadline, today)}
        </span>
        {expected > 0 && expected < 100 && (
          <span className="text-[.72rem] text-muted tabular-nums">exp {expected}%</span>
        )}
        {pace === 'behind' && <BehindChip pts={behind} />}
        {pace === 'needs-breakdown' && (
          <span className="text-[.68rem] text-muted italic">define next step</span>
        )}
      </div>
      <div className="text-[.72rem] text-muted truncate">
        Next: <span className="text-ink-soft">{next ? next.title : 'Define the first step'}</span>
      </div>
    </div>
  );
}

// ── Sortable card ─────────────────────────────────────────────────────────────

export function BoardCard({
  goal,
  onOpen,
  onDelete,
  reducedMotion,
}: {
  goal: Goal;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  reducedMotion: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: goal.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? undefined : transition,
    opacity: isDragging ? 0.35 : undefined,
  };

  // Whole card is the drag activator. The PointerSensor's 5px activation
  // distance lets a plain click through to onClick (open drawer) while any
  // real drag picks the card up. onKeyDown is overridden after {...listeners}
  // so keyboard focus + Enter/Space opens the goal (pointer handles reorder).
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      aria-label={`${goal.title} — open, or drag to re-rank`}
      onClick={() => onOpen(goal.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(goal.id); }
      }}
      className="group relative select-none cursor-grab active:cursor-grabbing rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-shadow hover:shadow-today"
    >
      <GoalCardVisual goal={goal} />

      {/* Delete — stop pointer/click from starting a drag or opening the goal */}
      <button
        type="button"
        aria-label={`Delete goal: ${goal.title}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onDelete(goal.id); }}
        className="absolute top-[9px] right-[8px] text-faint text-[.78rem] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-[#b4453a] transition-opacity"
      >
        ✕
      </button>
    </div>
  );
}
