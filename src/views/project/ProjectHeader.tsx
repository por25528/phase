import { useEffect, useState } from 'react';
import { useAppStore } from '../../state/store';
import type { Goal } from '../../db/types';
import { HeaderMenu, HeaderMenuItem } from '../../components/HeaderMenu';
import { IconCheck, IconRotate } from '../../components/Icons';
import { InlineEdit } from '../../components/InlineEdit';
import { goalPct } from '../../lib/pct';
import { fmtD } from '../../lib/dates';
import { fmtMinutes, goalEffort } from '../../lib/effort';
import { GoalMetaPopover } from './GoalMetaPopover';

// ── Header ────────────────────────────────────────────────────────────────────
/**
 * One compact line: the title, then the deadline and remaining effort.
 *
 * What this replaced led with a display-serif title, two date fields, Confirm,
 * Clear dates, a days-left chip, a large percentage, a page-wide progress bar,
 * a basis note, a pace sentence, a weekly count, the next task, a calibration
 * note and a completion card — roughly 150–190 vertical pixels of status
 * explanation before the first task row. On a 13-inch laptop the work tree,
 * which is the object people came to manipulate, started below the fold.
 *
 * The rule now is that the header answers three questions and no others: can
 * this still be finished (health), by when (deadline), and how much is left
 * (effort). Everything else moved one click away into `GoalMetaPopover`, and
 * the lifecycle actions into the overflow menu.
 */
export function ProjectHeader({
  goal: g,
  actions,
  backLabel,
  onBack,
}: {
  goal: Goal;
  actions: ReturnType<typeof useAppStore>['actions'];
  backLabel: string;
  onBack: () => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(g.start ?? '');
  const [draftDeadline, setDraftDeadline] = useState(g.deadline ?? '');
  useEffect(() => {
    setDraftStart(g.start ?? '');
    setDraftDeadline(g.deadline ?? '');
  }, [g.id, g.start, g.deadline]);

  const pct = Math.round(goalPct(g));
  const effort = goalEffort(g);
  const isCompleted = !!g.completedAt;

  return (
    <div className="flex items-center gap-[10px] py-[8px] min-h-[48px]">
      {/* The breadcrumb rides ON the header line rather than above it. As its
          own row it cost 24px of the budget to say one word. */}
      <button
        type="button"
        onClick={onBack}
        aria-label={`Back to ${backLabel}`}
        className="flex-none text-meta text-muted hover:text-ink px-[6px] py-[4px] -ml-[6px] min-h-[24px] inline-flex items-center gap-[5px] rounded-[6px] hover:bg-hover"
      >
        <span aria-hidden="true">‹</span> {backLabel}
      </button>

      <h1 className="m-0 min-w-0 flex-1">
        {editingTitle ? (
          <InlineEdit
            value={g.title}
            className="text-h2 font-semibold tracking-[-0.01em]"
            onCommit={(v) => { actions.renameGoal(g.id, v); setEditingTitle(false); }}
            onCancel={() => setEditingTitle(false)}
          />
        ) : (
          // `line-clamp-2`: the title is the one user string here with no
          // bound. It cannot overflow horizontally, but it wrapped without
          // limit, so a pasted paragraph pushed the whole tab strip off-screen.
          <button
            type="button"
            className="text-h2 font-semibold tracking-[-0.01em] cursor-text hover:text-ink-hover w-fit text-left rounded-[6px] line-clamp-2"
            onClick={() => setEditingTitle(true)}
            aria-label={`Rename goal "${g.title}"`}
            title="Click to rename"
          >
            {g.title}
          </button>
        )}
      </h1>

      <div className="relative flex-none flex items-center gap-[4px]">
        {/* The status cluster IS the overview. One control, because health,
            deadline and remaining effort are one thought — and because a row of
            separate chips is how the old header started. */}
        <button
          type="button"
          aria-expanded={metaOpen}
          aria-haspopup="dialog"
          aria-label="Goal status and dates"
          onClick={() => setMetaOpen((was) => !was)}
          className="flex items-center gap-[6px] max-w-[420px] px-[8px] py-[5px] rounded-field text-meta tabular-nums hover:bg-hover"
        >
          {/* A verdict pill used to lead this chain — "On track", "At risk" —
              and it went with `goalHealth`, which priced the work remaining
              against the free hours before the deadline. The deadline itself
              is the fact that survives, so it takes the front of the row and
              loses the leading separator it wore behind the pill. */}
          {g.deadline && (
            <span className="text-muted whitespace-nowrap">Due {fmtD(g.deadline)}</span>
          )}
          {/* Silent when nothing has been estimated: `0m left` is the absence
              of a measurement wearing the clothes of one, and on a goal with
              four unestimated tasks it read as "no work left". */}
          {effort.total > 0 && !isCompleted && (effort.done === effort.total || effort.remainingMin > 0) && (
            <span className="text-muted whitespace-nowrap hidden sm:inline">
              · {effort.done === effort.total
                ? 'every task done'
                : `${fmtMinutes(effort.remainingMin)} left`}
            </span>
          )}
          {/* The percentage keeps its place, at the size of the metadata it is.
              A 40px numeral over a page-wide bar claimed to be the goal's
              primary object; it is a compact secondary read of a figure that
              can change basis underneath it. */}
          {effort.total > 0 && <span className="text-muted whitespace-nowrap">· {pct}%</span>}
        </button>

        {metaOpen && (
          <GoalMetaPopover
            goal={g}
            actions={actions}
            effort={effort}
            draftStart={draftStart}
            draftDeadline={draftDeadline}
            onDraftChange={(start, deadline) => { setDraftStart(start); setDraftDeadline(deadline); }}
            onClose={() => setMetaOpen(false)}
          />
        )}

        {/* Lifecycle. A completed goal used to get a permanent bordered card in
            the header and a ready-to-complete one a permanent accent button —
            the rarest actions on the page given the loudest treatment on it. */}
        <HeaderMenu open={menuOpen} onOpenChange={setMenuOpen} label="Goal actions">
          {isCompleted ? (
            <HeaderMenuItem onClick={() => actions.reopenGoal(g.id)}>
              <IconRotate />
              Reopen goal
            </HeaderMenuItem>
          ) : (
            <HeaderMenuItem onClick={() => actions.completeGoal(g.id)}>
              <IconCheck />
              Complete goal
            </HeaderMenuItem>
          )}
        </HeaderMenu>
      </div>

      {/* A completed goal reads as completed through its frozen tree and its
          menu offering Reopen; the date itself is not worth a card, but it is
          worth saying to a screen reader. */}
      {isCompleted && <span className="sr-only">Completed {fmtD(g.completedAt!)}</span>}
    </div>
  );
}
