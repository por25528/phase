import { useEffect, useId, useState } from 'react';
import { CardSection } from '../../components/CardSection';
import { Tag } from '../../components/Tag';
import type { DailyWorkItem, DailyWorkSections } from '../../lib/dailyWork';
import { fmtD } from '../../lib/dates';
import { plannedLeaves, weekOf } from '../../lib/plan';
import { useAppStore } from '../../state/store';
import { DailyWorkRow } from './DailyWorkRow';
import {
  rescheduleTaskToPickedDate,
  runTaskCarryOverAction,
  toggleDailyWorkItem,
} from './workActions';

const decisionButtonClass = 'text-[.7rem] font-semibold px-[3px]';

export function TodayWorkCard({
  sections,
  today,
}: {
  sections: DailyWorkSections;
  today: string;
}) {
  const { goals, planReview, actions } = useAppStore();
  const [doneOpen, setDoneOpen] = useState(false);
  const [pickingTaskId, setPickingTaskId] = useState<string | null>(null);
  const pickerPrefix = useId();
  const week = weekOf(today);
  const weeklySteps = plannedLeaves(goals, week);
  const weeklyDone = weeklySteps.filter((leaf) => leaf.done).length;
  const reviewWaiting = Boolean(
    planReview && planReview.entries.length > 0 && !planReview.reviewed,
  );

  function toggleItem(item: DailyWorkItem): void {
    toggleDailyWorkItem(item, actions);
  }

  function reschedulePickedTask(item: DailyWorkItem, date: string): void {
    if (rescheduleTaskToPickedDate(item, date, actions)) {
      setPickingTaskId(null);
    }
  }

  function handleTaskDecision(
    choice: 'today' | 'tomorrow' | 'delete',
    item: DailyWorkItem,
  ): void {
    if (runTaskCarryOverAction(choice, item, today, actions)) {
      setPickingTaskId(null);
    }
  }

  useEffect(() => {
    if (
      pickingTaskId
      && !sections.carryOvers.some((item) => item.kind === 'task' && item.id === pickingTaskId)
    ) {
      setPickingTaskId(null);
    }
  }, [pickingTaskId, sections.carryOvers]);

  useEffect(() => {
    setDoneOpen(false);
  }, [today]);

  useEffect(() => {
    if (sections.completedToday.length === 0) setDoneOpen(false);
  }, [sections.completedToday.length]);

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
          onClick={() => actions.openPlan()}
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
          <div className="flex items-center justify-between gap-[8px] mb-[4px]">
            <div className="font-mono text-[.62rem] tracking-[.1em] uppercase text-warn font-semibold">
              Needs a decision
            </div>
            {sections.carryOvers.length > 1 && (
              <button
                type="button"
                onClick={() => actions.deferOpenToNextWeek()}
                className="text-[.68rem] font-semibold text-ink-soft hover:text-ink px-[6px] py-[2px] rounded-[6px] hover:bg-hover"
              >
                Push all to next week →
              </button>
            )}
          </div>
          {sections.carryOvers.map((item) => {
            const pickerId = `${pickerPrefix}-${item.id}`;
            return (
              <div
                key={item.key}
                className="py-[6px] border-b border-line-soft last:border-b-0"
              >
                <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[5px]">
                  <span className="min-w-0 flex-[1_1_180px] truncate text-[.84rem] text-ink-soft">
                    {item.title}
                  </span>
                  {item.goalTitle && (
                    <span className="max-w-[140px] min-w-0 overflow-hidden [&>span]:block [&>span]:truncate">
                      <Tag label={item.goalTitle} />
                    </span>
                  )}
                  {item.kind === 'task' ? (
                    <>
                      {item.scheduledDate && (
                        <span className="text-[.66rem] text-warn bg-warn-tint px-[6px] py-[1px] rounded-full flex-none">
                          {fmtD(item.scheduledDate)}
                        </span>
                      )}
                      <span className="flex flex-wrap items-center gap-x-[4px] gap-y-[3px]">
                        <button
                          type="button"
                          aria-label={`Move "${item.title}" to today`}
                          onClick={() => handleTaskDecision('today', item)}
                          className={`${decisionButtonClass} text-accent hover:text-accent-deep`}
                        >
                          Today
                        </button>
                        <button
                          type="button"
                          aria-label={`Move "${item.title}" to tomorrow`}
                          onClick={() => handleTaskDecision('tomorrow', item)}
                          className={`${decisionButtonClass} text-ink-soft hover:text-ink`}
                        >
                          Tomorrow
                        </button>
                        <button
                          type="button"
                          aria-label={`Pick a date for "${item.title}"`}
                          aria-controls={pickerId}
                          aria-expanded={pickingTaskId === item.id}
                          onClick={() => setPickingTaskId((current) => current === item.id ? null : item.id)}
                          className={`${decisionButtonClass} text-ink-soft hover:text-ink`}
                        >
                          Pick day
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete "${item.title}"`}
                          onClick={() => handleTaskDecision('delete', item)}
                          className={`${decisionButtonClass} text-muted hover:text-ink`}
                        >
                          Delete
                        </button>
                      </span>
                    </>
                  ) : (
                    <>
                      {item.plannedWeek && (
                        <span className="text-[.66rem] text-warn bg-warn-tint px-[6px] py-[1px] rounded-full flex-none">
                          wk of {fmtD(item.plannedWeek)}
                        </span>
                      )}
                      <span className="flex flex-wrap items-center gap-x-[4px] gap-y-[3px]">
                        <button
                          type="button"
                          aria-label={`Replan "${item.title}" this week`}
                          onClick={() => item.goalId && actions.planNode(item.goalId, item.id, week)}
                          className={`${decisionButtonClass} text-accent hover:text-accent-deep`}
                        >
                          Replan
                        </button>
                        <button
                          type="button"
                          aria-label={`Break down "${item.title}"`}
                          onClick={() => item.goalId && actions.openDrawer(item.goalId, item.id)}
                          className={`${decisionButtonClass} text-ink-soft hover:text-ink`}
                        >
                          Break down
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove "${item.title}" from the plan`}
                          onClick={() => item.goalId && actions.unplanNode(item.goalId, item.id)}
                          className={`${decisionButtonClass} text-muted hover:text-ink`}
                        >
                          Remove
                        </button>
                      </span>
                    </>
                  )}
                </div>
                {item.kind === 'task' && pickingTaskId === item.id && (
                  <div className="mt-[6px] flex justify-end">
                    <input
                      id={pickerId}
                      type="date"
                      autoFocus
                      aria-label={`Choose a new date for "${item.title}"`}
                      onChange={(event) => reschedulePickedTask(item, event.target.value)}
                      className="bg-field border border-line-2 rounded-field px-[8px] py-[5px] text-[.76rem] text-ink outline-none focus:border-muted"
                    />
                  </div>
                )}
              </div>
            );
          })}
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
    </CardSection>
  );
}
