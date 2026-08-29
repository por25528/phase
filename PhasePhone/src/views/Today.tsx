import { useMemo } from 'react';
import type { StepStatus } from '@app/db/types';
import { todayStr } from '@app/lib/dates';
import { dayStamp } from '@app/lib/today';
import { buildDailyWork, type DailyWorkItem } from '@app/lib/dailyWork';
import { carriedFrom, carryOverRows } from '@app/lib/todaySurface';
import { findInAll } from '@app/lib/tree';
import { stepStatus } from '@app/lib/status';
import type { PhoneStore } from '../state/phoneStore';
import { SectionRule } from './today/SectionRule';
import { WorkRow } from './today/WorkRow';
import { asOfLabel } from './today/asOf';

/**
 * What to do now, on a phone.
 *
 * Three sections and no fourth: today's commitments, what slipped into today,
 * and — last, because work that is done cannot outrank work that is not —
 * what was finished. The advisor's Now card, the free-time offer and the
 * replan strip all stay on the Mac: each of them PLACES something on a
 * calendar, and placement is not one of the companion's powers.
 *
 * Every derivation here is the desktop's own, reached through `@app/lib`.
 * `buildDailyWork` takes plain slices, which is exactly why the projection is
 * shaped as `SyncSlices` and not as something this app invented.
 */
export function Today({ store }: { store: PhoneStore }) {
  const state = store.usePhoneStore();
  const today = todayStr();
  const stamp = dayStamp(today);
  const asOf = asOfLabel(state.writtenAt, new Date());

  const projected = state.projected;
  const work = useMemo(
    () => buildDailyWork(projected?.goals ?? [], projected?.tasks ?? [], today),
    [projected, today],
  );
  const carried = useMemo(() => carryOverRows(work.carryOvers, today), [work.carryOvers, today]);

  /** A step's real status; a loose task has none, so it is done or it is not. */
  const statusOf = (item: DailyWorkItem): StepStatus => {
    if (item.kind === 'task') return item.done ? 'done' : 'todo';
    const node = projected ? findInAll(projected.goals, item.id) : null;
    return node ? stepStatus(node) : item.done ? 'done' : 'todo';
  };

  const refOf = (item: DailyWorkItem) =>
    item.kind === 'step'
      ? ({ kind: 'step', id: item.id, goalId: item.goalId! } as const)
      : ({ kind: 'task', id: item.id, goalId: item.goalId } as const);

  /**
   * The ops answer a boolean — did this reach the journal — and this screen
   * DISCARDS it, where `Capture` does not. That asymmetry is deliberate and it
   * is not a swallowed failure.
   *
   * A write that failed recomputes nothing, so the row simply does not move:
   * the box stays unticked, which is the truth. There is no claim to withhold
   * and no field to preserve — the two things `Capture` uses its answer for.
   * What the person needs is a reason, and the reason is the shell's
   * `SyncBar`, which reads the store's `error` and keeps saying so until
   * another WRITE succeeds. See `Today.test.tsx`, "a tick that never reached
   * the journal".
   */
  const fireAndForget = (op: Promise<boolean>): void => void op;

  const row = (item: DailyWorkItem, note?: string | null) => {
    const status = statusOf(item);
    return (
      <WorkRow
        key={item.key}
        item={item}
        status={status}
        note={note}
        onTick={() => fireAndForget(store.ops.completeTask(refOf(item)))}
        // Steps only: a loose `Task` carries no status, so there is nothing on
        // it to park.
        onPark={
          item.kind === 'step'
            ? () => fireAndForget(store.ops.setStatus(item.id, status === 'parked' ? 'todo' : 'parked'))
            : undefined
        }
      />
    );
  };

  return (
    <div className="flex flex-col">
      {/* ── The day ──
          The app's stamp at phone measure, with the sync's one honest caveat
          beside it: how old the canonical file is. It appears only when the
          answer is interesting — see `asOfLabel`.

          What is still WAITING to reach the Mac is not drawn here: it is the
          shell's `SyncBar`, because a capture made on the Capture screen is
          the op most likely to be outstanding and Today is the wrong place to
          tell anyone about it. */}
      <header className="px-[18px] pt-[18px] pb-[16px] border-b border-line">
        <span className="inline-flex items-stretch rounded-[4px] border border-line-2 overflow-hidden">
          <span className="section-label px-[8px] py-[3px] bg-fill text-paper font-semibold">
            {stamp.dow}
          </span>
          <span className="section-label px-[8px] py-[3px] border-l border-line-2 text-muted">
            {stamp.span}
          </span>
        </span>
        {asOf && <p className="mt-[10px] text-meta text-muted">{asOf}</p>}
      </header>

      {state.status === 'never-synced' && (
        <p className="px-[18px] py-[22px] text-body text-muted">
          Nothing synced yet. Open Phase on your Mac and it will publish today’s work here.
        </p>
      )}

      {state.status === 'ready' && (
        <>
          <section>
            <SectionRule
              label="Today"
              right={work.commitments.length > 0 ? `${work.commitments.length}` : undefined}
            />
            {work.commitments.length === 0 ? (
              <p className="px-[18px] py-[18px] text-body text-muted">Nothing committed to today.</p>
            ) : (
              <ul>{work.commitments.map((item) => row(item))}</ul>
            )}
          </section>

          {carried.rows.length > 0 && (
            <section className="mt-[24px]">
              <SectionRule
                label="Carried over"
                right={carried.overflow > 0 ? `+${carried.overflow} more` : undefined}
              />
              <ul>{carried.rows.map((item) => row(item, carriedFrom(item, today)))}</ul>
            </section>
          )}

          {/* Last, and with no cap: this section's input is one day of one
              person's work, where `Carried over` takes an unbounded backlog. */}
          {work.completedToday.length > 0 && (
            <section className="mt-[24px]">
              <SectionRule label="Done today" right={`${work.completedToday.length}`} />
              <ul>
                {work.completedToday.map((item) => (
                  // No `onTick`: `complete_task` is the companion's only
                  // completion verb and it does not un-tick. Offering the
                  // gesture for a step and withholding it for a task would be
                  // worse than withholding both.
                  <WorkRow key={item.key} item={item} status={statusOf(item)} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
