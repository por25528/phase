import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Goal, Life } from '../../db/types';
import { IconDots } from '../../components/Icons';
import { Popover, PopoverItem, PopoverSeparator } from '../../components/Popover';
import { ProgressBar } from '../../components/ProgressBar';
import { fmtD } from '../../lib/dates';
import { blockedLeafCount, firstBlockedLeaf } from '../../lib/board';
import { effortCaption, effortCount, effortPct, goalEffort } from '../../lib/effort';
import {
  nearestMeaningfulDate,
  attentionBadge,
  nextOpenAction,
  type AttentionBadge,
} from '../../lib/plan';
import { isValidLocalDate, needsDateConfirmation } from '../../lib/schedule';
import { HORIZON_LABELS } from './styles';
import { containerDragAttributes } from '../../lib/dragAttributes';
import { lifeOf, sortedLives } from '../../lib/lives';

const BADGE_TONE: Record<AttentionBadge['tone'], string> = {
  warn: 'text-warn bg-warn-tint',
  'warn-strong': 'text-accent-contrast bg-warn',
  accent: 'text-accent-deep bg-accent-tint',
  plan: 'text-accent-deep border border-accent-soft',
  step: 'text-muted border border-line-2',
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
  life,
}: {
  goal: Goal;
  today: string;
  /**
   * The card below renders a richer dates-unconfirmed block with Confirm/Edit,
   * and `attentionBadge` returns a badge for the same predicate — so both fired
   * together, stacking the identical phrase twice on one card by construction.
   */
  suppressDateBadge?: boolean;
  /** The life the goal belongs to, or null/unassigned — printed as nothing. */
  life?: Life | null;
}) {
  const effort = goalEffort(goal);
  const caption = effortCaption(effort);
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
        A meter and its two lines of figures — and yes, this card deleted a
        progress bar once. That bar drew `goalPct`, which switches between an
        estimate-weighted mean and an equal one depending on whether every
        sibling set happens to be estimated, so it made the card's most
        confident-looking object its least stable number. `goalPctBasis` exists
        because that figure has to disclose which rule produced it, and a bar
        cannot.

        This one draws `effortPct` — a flat leaf count, one basis always, and
        the SAME fraction `effortCount` prints at its right edge. The meter
        therefore states nothing the card was not already stating in text,
        which is the whole licence for drawing it. It is a readout, not a
        headline: `text-meta text-muted`, the tone the caption below it takes.

        The caption is kept off the meter's row deliberately. `55m left` and
        `11 unestimated` are caveats about the ESTIMATE rather than about
        progress, and running all three together on one line — which is what
        this used to be — made a person read them as one quantity.

        The old card's other consolidations are still gone: no weekly-planned
        sentence, and no "All tasks complete" / "No tasks yet" fallbacks, which
        duplicated the badge and the blocked indicator below.
      */}
      {effort.total > 0 && (
        <div className="flex flex-col gap-[4px]">
          <div className="flex items-center gap-[8px]">
            <ProgressBar pct={effortPct(effort)} />
            <span className="text-meta text-muted tabular-nums flex-none">
              {effortCount(effort)}
            </span>
          </div>
          {caption && <p className="text-meta text-muted tabular-nums">{caption}</p>}
        </div>
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

      {(badge || blocked > 0 || life != null) && (
        <div className="flex flex-wrap items-center gap-[5px]">
          {badge && (
            <span
              title={badge.hint}
              className={`text-badge font-semibold px-[7px] py-[2px] rounded-full ${BADGE_TONE[badge.tone]}`}
            >
              {badge.label}
            </span>
          )}
          {life && <span className="text-meta text-muted whitespace-nowrap">{life.title}</span>}
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
  lives,
  onSetLife,
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
  lives: Life[];
  onSetLife: (goalId: string, lifeId: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: goal.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? undefined : transition,
    opacity: isDragging ? 0.35 : dimmed ? 0.32 : undefined,
  };

  const currentCol = goal.column ?? 0;
  const life = lifeOf(goal, lives);

  // Action buttons live inside the drag activator, so each swallows the pointer
  // (no drag) and the click (no drawer-open) before running its own handler.
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
      <CardFace goal={goal} today={today} suppressDateBadge life={life} />

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
      {/*
        The overflow, revealed on hover, holding what the card body cannot do:
        rename it, re-date it, move it, and delete it.

        Wrapped rather than handed handlers: `Popover` renders its own trigger,
        so there is nowhere to hang `onPointerDown`. The wrapper catches the
        pointer before dnd-kit's listeners on the card root see it, and the
        click before the card's own open-the-goal handler does — the same job
        `act` and `stopPointer` did for the buttons this replaces.

        The above/below flip that used to live here as `MENU_HEIGHT_PX = 210` is
        now measured inside `Popover`, for every caller.
      */}
      <div
        className="absolute top-[7px] right-[7px]"
        onPointerDown={stopPointer}
        onClick={(e) => e.stopPropagation()}
      >
        <Popover
          label="More actions"
          role="menu"
          align="end"
          panelWidth={186}
          triggerClassName="quiet-control text-faint px-[6px] min-h-[24px] inline-flex items-center rounded-field bg-panel hover:bg-hover hover:text-ink"
          trigger={<IconDots />}
        >
          {(close) => (
            <>
              <div className="px-[12px] py-[3px] text-meta text-muted">Move to</div>
              {HORIZON_LABELS.map((label, i) => (
                <PopoverItem
                  key={label}
                  close={close}
                  disabled={i === currentCol}
                  // The card's `aria-label` already promises "Alt with arrow
                  // keys to move" to a screen reader. The hint is the same
                  // promise, made to everyone else.
                  hint={i === currentCol - 1 ? '⌥←' : i === currentCol + 1 ? '⌥→' : undefined}
                  onSelect={() => onMove(goal.id, i)}
                >
                  {label}{i === currentCol ? ' · current' : ''}
                </PopoverItem>
              ))}

              {lives.length > 0 && (
                <>
                  <PopoverSeparator />
                  <div className="px-[12px] py-[3px] text-meta text-muted">Life</div>
                  {sortedLives(lives).map((l) => (
                    <PopoverItem
                      key={l.id}
                      close={close}
                      disabled={l.id === life?.id}
                      onSelect={() => onSetLife(goal.id, l.id)}
                    >
                      {l.title}{l.id === life?.id ? ' · current' : ''}
                    </PopoverItem>
                  ))}
                  <PopoverItem close={close} disabled={life === null} onSelect={() => onSetLife(goal.id, null)}>
                    None
                  </PopoverItem>
                </>
              )}

              <PopoverSeparator />
              <PopoverItem close={close} tone="danger" onSelect={() => onDelete(goal.id)}>
                Delete goal
              </PopoverItem>
            </>
          )}
        </Popover>
      </div>
    </div>
  );
}
