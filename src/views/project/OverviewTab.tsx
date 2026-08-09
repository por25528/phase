import type { Goal } from '../../db/types';
import { useAppStore } from '../../state/store';
import { ProgressBar } from '../../components/ProgressBar';
import { IconCircle, IconDiamond, IconWarning } from '../../components/Icons';
import { goalOverview, overviewIsEmpty } from '../../lib/overview';
import { fmtMinutes } from '../../lib/effort';
import { formatEstimateValue } from '../../lib/estimateInput';
import { fmtD, todayStr } from '../../lib/dates';
import { goalPct } from '../../lib/pct';

/**
 * The goal's first answer: what next, how much is left, what is coming.
 *
 * Three short lists and one bar. The temptation on a tab like this is a grid of
 * cards — velocity, burndown, a streak, a pie of statuses — and every one of
 * them would be a number the user cannot act on, on the screen they opened to
 * decide what to do in the next hour.
 *
 * It writes nothing and stores nothing. Clicking a row selects that task in the
 * tree, which is a jump to the Tasks tab, not a second place to edit it.
 */
export function OverviewTab({ goal: g }: { goal: Goal }) {
  const { actions } = useAppStore();
  const o = goalOverview(g, todayStr());

  // An empty goal is served by the Tasks tab's own "break this down" offer.
  // Three empty sections over a 0% bar would say less than one sentence does.
  if (overviewIsEmpty(o)) {
    return (
      <p className="text-ui text-muted px-[6px]">
        Nothing here yet — add the first tasks on the Tasks tab.
      </p>
    );
  }

  const pct = Math.round(goalPct(g));

  return (
    <div className="max-w-[620px] flex flex-col gap-[22px]">
      <section>
        <h3 className="m-0 text-meta font-semibold text-muted mb-[6px]">Next</h3>
        {o.next.length === 0 ? (
          <p className="m-0 text-ui text-muted px-[6px]">
            {o.blocked > 0
              ? 'Every open task is blocked — clear a blocker to carry on.'
              : 'Every task is done.'}
          </p>
        ) : (
          <div className="-mx-[6px]">
            {o.next.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => actions.openProject(g.id, item.id)}
                className="w-full flex items-baseline gap-[8px] px-[6px] py-[5px] rounded-[6px] text-left hover:bg-hover"
              >
                <span className={`flex-none inline-flex self-center ${item.started ? 'text-accent' : 'text-faint'}`}>
                  <IconCircle size={13} />
                </span>
                <span className="flex-1 min-w-0 truncate text-ui text-ink-soft">{item.title}</span>
                {item.parentTitle && (
                  <span className="flex-none text-meta text-faint hidden sm:inline truncate max-w-[160px]">
                    {item.parentTitle}
                  </span>
                )}
                {/* No estimate means no number. `0m` on an unestimated task is a
                    measurement nobody took. */}
                {item.estimateMin !== undefined && (
                  <span className="flex-none text-meta text-muted tabular-nums">
                    {formatEstimateValue(item.estimateMin)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="m-0 text-meta font-semibold text-muted mb-[6px]">Progress</h3>
        <div className="flex items-center gap-[10px] px-[6px]">
          <ProgressBar pct={pct} />
          <span className="flex-none text-ui text-ink-soft tabular-nums">
            {o.effort.done} / {o.effort.total}
          </span>
        </div>
        {/* Remaining effort, with its own caveat attached. A floor stated as a
            total is the dishonesty `GoalEffort.unestimated` exists to prevent. */}
        <p className="m-0 mt-[6px] px-[6px] text-meta text-muted">
          {o.effort.remainingMin > 0 && (
            <span className="tabular-nums">{fmtMinutes(o.effort.remainingMin)} left</span>
          )}
          {o.effort.remainingMin > 0 && o.effort.unestimated > 0 && ' · '}
          {o.effort.unestimated > 0 && (
            <>
              {o.effort.unestimated} unestimated
              {o.effort.remainingMin > 0 && ', so that figure will grow'}
            </>
          )}
        </p>
        {o.blocked > 0 && (
          <p className="m-0 mt-[4px] px-[6px] text-meta text-warn inline-flex items-center gap-[5px]">
            <IconWarning size={12} />
            {o.blocked} blocked
          </p>
        )}
      </section>

      {o.upcoming.length > 0 && (
        <section>
          <h3 className="m-0 text-meta font-semibold text-muted mb-[6px]">Upcoming</h3>
          <div className="-mx-[6px]">
            {o.upcoming.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => actions.openProject(g.id, m.id)}
                className="w-full flex items-center gap-[8px] px-[6px] py-[5px] rounded-[6px] text-left hover:bg-hover"
              >
                <span className="flex-none inline-flex text-accent">
                  <IconDiamond size={10} />
                </span>
                <span
                  className={`flex-none w-[64px] text-meta tabular-nums ${
                    m.overdue ? 'text-warn font-semibold' : 'text-muted'
                  }`}
                >
                  {fmtD(m.date)}
                </span>
                <span className="flex-1 min-w-0 truncate text-ui text-ink-soft">{m.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
