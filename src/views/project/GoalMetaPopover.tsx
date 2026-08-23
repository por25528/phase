import { useEffect, useRef } from 'react';
import type { Goal } from '../../db/types';
import { useAppStore } from '../../state/store';
import { DateField } from '../../components/DateField';
import { IconArrowRight } from '../../components/Icons';
import { firstOpenLeaf } from '../../lib/tree';
import { goalPctBasis } from '../../lib/pct';
import { todayStr, daysLeftLabel } from '../../lib/dates';
import { weekOf } from '../../lib/plan';
import { goalWeekLoad } from '../../lib/overview';
import { projectVelocity, describeVelocity } from '../../lib/velocity';
import { projectCalibration, describeCalibration } from '../../lib/actuals';
import type { GoalEffort } from '../../lib/effort';
import { DEMANDS, DEMAND_WORD } from '../../lib/demand';
import {
  goalDateDraftIsDirty,
  needsDateConfirmation,
  projectDateError,
} from '../../lib/schedule';

/**
 * Everything the goal header used to say out loud.
 *
 * The old header spent ~150 vertical pixels explaining the model before the
 * user reached a single task: two date fields, Confirm, Clear dates, days left,
 * a page-wide progress bar, the percentage's basis, a pace sentence, the weekly
 * planned count, the next task and an estimate-calibration note — all at equal
 * weight, all on every visit. None of it is wrong. It is just answers to
 * questions nobody asks twice a day, sitting on top of the object they came to
 * manipulate.
 *
 * So it lives behind the status cluster instead. Progressive disclosure, not
 * deletion: the header still states the deadline and remaining effort, and one
 * click gets the arithmetic behind them.
 *
 * A health sentence used to open this panel — "6h of work against 4h free
 * before the deadline". It went with `goalHealth`, and the panel now opens on
 * the dates, which is what the rest of it was always about.
 */
export function GoalMetaPopover({
  goal: g,
  actions,
  effort,
  draftStart,
  draftDeadline,
  onDraftChange,
  onClose,
}: {
  goal: Goal;
  actions: ReturnType<typeof useAppStore>['actions'];
  effort: GoalEffort;
  draftStart: string;
  draftDeadline: string;
  onDraftChange: (start: string, deadline: string) => void;
  onClose: () => void;
}) {
  const { sessions } = useAppStore();
  const wrapRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // The header popover is the topmost thing on screen while it is open,
        // so it consumes Escape rather than letting it leave the goal page.
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const today = todayStr();
  const dateError = projectDateError(draftStart || undefined, draftDeadline || undefined);
  const storedDateError = projectDateError(g.start, g.deadline);
  const datesUnconfirmed = needsDateConfirmation(g);
  const basis = goalPctBasis(g);
  const wk = goalWeekLoad(g, weekOf(today));
  const next = firstOpenLeaf(g.nodes);
  const velocity = describeVelocity(projectVelocity(g, today));
  const calibration = describeCalibration(projectCalibration(g, sessions));

  /**
   * Every other edit in Phase persists immediately; the date range alone used
   * to need a "Save dates" click, which produced exactly the "did that save?"
   * moment the product should never have. A pair that doesn't validate yet
   * (start after deadline, half-typed) stays in the draft and shows its error
   * rather than being written.
   */
  function commitDates(nextStart: string, nextDeadline: string): void {
    onDraftChange(nextStart, nextDeadline);
    if (projectDateError(nextStart || undefined, nextDeadline || undefined)) return;
    if (!goalDateDraftIsDirty(g, nextStart, nextDeadline)) return;
    actions.setGoalDates(g.id, nextStart || undefined, nextDeadline || undefined);
  }

  return (
    <div
      ref={wrapRef}
      role="dialog"
      aria-label="Goal status"
      className="absolute right-0 top-[34px] z-40 w-[320px] bg-panel border border-line-2 rounded-card shadow-card p-[14px] text-left"
    >
      <div className="pt-[2px]">
        <div className="text-meta font-[550] text-muted mb-[6px]">Dates</div>
        <div className="flex flex-wrap items-center gap-[6px]">
          <DateField
            inputRef={startRef}
            value={draftStart}
            ariaLabel="Start date"
            placeholder="Start"
            onCommit={(next) => commitDates(next, draftDeadline)}
          />
          <span className="text-muted inline-flex" aria-hidden="true"><IconArrowRight size={13} /></span>
          <DateField
            value={draftDeadline}
            ariaLabel="Deadline"
            placeholder="Deadline"
            onCommit={(next) => commitDates(draftStart, next)}
          />
          {g.deadline && (
            <span className="text-meta text-muted tabular-nums">{daysLeftLabel(g.deadline)}</span>
          )}
        </div>
        {dateError && <p className="mt-[5px] text-meta text-warn" role="alert">{dateError}</p>}
        <div className="mt-[7px] flex flex-wrap items-center gap-[4px]">
          {datesUnconfirmed && (
            <button
              type="button"
              disabled={storedDateError !== null}
              title={storedDateError ?? undefined}
              onClick={() => {
                actions.confirmGoalDates(g.id);
                requestAnimationFrame(() => startRef.current?.focus());
              }}
              className="text-meta font-semibold text-warn px-[7px] py-[3px] rounded-field hover:bg-warn-tint disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Confirm these dates
            </button>
          )}
          {(g.start || g.deadline || draftStart || draftDeadline) && (
            <button
              type="button"
              onClick={() => {
                onDraftChange('', '');
                actions.setGoalDates(g.id, undefined, undefined);
                requestAnimationFrame(() => startRef.current?.focus());
              }}
              className="text-meta font-medium text-muted px-[7px] min-h-[24px] inline-flex items-center rounded-field hover:bg-hover hover:text-ink"
            >
              Clear dates
            </button>
          )}
        </div>
      </div>

      {/* Focus needed — an INLINE segmented control, never a nested Popover.
          This dialog registers its own capture-phase Escape listener on window
          (above); a Popover inside it would register a second one on the same
          node, capture listeners on one node fire in registration order, and
          this one always registers first because it opened first. One Escape
          would close both. Three values plus "Not set" do not need a
          disclosure, so the fix is to have no second popover at all.

          Withheld on a completed goal, like every other editor that writes to
          a frozen project — the header gated this and the gate has to travel
          with the control. */}
      {!g.completedAt && (
        <div className="mt-[12px] pt-[12px] border-t border-line">
          <div className="text-meta font-[550] text-muted mb-[6px]">Focus needed</div>
          <div role="radiogroup" aria-label="Focus needed" className="flex flex-wrap gap-[4px]">
            {DEMANDS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={g.demand === d}
                onClick={() => actions.setGoalDemand(g.id, d)}
                className={`text-meta px-[8px] min-h-[24px] inline-flex items-center rounded-field ${
                  g.demand === d
                    ? 'bg-accent-tint text-accent-deep font-semibold'
                    : 'text-muted hover:bg-hover hover:text-ink'
                }`}
              >
                {DEMAND_WORD[d]}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={g.demand === undefined}
              onClick={() => actions.setGoalDemand(g.id, null)}
              className={`text-meta px-[8px] min-h-[24px] inline-flex items-center rounded-field ${
                g.demand === undefined
                  ? 'bg-accent-tint text-accent-deep font-semibold'
                  : 'text-muted hover:bg-hover hover:text-ink'
              }`}
            >
              Not set
            </button>
          </div>
        </div>
      )}

      <dl className="mt-[12px] pt-[12px] border-t border-line grid grid-cols-[auto_1fr] gap-x-[12px] gap-y-[5px] text-meta">
        <dt className="text-muted">Progress</dt>
        <dd className="text-ink-soft tabular-nums m-0">
          {effort.done}/{effort.total} tasks
          {effort.total > 0 && (basis === 'weighted' ? ', weighted by estimate' : ', each counting equally')}
        </dd>
        {wk.total > 0 && (
          <>
            <dt className="text-muted">This week</dt>
            <dd className="text-ink-soft tabular-nums m-0">{wk.done}/{wk.total} planned</dd>
          </>
        )}
        {next && !g.completedAt && (
          <>
            <dt className="text-muted">Next</dt>
            <dd className="text-ink-soft m-0 truncate">{next.title}</dd>
          </>
        )}
        {velocity && (
          <>
            <dt className="text-muted">Pace</dt>
            <dd className="text-ink-soft m-0">{velocity}</dd>
          </>
        )}
        {calibration && (
          <>
            <dt className="text-muted">Estimates</dt>
            <dd
              className="text-ink-soft m-0"
              title="Based on time you logged against completed tasks in this goal. Your estimates are never changed automatically."
            >
              {calibration}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
