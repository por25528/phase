import { useState } from 'react';
import { useAppStore } from '../../state/store';
import { useLocalDate } from '../../hooks/useLocalDate';
import { CardSection } from '../../components/CardSection';
import { Tag } from '../../components/Tag';
import { TodayCheckbox } from './TodayCheckbox';
import { parseD, fmtD } from '../../lib/dates';
import { nextUp, carryOvers, plannedLeaves, weekOf } from '../../lib/plan';
import { PlanWeekOverlay } from '../plan/PlanWeekOverlay';

const DOW_SHORT = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function NextUpCard() {
  const { goals, planReview, actions } = useAppStore();
  const [planOpen, setPlanOpen] = useState(false);
  const today = useLocalDate();
  const week = weekOf(today);

  const items = nextUp(goals, today, 7);
  const stale = carryOvers(goals, today);
  const wk = plannedLeaves(goals, week);
  const wkDone = wk.filter((l) => l.done).length;
  const planned = items.filter((i) => i.tier !== 'suggested').length;
  const suggestedN = items.length - planned;
  const reviewWaiting = !!planReview && planReview.entries.length > 0 && !planReview.reviewed;

  return (
    <CardSection
      label="Next up"
      meta={
        wk.length > 0 ? (
          <span className="text-[.72rem] text-muted tabular-nums">
            {wkDone}/{wk.length} this week
          </span>
        ) : undefined
      }
      right={
        <button
          type="button"
          onClick={() => setPlanOpen(true)}
          className="px-[13px] py-[6px] rounded-field bg-ink text-paper text-[.8rem] font-semibold hover:bg-ink-hover"
        >
          {reviewWaiting ? 'Plan week ·' : 'Plan week'}
          {reviewWaiting && <span className="text-accent"> review</span>}
        </button>
      }
    >
      {goals.length === 0 && (
        <div className="text-faint text-[.85rem] italic py-[6px]">
          No goals yet — add one on the Goals board and its next steps appear here.
        </div>
      )}
      {goals.length > 0 && items.length === 0 && stale.length === 0 && (
        <div className="text-faint text-[.85rem] italic py-[6px]">
          All caught up — plan your week to line up what's next.
        </div>
      )}

      {items.map((it) => (
        <div
          key={it.nodeId}
          className="flex items-center gap-[10px] py-[8px] border-b border-line-soft last:border-b-0"
        >
          <TodayCheckbox
            checked={false}
            onToggle={() => actions.toggleLeaf(it.nodeId)}
            ariaLabel={`Complete "${it.title}"`}
          />
          <span className="flex-1 min-w-0 truncate text-[.88rem]">{it.title}</span>
          {it.tier !== 'suggested' && (
            <span className="font-mono text-[.6rem] tracking-[.06em] text-accent flex-none">
              {it.tier === 'pinned-today'
                ? 'today'
                : it.plannedDay
                  ? DOW_SHORT[parseD(it.plannedDay).getDay()]
                  : 'this week'}
            </span>
          )}
          <Tag label={it.goalTitle} />
        </div>
      ))}

      {(planned > 0 || suggestedN > 0) && (
        <div className="mt-[6px] text-[.68rem] text-faint tabular-nums">
          {planned} planned · {suggestedN} suggested
        </div>
      )}

      {stale.length > 0 && (
        <div className="mt-[10px]">
          <div className="font-mono text-[.62rem] tracking-[.1em] uppercase text-warn font-semibold mb-[4px]">
            Needs a decision
          </div>
          {stale.map((l) => (
            <div
              key={l.nodeId}
              className="flex items-center gap-[8px] py-[6px] border-b border-line-soft last:border-b-0"
            >
              <span className="flex-1 min-w-0 truncate text-[.84rem] text-ink-soft">{l.title}</span>
              <span className="text-[.66rem] text-warn bg-warn-tint px-[6px] py-[1px] rounded-full flex-none">
                wk of {fmtD(l.plannedWeek)}
              </span>
              <button
                type="button"
                onClick={() => actions.planNode(l.goalId, l.nodeId, week)}
                className="text-[.7rem] font-semibold text-accent hover:text-accent-deep px-[3px]"
              >
                Replan
              </button>
              <button
                type="button"
                onClick={() => actions.openDrawer(l.goalId, l.nodeId)}
                className="text-[.7rem] font-semibold text-ink-soft hover:text-ink px-[3px]"
              >
                Break down
              </button>
              <button
                type="button"
                onClick={() => actions.unplanNode(l.goalId, l.nodeId)}
                className="text-[.7rem] font-semibold text-muted hover:text-ink px-[3px]"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <PlanWeekOverlay open={planOpen} onClose={() => setPlanOpen(false)} />
    </CardSection>
  );
}
