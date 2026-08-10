import { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Goal } from '../../db/types';
import { IconDots } from '../../components/Icons';
import { fmtD } from '../../lib/dates';
import { blockedLeafCount, firstBlockedLeaf } from '../../lib/board';
import { fmtMinutes, goalEffort } from '../../lib/effort';
import {
  nearestMeaningfulDate,
  attentionBadge,
  nextOpenAction,
  type AttentionBadge,
} from '../../lib/plan';
import { isValidLocalDate, needsDateConfirmation } from '../../lib/schedule';
import { HORIZON_LABELS } from './styles';
import { containerDragAttributes } from '../../lib/dragAttributes';

const BADGE_TONE: Record<AttentionBadge['tone'], string> = {
  warn: 'text-warn bg-warn-tint',
  'warn-strong': 'text-accent-contrast bg-warn',
  accent: 'text-accent-deep bg-accent-tint',
  plan: 'text-accent-deep border border-accent-soft',
  step: 'text-muted border border-line-2',
};

/** Roughly the menu's own height — enough to decide which way it fits. */
const MENU_HEIGHT_PX = 210;

export function storedDateRangeLabel(goal: Pick<Goal, 'start' | 'deadline'>): string {
  if (
    (goal.start !== undefined && !isValidLocalDate(goal.start))
    || (goal.deadline !== undefined && !isValidLocalDate(goal.deadline))
  ) {
    return 'Invalid stored date';
  }
  if (goal.start && goal.deadline) return `${fmtD(goal.start)} → ${fmtD(goal.deadline)}`;
  if (goal.start) return `Starts ${fmtD(goal.start)}`;
  if (goal.deadline) return `Due ${fmtD(goal.deadline)}`;
  return '';
}

// ── Card face (shared by the sortable card + the drag overlay) ─────────────────
// Title + dated-with-kind → next open action → this-week commitment (Now only) →
// compact progress → one attention badge. Expected % is intentionally gone (Q8).
function CardFace({
  goal,
  today,
  suppressDateBadge = false,
}: {
  goal: Goal;
  today: string;
  /**
   * The card below renders a richer dates-unconfirmed block with Confirm/Edit,
   * and `attentionBadge` returns a badge for the same predicate — so both fired
   * together, stacking the identical phrase twice on one card by construction.
   */
  suppressDateBadge?: boolean;
}) {
  const effort = goalEffort(goal);
  const next = nextOpenAction(goal, today);
  const dateInfo = nearestMeaningfulDate(goal, today);
  const badge = suppressDateBadge && needsDateConfirmation(goal)
    ? null
    : attentionBadge(goal, today);
  const blocked = blockedLeafCount(goal.nodes);
  const blockedReason = blocked > 0 ? firstBlockedLeaf(goal.nodes)?.blockedOn : undefined;

  return (
    <>
      <div className="flex items-start gap-[8px]">
        <h3
          title={goal.title}
          // Three lines, not two: course goals are "<course> — <assignment>"
          // and two lines clipped at "…— Pse…", losing the only thing that
          // distinguishes Pset 6 from Pset 7.
          className="text-title font-semibold tracking-[-0.01em] leading-[1.24] flex-1 min-w-0 line-clamp-3"
        >
          {goal.title}
        </h3>
        {dateInfo && (
          <span
            className={`text-meta px-[6px] py-[3px] rounded-[6px] whitespace-nowrap tabular-nums flex-none mt-[1px] ${
              dateInfo.past ? 'text-warn bg-warn-tint' : 'text-chip-ink bg-chip'
            }`}
          >
            {dateInfo.kind === 'checkpoint' ? 'Milestone' : 'Due'} · {fmtD(dateInfo.date)}
          </span>
        )}
      </div>

      {/*
        ONE line of remaining work, where a percentage, a full progress bar, a
        "Next · …" line and a weekly planned sentence used to stack. The bar in
        particular claimed to be the card's primary object while measuring a
        figure that silently changes basis; minutes have one meaning and are
        what a person plans against.
      */}
      {effort.total > 0 && (
        <p className="text-compact text-ink-soft tabular-nums">
          {effort.done === effort.total
            ? 'Every task done'
            : /*
               * `0m left` is not a measurement — it is the absence of one, and
               * printing it beside "4 unestimated" made a goal nobody had
               * estimated read as a goal with no work left in it. The count is
               * always true; the minutes are stated only once something has
               * actually been estimated.
               */
              effort.remainingMin > 0
                ? `${fmtMinutes(effort.remainingMin)} left · ${effort.done}/${effort.total}`
                : `${effort.done}/${effort.total}`}
          {effort.unestimated > 0 && (
            <span className="text-muted"> · {effort.unestimated} unestimated</span>
          )}
        </p>
      )}

      {/* Only when it names a real task. The three state sentences this can
          return — no tasks yet, all complete, everything blocked — are already
          said by the badge, the effort line and the blocked indicator, and
          repeating them here would be the card arguing with itself. */}
      {next.nodeId && (
        <p className="text-compact text-muted truncate">
          <span className="text-ink-soft">Next</span> {next.title}
        </p>
      )}

      {(badge || blocked > 0) && (
        <div className="flex flex-wrap items-center gap-[5px]">
          {badge && (
            <span
              title={badge.hint}
              className={`text-badge font-semibold px-[7px] py-[2px] rounded-full ${BADGE_TONE[badge.tone]}`}
            >
              {badge.label}
            </span>
          )}
          {blocked > 0 && (
            // "tasks", not the bare count the filter row's "Blocked goals"
            // signal counts — this is a task tally, and the two must not read
            // as the same quantity.
            <span className="text-meta text-warn whitespace-nowrap">{blocked} task{blocked === 1 ? '' : 's'} blocked</span>
          )}
          {blockedReason && (
            <span
              title={blockedReason}
              className="text-meta text-muted overflow-hidden text-ellipsis whitespace-nowrap min-w-0"
            >
              · {blockedReason}
            </span>
          )}
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
  onMove,
  onRank,
  onDelete,
  reducedMotion,
  dimmed,
  matched,
  highlighted = false,
}: {
  goal: Goal;
  today: string;
  /** Open the goal. The card body is the only route: the footer that used to
   *  duplicate it is gone. */
  onOpen: (id: string) => void;
  onMove: (id: string, column: number) => void;
  /** Re-rank within the current horizon: -1 up, +1 down. */
  onRank: (id: string, delta: number) => void;
  onDelete: (id: string) => void;
  reducedMotion: boolean;
  dimmed: boolean;
  matched: boolean;
  /**
   * The date-review banner is pointing at this card. A ring, not a focus style:
   * the banner focuses the card programmatically after a mouse click, which
   * `:focus-visible` deliberately does not match.
   */
  highlighted?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: goal.id });
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuUp, setMenuUp] = useState(true);
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

  const currentCol = goal.column ?? 0;

  // Action buttons live inside the drag activator, so each swallows the pointer
  // (no drag) and the click (no drawer-open) before running its own handler.
  function act(fn: (e: React.MouseEvent) => void) {
    return (e: React.MouseEvent) => {
      e.stopPropagation();
      fn(e);
    };
  }
  const stopPointer = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <div
      id={`goal-card-${goal.id}`}
      ref={setNodeRef}
      style={style}
      {...containerDragAttributes(attributes)}
      {...listeners}
      aria-label={`${goal.title} — Enter to open, Alt with arrow keys to move`}
      onClick={() => onOpen(goal.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(goal.id);
          return;
        }
        /*
         * Alt+Arrow moves the card: left/right across horizons, up/down within
         * one. Both were pointer-only — the ⋯ menu offers horizons but no
         * ordering, and dnd-kit's keyboard activator never fires here because
         * this explicit `onKeyDown` is spread after `{...listeners}` and wins.
         *
         * Alt rather than Cmd because ⌘← is Back in a browser, and this card
         * sits in a normal document. Alt+Arrow carries no default on a
         * non-text element, matches the direction it performs, and cannot be
         * reached by someone simply navigating.
         */
        if (!e.altKey) return;
        const horizon = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
        if (horizon !== undefined) {
          e.preventDefault();
          onMove(goal.id, currentCol + horizon);
          return;
        }
        const rank = { ArrowUp: -1, ArrowDown: 1 }[e.key];
        if (rank !== undefined) {
          e.preventDefault();
          onRank(goal.id, rank);
        }
      }}
      className={`group relative select-none cursor-grab active:cursor-grabbing flex flex-col gap-[8px] p-[13px] rounded-card bg-panel border border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-shadow ${
        matched ? 'shadow-today' : 'shadow-card hover:shadow-today'
      } ${highlighted ? 'ring-2 ring-accent' : ''}`}
    >
      <CardFace goal={goal} today={today} suppressDateBadge />

      {/*
        No action footer, and no date-confirmation sub-card.

        `Plan next task` and `Open goal` both duplicated what clicking the card
        already does, so a card offered three overlapping entry paths to the
        same place — and the confirmation panel turned data hygiene into the
        board's dominant visual state, one tinted sub-card per card. The batch
        review banner above the board does that job once, for all of them, and
        the badge still says "Dates unconfirmed" here.

        What is left is the overflow, revealed on hover in the corner, holding
        the two things the card body cannot do: move it, and delete it.
      */}
      <div className="absolute top-[7px] right-[7px]" ref={menuRef}>
          <button
            type="button"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onPointerDown={stopPointer}
            onClick={act((e) => {
              // Flip below the trigger when there is room; the menu was
              // unconditionally anchored above, so on any card but the first it
              // opened over its NEIGHBOUR — ambiguous ownership on a menu whose
              // last item is "Delete goal".
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setMenuUp(window.innerHeight - rect.bottom < MENU_HEIGHT_PX);
              setMenuOpen((v) => !v);
            })}
            className={`quiet-control text-faint px-[6px] min-h-[24px] inline-flex items-center rounded-field bg-panel hover:bg-hover hover:text-ink ${menuOpen ? 'opacity-100' : ''}`}
          >
            <IconDots />
          </button>
          {menuOpen && (
            <div
              role="menu"
              onPointerDown={stopPointer}
              className={`absolute right-0 z-20 min-w-[172px] rounded-[11px] border border-line-2 bg-panel shadow-today py-[4px] ${
                menuUp ? 'bottom-[34px]' : 'top-[34px]'
              }`}
            >
              <div className="px-[11px] py-[3px] text-meta text-muted">
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
                  className="w-full text-left text-ui px-[11px] py-[5px] text-ink-soft hover:bg-hover disabled:text-faint disabled:hover:bg-transparent disabled:cursor-default"
                >
                  {label}
                  {i === currentCol && <span className="text-faint text-meta"> · current</span>}
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
                className="w-full text-left text-ui px-[11px] py-[5px] text-warn hover:bg-hover"
              >
                Delete goal
              </button>
            </div>
          )}
      </div>
    </div>
  );
}
