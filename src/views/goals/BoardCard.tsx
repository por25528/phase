import { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Goal } from '../../db/types';
import { ProgressBar } from '../../components/ProgressBar';
import { goalPct } from '../../lib/pct';
import { fmtD } from '../../lib/dates';
import { leafCount } from '../../lib/board';
import {
  nearestMeaningfulDate,
  nextOpenAction,
  attentionBadge,
  cardPrimaryAction,
  plannedLeaves,
  weekOf,
  type AttentionBadge,
} from '../../lib/plan';
import { HORIZON_LABELS } from './styles';

const BADGE_TONE: Record<AttentionBadge['tone'], string> = {
  warn: 'text-warn bg-warn-tint',
  'warn-strong': 'text-accent-contrast bg-warn',
  accent: 'text-accent-deep bg-accent-tint',
  plan: 'text-accent-deep border border-accent-soft',
  step: 'text-muted border border-dashed border-line-2',
};

const PRIMARY_LABEL: Record<'plan' | 'define' | 'complete', string> = {
  plan: 'Plan next step',
  define: 'Define first step',
  complete: 'Complete project',
};

// ── Card face (shared by the sortable card + the drag overlay) ─────────────────
// Title + dated-with-kind → next open action → this-week commitment (Now only) →
// compact progress → one attention badge. Expected % is intentionally gone (Q8).
function CardFace({ goal, today }: { goal: Goal; today: string }) {
  const leaves = leafCount(goal.nodes);
  const hasLeaves = leaves.total > 0;
  const pct = Math.round(goalPct(goal));
  const dateInfo = nearestMeaningfulDate(goal, today);
  const action = nextOpenAction(goal, today);
  const badge = attentionBadge(goal, today);
  const isNow = (goal.column ?? 0) === 0;
  const wk = isNow ? plannedLeaves([goal], weekOf(today)) : [];
  const wkDone = wk.filter((l) => l.done).length;

  return (
    <>
      <div className="flex items-start gap-[8px]">
        <h3 className="font-disp text-[.98rem] font-semibold tracking-[-0.01em] leading-[1.24] flex-1 min-w-0 line-clamp-2">
          {goal.title}
        </h3>
        <span
          className={`font-mono text-[.6rem] tracking-[.02em] px-[6px] py-[3px] rounded-[6px] whitespace-nowrap tabular-nums flex-none mt-[1px] ${
            dateInfo.past ? 'text-warn bg-warn-tint' : 'text-chip-ink bg-chip'
          }`}
        >
          {dateInfo.kind === 'milestone' ? 'Milestone' : 'Due'} · {fmtD(dateInfo.date)}
        </span>
      </div>

      <p
        className={`text-[.76rem] overflow-hidden text-ellipsis whitespace-nowrap ${
          action.kind === 'needs-breakdown' ? 'text-muted italic' : 'text-ink-soft'
        }`}
      >
        {action.kind === 'needs-breakdown' ? (
          action.title
        ) : (
          <>
            <span className="text-muted">Next · </span>
            {action.title}
          </>
        )}
      </p>

      {isNow && (
        <p
          className={`font-mono text-[.66rem] tabular-nums tracking-[.01em] ${
            wk.length > 0 ? 'text-muted' : 'text-faint'
          }`}
        >
          {wk.length > 0
            ? `${wkDone} of ${wk.length} planned steps done`
            : hasLeaves
              ? 'Nothing planned this week'
              : 'Nothing to plan yet'}
        </p>
      )}

      <div className="flex items-center gap-[8px]">
        <span className="font-disp text-[.78rem] font-semibold tabular-nums text-ink-soft min-w-[30px]">
          {hasLeaves ? `${pct}%` : '—'}
        </span>
        <ProgressBar pct={hasLeaves ? pct : 0} />
      </div>

      {badge && (
        <div className="flex flex-wrap gap-[5px]">
          <span className={`text-[.66rem] font-semibold px-[7px] py-[2px] rounded-full ${BADGE_TONE[badge.tone]}`}>
            {badge.label}
          </span>
        </div>
      )}
    </>
  );
}

// Standalone visual for the drag overlay — the face in card chrome, no actions.
export function GoalCardVisual({ goal, today, overlay }: { goal: Goal; today: string; overlay?: boolean }) {
  return (
    <div
      className={`flex flex-col gap-[8px] p-[13px] rounded-card bg-panel border border-line ${
        overlay ? 'shadow-today rotate-[1.5deg] cursor-grabbing' : 'shadow-card'
      }`}
    >
      <CardFace goal={goal} today={today} />
    </div>
  );
}

// ── Sortable card ─────────────────────────────────────────────────────────────

export function BoardCard({
  goal,
  today,
  onOpen,
  onPlan,
  onDefine,
  onComplete,
  onMove,
  onDelete,
  reducedMotion,
  dimmed,
  matched,
}: {
  goal: Goal;
  today: string;
  onOpen: (id: string) => void;
  onPlan: (id: string) => void;
  onDefine: (id: string) => void;
  onComplete: (id: string) => void;
  onMove: (id: string, column: number) => void;
  onDelete: (id: string) => void;
  reducedMotion: boolean;
  dimmed: boolean;
  matched: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: goal.id });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the overflow menu on an outside pointer-press or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? undefined : transition,
    opacity: isDragging ? 0.35 : dimmed ? 0.32 : undefined,
  };

  const primary = cardPrimaryAction(goal, today);
  const currentCol = goal.column ?? 0;

  // Action buttons live inside the drag activator, so each swallows the pointer
  // (no drag) and the click (no drawer-open) before running its own handler.
  function act(fn: () => void) {
    return (e: React.MouseEvent) => {
      e.stopPropagation();
      fn();
    };
  }
  const stopPointer = (e: React.PointerEvent) => e.stopPropagation();

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
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(goal.id);
        }
      }}
      className={`group relative select-none cursor-grab active:cursor-grabbing flex flex-col gap-[8px] p-[13px] rounded-card bg-panel border border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-shadow ${
        matched ? 'shadow-today' : 'shadow-card hover:shadow-today'
      }`}
    >
      <CardFace goal={goal} today={today} />

      {/* Actions */}
      <div className="flex items-center gap-[4px] mt-[2px] pt-[9px] border-t border-line-soft">
        {primary !== 'none' && (
          <button
            type="button"
            onPointerDown={stopPointer}
            onClick={act(() =>
              primary === 'complete'
                ? onComplete(goal.id)
                : primary === 'define'
                  ? onDefine(goal.id)
                  : onPlan(goal.id),
            )}
            className="text-[.74rem] font-semibold text-accent-deep px-[8px] py-[4px] rounded-[8px] hover:bg-accent-tint"
          >
            {PRIMARY_LABEL[primary]}
          </button>
        )}
        <button
          type="button"
          onPointerDown={stopPointer}
          onClick={act(() => onOpen(goal.id))}
          className="text-[.74rem] font-medium text-muted px-[8px] py-[4px] rounded-[8px] hover:bg-hover hover:text-ink"
        >
          Open project
        </button>

        <div className="relative ml-auto" ref={menuRef}>
          <button
            type="button"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onPointerDown={stopPointer}
            onClick={act(() => setMenuOpen((v) => !v))}
            className="text-[.9rem] text-faint px-[8px] py-[2px] rounded-[8px] hover:bg-hover hover:text-ink"
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              role="menu"
              onPointerDown={stopPointer}
              className="absolute right-0 bottom-[34px] z-20 min-w-[172px] rounded-[10px] border border-line-2 bg-panel shadow-today py-[4px]"
            >
              <div className="px-[11px] py-[3px] font-mono text-[.54rem] tracking-[.11em] uppercase text-faint">
                Move to
              </div>
              {HORIZON_LABELS.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  disabled={i === currentCol}
                  onClick={act(() => {
                    onMove(goal.id, i);
                    setMenuOpen(false);
                  })}
                  className="w-full text-left text-[.8rem] px-[11px] py-[5px] text-ink-soft hover:bg-hover disabled:text-faint disabled:hover:bg-transparent disabled:cursor-default"
                >
                  {label}
                  {i === currentCol && <span className="text-faint text-[.7rem]"> · current</span>}
                </button>
              ))}
              <div className="border-t border-line-soft my-[4px]" />
              <button
                type="button"
                role="menuitem"
                onClick={act(() => {
                  onDelete(goal.id);
                  setMenuOpen(false);
                })}
                className="w-full text-left text-[.8rem] px-[11px] py-[5px] text-[#b4453a] hover:bg-hover"
              >
                Delete project
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
