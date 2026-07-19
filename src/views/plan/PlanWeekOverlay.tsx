import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { BehindChip } from '../../components/BehindChip';
import { getState, useAppStore } from '../../state/store';
import { todayStr, addDays, fmtD } from '../../lib/dates';
import { goalPct } from '../../lib/pct';
import { behindPaceBy } from '../../lib/timeline';
import {
  weekOf, plannedLeaves, attentionRank, paceStatus, weekRecap, planOpeningStep,
  PACE_THRESHOLD_PTS,
} from '../../lib/plan';
import { PlanGoalTree } from './PlanGoalTree';
import type { Goal } from '../../db/types';

const DAY_CHIPS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const SOFT_CAPACITY = 7;

export function PlanWeekOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { planReview, actions } = useAppStore();
  const [step, setStep] = useState<'recap' | 'plan'>('plan');

  useEffect(() => {
    if (open) {
      actions.ensureWeekRollover();
      setStep(planOpeningStep(getState().planReview));
    }
    // Read review state only when opening: finishing recap mid-session must
    // not bounce back. getState() observes the synchronous rollover write.
  }, [open, actions]);

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
        <PlanStep onClose={onClose} />
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

// ── Step 2: plan ──────────────────────────────────────────────────────────────

function PlanStep({ onClose }: { onClose: () => void }) {
  const { goals, actions } = useAppStore();
  const today = todayStr();
  const week = weekOf(today);
  const ranked = attentionRank(goals, today);
  const pool = plannedLeaves(goals, week);
  const openCount = pool.filter((l) => !l.done).length;

  return (
    <div className="flex flex-col gap-[16px]">
      <p className="text-[.82rem] text-muted leading-[1.5]">
        Pick the steps you'll focus on this week — hit <span className="text-ink-soft font-medium">+ Plan</span> on the
        left to commit one. It moves to <span className="text-ink-soft font-medium">Your week</span>, where you can
        pin it to a day if you want.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-[22px]">
      {/* Left: what needs attention */}
      <div className="min-w-0">
        <h3 className="font-mono text-[.62rem] tracking-[.1em] uppercase text-muted font-semibold mb-[8px]">
          What needs attention
        </h3>
        {ranked.length === 0 && (
          <div className="text-faint text-[.85rem] italic">Nothing to plan — add a goal on the board first.</div>
        )}
        {ranked.map((g) => {
          const pct = Math.round(goalPct(g));
          const behind = Math.round(behindPaceBy(pct, g.start, g.deadline, today));
          const pace = paceStatus(g, today);
          return (
            <div key={g.id} className="mb-[12px] pb-[10px] border-b border-line-soft last:border-b-0">
              <div className="flex items-baseline gap-[8px] mb-[4px]">
                <span className="font-disp text-[.94rem] font-semibold flex-1 min-w-0 truncate">{g.title}</span>
                {pace === 'behind' && behind >= PACE_THRESHOLD_PTS && <BehindChip pts={behind} className="flex-none" />}
                {pace === 'needs-breakdown' && (
                  <span className="text-[.68rem] text-muted italic flex-none">define next step</span>
                )}
                <span className="font-mono text-[.66rem] text-ink-soft tabular-nums flex-none">{pct}%</span>
              </div>
              <PlanGoalTreeLazy goal={g} week={week} today={today} actions={actions} />
            </div>
          );
        })}
      </div>

      {/* Right: your week */}
      <div className="min-w-0">
        <h3 className="font-mono text-[.62rem] tracking-[.1em] uppercase text-muted font-semibold mb-[8px]">
          Your week · {fmtD(week)} – {fmtD(addDays(week, 6))}
        </h3>
        <div className="text-[.8rem] text-muted mb-[8px] tabular-nums">
          {openCount} focus step{openCount === 1 ? '' : 's'} planned
          {openCount > SOFT_CAPACITY && <span className="text-warn"> · that's a big week</span>}
        </div>
        {pool.length === 0 ? (
          <div className="text-faint text-[.85rem] italic">Click <span className="not-italic">+ Plan</span> on a step at left to commit it to this week.</div>
        ) : (
          <div className="text-[.7rem] text-faint mb-[6px]">Tap a weekday to pin a step to it — optional.</div>
        )}
        {pool.map((l) => (
          <div
            key={l.nodeId}
            className={`flex items-center gap-[8px] py-[6px] border-b border-line-soft last:border-b-0 ${
              l.done ? 'opacity-50' : ''
            }`}
          >
            <span className={`flex-1 min-w-0 truncate text-[.86rem] ${l.done ? 'line-through text-muted' : ''}`}>
              {l.title}
            </span>
            <span className="text-[.7rem] text-muted truncate max-w-[90px]">{l.goalTitle}</span>
            <span className="flex gap-[2px]" aria-label={`Pin "${l.title}" to a day`}>
              {DAY_CHIPS.map((c, i) => {
                const day = addDays(week, i);
                const pinned = l.plannedDay === day;
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={pinned}
                    aria-label={`Pin to ${fmtD(day)}`}
                    onClick={() =>
                      pinned
                        ? actions.planNode(l.goalId, l.nodeId, week)
                        : actions.planNode(l.goalId, l.nodeId, week, day)
                    }
                    className={`w-[18px] h-[18px] rounded-[5px] text-[.6rem] font-mono grid place-items-center border ${
                      pinned
                        ? 'bg-accent text-accent-contrast border-accent'
                        : 'text-muted border-line-2 hover:bg-hover'
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </span>
            <button
              type="button"
              aria-label={`Remove "${l.title}" from this week`}
              onClick={() => actions.unplanNode(l.goalId, l.nodeId)}
              className="text-faint text-[.78rem] px-[3px] hover:text-ink"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      </div>

      <div className="flex justify-end pt-[6px] border-t border-line-soft">
        <button
          type="button"
          onClick={onClose}
          className="px-[16px] py-[8px] rounded-field bg-ink text-paper text-[.84rem] font-semibold hover:bg-ink-hover"
        >
          Done
        </button>
      </div>
    </div>
  );
}

// Thin adapter so PlanGoalTree stays free of store imports.
function PlanGoalTreeLazy({
  goal, week, today, actions,
}: {
  goal: Goal; week: string; today: string;
  actions: ReturnType<typeof useAppStore>['actions'];
}) {
  return (
    <PlanGoalTree
      goal={goal}
      week={week}
      today={today}
      onPlan={(nodeId) => actions.planNode(goal.id, nodeId, week)}
      onUnplan={(nodeId) => actions.unplanNode(goal.id, nodeId)}
    />
  );
}
