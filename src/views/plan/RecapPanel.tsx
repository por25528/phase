import { useAppStore } from '../../state/store';
import { weekRecap, loggedTimeForWeek, formatLoggedMinutes } from '../../lib/plan';
import { weekEffort, type WeekEffort } from '../../lib/actuals';
import { weekDates } from '../../lib/dates';

/**
 * The overrun, in words, or nothing when the week landed close enough that
 * naming a ratio would be noise. Same 15% dead band as `describeCalibration`,
 * for the same reason: a figure that fires on every week trains the reader to
 * skip the line.
 */
function describeWeekRatio(effort: WeekEffort): string {
  const ratio = effort.loggedMin / effort.estimatedMin;
  if (ratio >= 1.15) return ` — ${ratio.toFixed(1)}× longer than planned.`;
  if (ratio <= 0.85) return ` — quicker than planned.`;
  return ' — about as planned.';
}

/**
 * Last week's recap, inline and dismissible.
 *
 * The old planner made this a gate you passed through before you could plan.
 * It is a panel now: reviewing last week is worth prompting, not worth
 * blocking this week's planning behind.
 */
export function RecapPanel() {
  const { goals, tasks, sessions, planReview, actions } = useAppStore();
  if (!planReview || planReview.reviewed || planReview.entries.length === 0) return null;

  const r = weekRecap(planReview, goals);
  const logged = loggedTimeForWeek(sessions, planReview.week);
  // What the week was estimated to cost, against what it actually took. Only
  // computed over work that was genuinely timed, so it stays silent rather
  // than reporting a flattering comparison against an empty ledger.
  const effort = weekEffort(goals, tasks, sessions, weekDates(planReview.week));

  return (
    <section className="mb-[14px] p-[12px] rounded-card border border-line-2 bg-panel">
      <div className="flex flex-col gap-[14px]">
        <p className="text-title text-ink">
          <span className="font-disp text-h2 font-semibold tabular-nums">
            {r.nowComplete.length} of {r.planned}
          </span>{' '}
          of last week's commitments are now complete.
          {logged.sessions > 0 && (
            <span className="text-muted">
              {' '}You logged{' '}
              <span className="font-semibold text-ink-soft">{formatLoggedMinutes(logged.minutes)}</span>
              {' '}across {logged.sessions} session{logged.sessions === 1 ? '' : 's'}.
            </span>
          )}
        </p>

        {/* Estimated against actual, for the work that was actually timed.
            Shown only when both sides exist: a comparison against an empty
            ledger would read as "you were spot on" for work nobody measured.
            This is a REPORT, never a correction — no estimate is rewritten
            from it. */}
        {effort.estimatedMin > 0 && effort.loggedMin > 0 && (
          <p className="text-ui text-muted tabular-nums">
            Timed work was estimated at{' '}
            <span className="font-semibold text-ink-soft">{formatLoggedMinutes(effort.estimatedMin)}</span>
            {' '}and took{' '}
            <span className="font-semibold text-ink-soft">{formatLoggedMinutes(effort.loggedMin)}</span>
            {describeWeekRatio(effort)}
          </p>
        )}

        {r.nowComplete.length > 0 && (
          <section>
            <h3 className="font-mono text-kbd tracking-[.1em] uppercase text-muted font-semibold mb-[4px]">Done</h3>
            {r.nowComplete.map((e) => (
              <div key={e.nodeId} className="flex items-center gap-[8px] py-[4px] text-body">
                <span className="text-accent">✓</span>
                <span className="flex-1 min-w-0 truncate">{e.leafTitle}</span>
                <span className="text-meta text-muted truncate">{e.goalTitle}</span>
              </div>
            ))}
          </section>
        )}

        {r.unfinished.length > 0 && (
          <section>
            <h3 className="font-mono text-kbd tracking-[.1em] uppercase text-warn font-semibold mb-[4px]">
              Unfinished — decide
            </h3>
            {r.unfinished.map((e) => (
              <div key={e.nodeId} className="flex items-center gap-[8px] py-[4px] text-body">
                <span className="flex-1 min-w-0 truncate">{e.leafTitle}</span>
                <span className="text-meta text-muted truncate">{e.goalTitle}</span>
                <button
                  type="button"
                  onClick={() => actions.replanNode(e.goalId, e.nodeId)}
                  className="text-meta font-semibold text-accent hover:text-accent-deep px-[4px]"
                >
                  Replan
                </button>
                <button
                  type="button"
                  onClick={() => {
                    actions.openDrawer(e.goalId, e.nodeId);
                  }}
                  className="text-meta font-semibold text-ink-soft hover:text-ink px-[4px]"
                >
                  Break down
                </button>
                <button
                  type="button"
                  onClick={() => actions.unscheduleNode(e.goalId, e.nodeId)}
                  className="text-meta font-semibold text-muted hover:text-ink px-[4px]"
                >
                  Remove
                </button>
              </div>
            ))}
          </section>
        )}

        {r.removed.length > 0 && (
          <section>
            <h3 className="font-mono text-kbd tracking-[.1em] uppercase text-muted font-semibold mb-[4px]">Removed</h3>
            {r.removed.map((e) => (
              <div key={e.nodeId} className="py-[3px] text-body text-muted line-through">
                {e.leafTitle} <span className="no-underline text-meta">· {e.goalTitle}</span>
              </div>
            ))}
          </section>
        )}
      </div>

      <div className="flex items-center gap-[12px] mt-[10px] pt-[10px] border-t border-line-soft">
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => actions.markWeekReviewed()}
          className="px-[14px] py-[6px] rounded-field bg-ink text-paper text-body font-semibold hover:bg-ink-hover"
        >
          Done
        </button>
      </div>
    </section>
  );
}
