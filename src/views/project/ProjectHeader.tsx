import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../state/store';
import type { Goal } from '../../db/types';
import { DateField } from '../../components/DateField';
import { ProgressBar } from '../../components/ProgressBar';
import { InlineEdit } from '../../components/InlineEdit';
import { firstOpenLeaf } from '../../lib/tree';
import { goalPct, goalPctBasis } from '../../lib/pct';
import { leafCount } from '../../lib/board';
import { expectedPct, behindPaceBy } from '../../lib/timeline';
import { todayStr, daysLeftLabel, fmtD } from '../../lib/dates';
import { plannedLeaves, weekOf, paceStatus } from '../../lib/plan';
import { projectVelocity, describeVelocity } from '../../lib/velocity';
import { projectCalibration, describeCalibration } from '../../lib/actuals';
import {
  goalDateDraftIsDirty,
  hasTrustedSchedule,
  needsDateConfirmation,
  projectDateError,
} from '../../lib/schedule';

function Dot() {
  return <span className="text-faint-2" aria-hidden="true">·</span>;
}

// ── Header ────────────────────────────────────────────────────────────────────
// Title, dates, and the progress strip — the always-visible summary that anchors
// the window while the body below scrolls.
export function ProjectHeader({
  goal: g,
  actions,
}: {
  goal: Goal;
  actions: ReturnType<typeof useAppStore>['actions'];
}) {
  const { sessions } = useAppStore();
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftStart, setDraftStart] = useState(g.start ?? '');
  const [draftDeadline, setDraftDeadline] = useState(g.deadline ?? '');
  const startDateRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDraftStart(g.start ?? '');
    setDraftDeadline(g.deadline ?? '');
  }, [g.id, g.start, g.deadline]);

  const today = todayStr();
  const pct = Math.round(goalPct(g));
  const basis = goalPctBasis(g);
  const { total, done } = leafCount(g.nodes);
  const trustedSchedule = hasTrustedSchedule(g);
  const datesUnconfirmed = needsDateConfirmation(g);
  const dateError = projectDateError(draftStart || undefined, draftDeadline || undefined);
  const storedDateError = projectDateError(g.start, g.deadline);

  /**
   * Every other edit in Phase persists immediately; the date range alone used
   * to need a "Save dates" click, which produced exactly the "did that save?"
   * moment the product should never have. A pair that doesn't validate yet
   * (start after deadline, half-typed) stays in the draft and shows its error
   * rather than being written.
   */
  function commitDates(nextStart: string, nextDeadline: string): void {
    setDraftStart(nextStart);
    setDraftDeadline(nextDeadline);
    if (projectDateError(nextStart || undefined, nextDeadline || undefined)) return;
    if (!goalDateDraftIsDirty(g, nextStart, nextDeadline)) return;
    actions.setGoalDates(g.id, nextStart || undefined, nextDeadline || undefined);
  }
  const expected = trustedSchedule
    ? Math.round(expectedPct(g.start, g.deadline, today))
    : 0;
  const behind = trustedSchedule
    ? Math.round(behindPaceBy(pct, g.start, g.deadline, today))
    : 0;
  const pace = paceStatus(g, today);
  const wk = plannedLeaves([g], weekOf(today));
  const wkDone = wk.filter((l) => l.done).length;
  const next = firstOpenLeaf(g.nodes);
  const isCompleted = !!g.completedAt;

  /*
   * A project with no confirmed start AND deadline cannot have a pace — but it
   * can still be moving or stalled, and `doneAt` has always known which.
   * "No project schedule" was the app's best information design replaced by a
   * statement of its own inapplicability, on exactly the work where progress is
   * hardest to judge unaided.
   */
  const velocityLine = trustedSchedule
    ? null
    : describeVelocity(projectVelocity(g, today));

  const paceLine =
    pace === 'complete'
      ? 'every step done — ready to complete'
      : datesUnconfirmed
        ? 'Dates unconfirmed'
        : !trustedSchedule
          // Falls back to the old wording only when there is genuinely nothing
          // to report — a project with no steps at all.
          ? (velocityLine ?? 'no steps yet — add one to start tracking progress')
          : pace === 'behind'
            ? `${behind} pts behind pace · expected ${expected}% by today`
            : pace === 'needs-breakdown'
              ? `define next step · expected ${expected}% by today`
              : `on pace · expected ${expected}% by today`;

  /*
   * How this project's past estimates compared to the time actually logged
   * against them. Read-only and advisory: it sits BESIDE the user's numbers and
   * never rewrites one. Silent until there is enough completed, timed history
   * to mean anything (see MIN_CALIBRATION_SAMPLES).
   */
  const calibration = describeCalibration(projectCalibration(g, sessions));

  return (
    <div className="pt-[10px] pb-[4px]">
      {/* Title + dates (right padding leaves room for the ✕) */}
      <div className="pr-[40px]">
        <h1 className="m-0">
          {editingTitle ? (
            <InlineEdit
              value={g.title}
              className="font-disp text-h1 font-semibold tracking-[-0.01em]"
              onCommit={(v) => { actions.renameGoal(g.id, v); setEditingTitle(false); }}
              onCancel={() => setEditingTitle(false)}
            />
          ) : (
            // Renaming the project was mouse-only — a div with an onClick, no
            // role, no tabIndex, no key handler — and there is no other route to
            // it anywhere in the app.
            <button
              type="button"
              className="font-disp text-h1 font-semibold tracking-[-0.01em] cursor-text hover:text-ink-hover w-fit text-left rounded-[6px]"
              onClick={() => setEditingTitle(true)}
              aria-label={`Rename project "${g.title}"`}
              title="Click to rename"
            >
              {g.title}
            </button>
          )}
        </h1>
        <div className="mt-[9px]">
          <div className="flex flex-wrap items-center gap-[6px]">
            <DateField
              inputRef={startDateRef}
              value={draftStart}
              ariaLabel="Start date"
              placeholder="Start"
              onCommit={(next) => commitDates(next, draftDeadline)}
            />
            <span className="text-ui text-muted">→</span>
            <DateField
              value={draftDeadline}
              ariaLabel="Deadline"
              placeholder="Deadline"
              onCommit={(next) => commitDates(draftStart, next)}
            />
            {datesUnconfirmed && (
              <button
                type="button"
                disabled={storedDateError !== null}
                title={storedDateError ?? undefined}
                onClick={() => {
                  actions.confirmGoalDates(g.id);
                  requestAnimationFrame(() => startDateRef.current?.focus());
                }}
                className="text-meta font-semibold text-warn px-[7px] py-[3px] rounded-[6px] hover:bg-warn-tint disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Confirm
              </button>
            )}
            {(g.start || g.deadline || draftStart || draftDeadline) && (
              <button
                type="button"
                onClick={() => {
                  setDraftStart('');
                  setDraftDeadline('');
                  actions.setGoalDates(g.id, undefined, undefined);
                  requestAnimationFrame(() => startDateRef.current?.focus());
                }}
                className="text-meta font-medium text-muted px-[7px] min-h-[24px] inline-flex items-center rounded-[6px] hover:bg-hover hover:text-ink"
              >
                Clear dates
              </button>
            )}
            {g.deadline && (
              <span className="text-meta text-muted tabular-nums">{daysLeftLabel(g.deadline)}</span>
            )}
          </div>
          {dateError && (
            <p className="mt-[5px] text-meta text-warn" role="alert">
              {dateError}
            </p>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="mt-[16px] flex items-center gap-[11px]">
        <span className="font-disp text-h2 font-semibold tabular-nums min-w-[50px]">{pct}%</span>
        <ProgressBar pct={pct} />
      </div>
      <div className="mt-[7px] flex flex-wrap items-center gap-x-[10px] gap-y-[3px] text-compact text-muted tabular-nums">
        {/* The percentage's own basis, stated where the percentage is read.
            `goalPct` weights by `estimateMin` when every sibling in a set has
            one and falls back to an equal mean otherwise — so the same number
            means two different things depending on how much has been
            estimated. Which one it is has to be visible, or the figure is
            quietly ambiguous. The step count is here for the same reason: most
            people read a percentage as "fraction of steps done", and on a
            lopsided tree it is not. */}
        {total > 0 && (
          <span title={
            basis === 'weighted'
              ? 'Weighted by each step’s estimate, so a long step counts for more than a short one'
              : 'Every step counts equally — estimate them all to weight this by effort'
          }>
            {done}/{total} steps{basis === 'weighted' ? ', weighted by estimate' : ''}
          </span>
        )}
        {total > 0 && <Dot />}
        <span className={pace === 'behind' ? 'text-warn' : ''}>{paceLine}</span>
        {wk.length > 0 && (<><Dot /><span>{wkDone}/{wk.length} planned this week</span></>)}
        {next && !isCompleted && (
          <><Dot /><span className="truncate max-w-[320px] text-ink-soft">Next: {next.title}</span></>
        )}
        {calibration && (
          <>
            <Dot />
            <span title="Based on time you logged against completed steps in this project. Your estimates are never changed automatically.">
              {calibration}
            </span>
          </>
        )}
      </div>

      {/* Completion lifecycle (spec §2.5). A completed project is frozen for
          structural edits (store guards enforce it); metadata stays editable. */}
      {isCompleted ? (
        <div className="flex items-center gap-[10px] mt-[16px] px-[11px] py-[9px] rounded-card border border-line bg-hover">
          <span className="text-accent text-lead" aria-hidden="true">✓</span>
          <span className="text-ui text-ink-soft flex-1">Completed {fmtD(g.completedAt!)}</span>
          <button
            onClick={() => actions.reopenGoal(g.id)}
            className="text-ui font-semibold text-ink-soft px-[10px] py-[5px] rounded-field border border-line-2 hover:bg-panel"
          >
            Reopen project
          </button>
        </div>
      ) : pace === 'complete' ? (
        <button
          onClick={() => actions.completeGoal(g.id)}
          className="mt-[16px] text-body font-semibold text-accent-contrast bg-accent px-[15px] py-[8px] rounded-field hover:bg-accent-deep"
        >
          Complete project
        </button>
      ) : null}
    </div>
  );
}
