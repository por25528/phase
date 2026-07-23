import { useState } from 'react';
import { CardSection } from '../../components/CardSection';
import { Tag } from '../../components/Tag';
import type { DailyWorkItem } from '../../lib/dailyWork';
import { buildDailyWork } from '../../lib/dailyWork';
import { addDays, fmtD } from '../../lib/dates';
import { plannedLeaves, weekOf } from '../../lib/plan';
import { isValidLocalDate } from '../../lib/schedule';
import { useLocalDate } from '../../hooks/useLocalDate';
import { useAppStore } from '../../state/store';
import { PlanWeekOverlay } from '../plan/PlanWeekOverlay';
import { DailyWorkRow } from './DailyWorkRow';

const decisionButtonClass = 'text-[.7rem] font-semibold px-[3px]';

export function TodayWorkCard() {
  const { goals, tasks, planReview, actions } = useAppStore();
  const [planOpen, setPlanOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [pickingTaskId, setPickingTaskId] = useState<string | null>(null);
  const today = useLocalDate();
  const week = weekOf(today);
  const sections = buildDailyWork(goals, tasks, today);
  const weeklySteps = plannedLeaves(goals, week);
  const weeklyDone = weeklySteps.filter((leaf) => leaf.done).length;
  const reviewWaiting = Boolean(
    planReview && planReview.entries.length > 0 && !planReview.reviewed,
  );

  function toggleItem(item: DailyWorkItem): void {
    if (item.kind === 'task') actions.toggleTask(item.id);
    else actions.toggleLeaf(item.id);
  }

  function reschedulePickedTask(taskId: string, date: string): void {
    if (!isValidLocalDate(date)) return;
    actions.rescheduleTask(taskId, date);
    setPickingTaskId(null);
  }

  return (
    <CardSection
      label="Today's work"
      meta={
        weeklySteps.length > 0 ? (
          <span className="text-[.72rem] text-muted tabular-nums">
            {weeklyDone}/{weeklySteps.length} this week
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
      {sections.commitments.length === 0 && (
        <div className="text-faint text-[.85rem] italic py-[6px]">
          Nothing committed for today.
        </div>
      )}
      {sections.commitments.map((item) => (
        <DailyWorkRow key={item.key} item={item} onToggle={toggleItem} />
      ))}

      {sections.carryOvers.length > 0 && (
        <div className="mt-[10px]">
          <div className="font-mono text-[.62rem] tracking-[.1em] uppercase text-warn font-semibold mb-[4px]">
            Needs a decision
          </div>
          {sections.carryOvers.map((item) => (
            <div
              key={item.key}
              className="py-[6px] border-b border-line-soft last:border-b-0"
            >
              <div className="flex items-center gap-[8px]">
                <span className="flex-1 min-w-0 truncate text-[.84rem] text-ink-soft">
                  {item.title}
                </span>
                {item.goalTitle && <Tag label={item.goalTitle} />}
                {item.kind === 'task' ? (
                  <>
                    {item.scheduledDate && (
                      <span className="text-[.66rem] text-warn bg-warn-tint px-[6px] py-[1px] rounded-full flex-none">
                        {fmtD(item.scheduledDate)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => actions.rescheduleTask(item.id, today)}
                      className={`${decisionButtonClass} text-accent hover:text-accent-deep`}
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => actions.rescheduleTask(item.id, addDays(today, 1))}
                      className={`${decisionButtonClass} text-ink-soft hover:text-ink`}
                    >
                      Tomorrow
                    </button>
                    <button
                      type="button"
                      aria-expanded={pickingTaskId === item.id}
                      onClick={() => setPickingTaskId((current) => current === item.id ? null : item.id)}
                      className={`${decisionButtonClass} text-ink-soft hover:text-ink`}
                    >
                      Pick day
                    </button>
                    <button
                      type="button"
                      onClick={() => actions.removeTask(item.id)}
                      className={`${decisionButtonClass} text-muted hover:text-ink`}
                    >
                      Delete
                    </button>
                  </>
                ) : (
                  <>
                    {item.plannedWeek && (
                      <span className="text-[.66rem] text-warn bg-warn-tint px-[6px] py-[1px] rounded-full flex-none">
                        wk of {fmtD(item.plannedWeek)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => item.goalId && actions.planNode(item.goalId, item.id, week)}
                      className={`${decisionButtonClass} text-accent hover:text-accent-deep`}
                    >
                      Replan
                    </button>
                    <button
                      type="button"
                      onClick={() => item.goalId && actions.openDrawer(item.goalId, item.id)}
                      className={`${decisionButtonClass} text-ink-soft hover:text-ink`}
                    >
                      Break down
                    </button>
                    <button
                      type="button"
                      onClick={() => item.goalId && actions.unplanNode(item.goalId, item.id)}
                      className={`${decisionButtonClass} text-muted hover:text-ink`}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
              {item.kind === 'task' && pickingTaskId === item.id && (
                <div className="mt-[6px] flex justify-end">
                  <input
                    type="date"
                    aria-label={`Pick a new date for "${item.title}"`}
                    onChange={(event) => reschedulePickedTask(item.id, event.target.value)}
                    className="bg-field border border-line-2 rounded-field px-[8px] py-[5px] text-[.76rem] text-ink outline-none focus:border-muted"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {sections.completedToday.length > 0 && (
        <div className="mt-[10px]">
          <button
            type="button"
            aria-expanded={doneOpen}
            onClick={() => setDoneOpen((open) => !open)}
            className="w-full flex items-center gap-[8px] py-[4px] text-left text-[.76rem] font-semibold text-muted hover:text-ink"
          >
            <span aria-hidden="true">{doneOpen ? '▾' : '▸'}</span>
            Done today ({sections.completedToday.length})
          </button>
          {doneOpen && sections.completedToday.map((item) => (
            <DailyWorkRow key={item.key} item={item} onToggle={toggleItem} />
          ))}
        </div>
      )}

      <PlanWeekOverlay open={planOpen} onClose={() => setPlanOpen(false)} />
    </CardSection>
  );
}
