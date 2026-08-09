import { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Goal } from '../../db/types';
import { ProgressBar } from '../../components/ProgressBar';
import { IconDots } from '../../components/Icons';
import { goalPct } from '../../lib/pct';
import { fmtD } from '../../lib/dates';
import { leafCount, blockedLeafCount, firstBlockedLeaf } from '../../lib/board';
import {
  nearestMeaningfulDate,
  nextOpenAction,
  attentionBadge,
  cardPrimaryAction,
  plannedLeaves,
  weekOf,
  type AttentionBadge,
} from '../../lib/plan';
import { isValidLocalDate, needsDateConfirmation, projectDateError } from '../../lib/schedule';
import { HORIZON_LABELS } from './styles';
import { containerDragAttributes } from '../../lib/dragAttributes';

const BADGE_TONE: Record<AttentionBadge['tone'], string> = {
  warn: 'text-warn bg-warn-tint',
  'warn-strong': 'text-accent-contrast bg-warn',
  accent: 'text-accent-deep bg-accent-tint',
  plan: 'text-accent-deep border border-accent-soft',
  step: 'text-muted border border-dashed border-line-2',
};

/** Roughly the menu's own height — enough to decide which way it fits. */
const MENU_HEIGHT_PX = 210;

const PRIMARY_LABEL: Record<'plan' | 'define' | 'complete' | 'unblock', string> = {
  plan: 'Plan next step',
  define: 'Define first step',
  complete: 'Complete project',
  unblock: 'Unblock',
};

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
  const leaves = leafCount(goal.nodes);
  const hasLeaves = leaves.total > 0;
  const pct = Math.round(goalPct(goal));
  const dateInfo = nearestMeaningfulDate(goal, today);
  const action = nextOpenAction(goal, today);
  const badge = suppressDateBadge && needsDateConfirmation(goal)
    ? null
    : attentionBadge(goal, today);
  const isNow = (goal.column ?? 0) === 0;
  const wk = isNow ? plannedLeaves([goal], weekOf(today)) : [];
  const wkDone = wk.filter((l) => l.done).length;
  const blocked = blockedLeafCount(goal.nodes);
  const blockedReason = blocked > 0 ? firstBlockedLeaf(goal.nodes)?.blockedOn : undefined;

  return (
    <>
      <div className="flex items-start gap-[8px]">
        <h3
          title={goal.title}
          // Three lines, not two: course projects are "<course> — <assignment>"
          // and two lines clipped at "…— Pse…", losing the only thing that
          // distinguishes Pset 6 from Pset 7.
          className="font-disp text-title font-semibold tracking-[-0.01em] leading-[1.24] flex-1 min-w-0 line-clamp-3"
        >
          {goal.title}
        </h3>
        {dateInfo && (
          <span
            className={`font-mono text-tiny tracking-[.02em] px-[6px] py-[3px] rounded-[6px] whitespace-nowrap tabular-nums flex-none mt-[1px] ${
              dateInfo.past ? 'text-warn bg-warn-tint' : 'text-chip-ink bg-chip'
            }`}
          >
            {dateInfo.kind === 'checkpoint' ? 'Checkpoint' : 'Due'} · {fmtD(dateInfo.date)}
          </span>
        )}
      </div>

      <p
        title={action.title}
        className={`text-compact overflow-hidden text-ellipsis whitespace-nowrap ${
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
        // `muted` in both states. The empty case used to drop to `faint`, which
        // index.css reserves for decorative marks and placeholders — but
        // "Nothing planned this week" is the single most actionable sentence on
        // the card, and 3.17:1 is not a contrast to say it at.
        <p className="font-mono text-badge tabular-nums tracking-[.01em] text-muted">
          {wk.length > 0
            ? `${wkDone} of ${wk.length} planned steps done`
            : hasLeaves
              ? 'Nothing planned this week'
              : 'Nothing to plan yet'}
        </p>
      )}

      <div className="flex items-center gap-[8px]">
        <span className="font-disp text-ui font-semibold tabular-nums text-ink-soft min-w-[30px]">
          {hasLeaves ? `${pct}%` : '—'}
        </span>
        <ProgressBar pct={hasLeaves ? pct : 0} />
      </div>

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
            // "steps", not the bare count the Focus bar's "Blocked projects"
            // signal counts — this is a step tally, and the two must not read
            // as the same quantity (a card showing this can still be dimmed
            // by that signal without contradicting itself).
            <span className="text-meta text-warn whitespace-nowrap">{blocked} step{blocked === 1 ? '' : 's'} blocked</span>
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
  onPlan,
  onDefine,
  onComplete,
  onMove,
  onRank,
  onDelete,
  onConfirmDates,
  onEditDates,
  reducedMotion,
  dimmed,
  matched,
  highlighted = false,
}: {
  goal: Goal;
  today: string;
  /**
   * Open the project, optionally deep-linked to one node — "Unblock" reuses
   * this to land on the blocked step instead of merely opening the project,
   * exactly as `openProject(goalId, nodeId)` already does for the command
   * palette.
   */
  onOpen: (id: string, nodeId?: string) => void;
  onPlan: (id: string) => void;
  onDefine: (id: string) => void;
  onComplete: (id: string) => void;
  onMove: (id: string, column: number) => void;
  /** Re-rank within the current horizon: -1 up, +1 down. */
  onRank: (id: string, delta: number) => void;
  onDelete: (id: string) => void;
  onConfirmDates: (id: string) => void;
  onEditDates: (id: string) => void;
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

  const primary = cardPrimaryAction(goal, today);
  // Only needed for 'unblock', but cheap and 'unblock' implies at least one
  // blocked leaf exists (cardPrimaryAction only returns it when the project
  // is fully blocked), so this is never null when the button below uses it.
  const blockedStepId = primary === 'unblock' ? firstBlockedLeaf(goal.nodes)?.id : undefined;
  const currentCol = goal.column ?? 0;
  const datesUnconfirmed = needsDateConfirmation(goal);
  const storedDateError = projectDateError(goal.start, goal.deadline);
  const storedRange = storedDateRangeLabel(goal);

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

      {datesUnconfirmed && (
        <div className="flex flex-col gap-[5px] rounded-field bg-warn-tint px-[8px] py-[6px]">
          <span className="text-badge text-warn">
            Dates unconfirmed · <span className="tabular-nums">{storedRange}</span>
          </span>
          <div className="flex items-center gap-[4px] -mx-[6px]">
          <button
            type="button"
            disabled={storedDateError !== null}
            title={storedDateError ?? undefined}
            onPointerDown={stopPointer}
            onClick={act(() => onConfirmDates(goal.id))}
            className="text-meta font-semibold text-warn px-[6px] min-h-[24px] rounded-[6px] hover:bg-panel disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Confirm
          </button>
          <button
            type="button"
            onPointerDown={stopPointer}
            onClick={act(() => onEditDates(goal.id))}
            className="text-meta font-medium text-ink-soft px-[6px] min-h-[24px] rounded-[6px] hover:bg-panel"
          >
            Edit
          </button>
          </div>
        </div>
      )}

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
                  : primary === 'unblock'
                    ? onOpen(goal.id, blockedStepId)
                    : onPlan(goal.id),
            )}
            className="text-compact font-semibold text-accent-deep px-[8px] py-[4px] rounded-field hover:bg-accent-tint"
          >
            {PRIMARY_LABEL[primary]}
          </button>
        )}
        <button
          type="button"
          onPointerDown={stopPointer}
          onClick={act(() => onOpen(goal.id))}
          className="text-compact font-medium text-muted px-[8px] py-[4px] rounded-field hover:bg-hover hover:text-ink"
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
            onClick={act((e) => {
              // Flip below the trigger when there is room; the menu was
              // unconditionally anchored above, so on any card but the first it
              // opened over its NEIGHBOUR — ambiguous ownership on a menu whose
              // last item is "Delete project".
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setMenuUp(window.innerHeight - rect.bottom < MENU_HEIGHT_PX);
              setMenuOpen((v) => !v);
            })}
            className="text-faint px-[8px] py-[2px] min-h-[24px] inline-flex items-center rounded-field hover:bg-hover hover:text-ink"
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
              <div className="px-[11px] py-[3px] font-mono text-eyebrow tracking-[.11em] uppercase text-muted">
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
                Delete project
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
