import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../state/store';
import { TodayCheckbox } from '../components/TodayCheckbox';
import { IconArrowRight, IconWarning } from '../components/Icons';
import { buildDailyWork, nowDividerIndex, type DailyWorkItem } from '../lib/dailyWork';
import { attentionItems, nowFocus } from '../lib/todaySurface';
import { proposalMinutes, proposeReplan, slippedWork } from '../lib/replan';
import { ReplanPreview } from './today/ReplanPreview';
import { clockLabel } from '../lib/clock';
import { fmtMinutes } from '../lib/effort';
import { dateKicker, greeting } from '../lib/today';
import { useLocalDate } from '../hooks/useLocalDate';

/**
 * What to do now.
 *
 * Phase could already compute the next open leaf, the week's commitments,
 * capacity, pace and blocked states — and scattered those answers across goal
 * cards, a focus summary, a sidebar rail, a goal header and calendar blocks.
 * The Plan grid was the closest thing to an execution surface, and at 10:10 on
 * a Tuesday it showed seven days when two blocks mattered.
 *
 * Three zones, in this order, and nothing else: the one thing in front of you,
 * the rest of the day, and at most three exceptions. No portfolio analytics, no
 * habit configuration, no dashboard cards — a surface that answers one question
 * stops answering it the moment it also answers nine others.
 */
export function Today() {
  const { goals, tasks, availability, allDayBlocks, actions } = useAppStore();
  const today = useLocalDate();
  const [nowMinute, setNowMinute] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNowMinute(d.getHours() * 60 + d.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const sections = useMemo(() => buildDailyWork(goals, tasks, today), [goals, tasks, today]);
  const focus = nowFocus(sections.commitments, nowMinute);
  const attention = useMemo(
    () => attentionItems(goals, sections, today, availability, [], allDayBlocks),
    [goals, sections, today, availability, allDayBlocks],
  );
  const [replanOpen, setReplanOpen] = useState(false);
  const slipped = useMemo(() => slippedWork(goals, tasks, today), [goals, tasks, today]);
  // Proposed lazily: the search walks fourteen days of gaps per item, and the
  // strip only needs the count until someone asks what would happen.
  const proposal = useMemo(
    () => (replanOpen
      ? proposeReplan({
        goals, tasks, today, windows: availability, blocks: [], allDayBlocks,
        now: { date: today, minute: nowMinute },
      })
      : { moves: [], unplaceable: [] }),
    [replanOpen, goals, tasks, today, availability, allDayBlocks, nowMinute],
  );

  const open = sections.commitments.filter((i) => !i.done);
  const divider = nowDividerIndex(open, nowMinute);
  const doneCount = sections.completedToday.length;

  function complete(item: DailyWorkItem): void {
    if (item.kind === 'task') actions.toggleTask(item.id);
    else actions.toggleLeaf(item.id);
  }

  function openItem(item: DailyWorkItem): void {
    if (item.kind === 'step' && item.goalId) actions.openProject(item.goalId, item.id);
    else actions.revealInPlan('task', item.id);
  }

  return (
    <div className="max-w-[720px] mx-auto">
      <div className="mb-[18px]">
        <h1 className="text-h2 font-semibold tracking-[-0.01em]">{greeting(new Date().getHours())}</h1>
        <p className="text-meta text-muted mt-[2px]">{dateKicker(today)}</p>
      </div>

      {/* ── What slipped ──
          Above Now, because a day planned on top of yesterday's unfinished work
          is a day that will slip again. Two buttons, and neither of them moves
          anything: `Replan` opens a preview, `Leave it` dismisses the strip
          until the data changes. */}
      {slipped.length > 0 && (
        <div className="mb-[16px] flex flex-wrap items-center gap-[10px] px-[12px] py-[9px] rounded-card bg-warn-tint">
          <span className="text-ui text-warn font-semibold">
            {slipped.length} task{slipped.length === 1 ? '' : 's'} unfinished
          </span>
          <span className="text-meta text-ink-soft tabular-nums">
            {fmtMinutes(slipped.reduce((n, s2) => n + s2.minutes, 0))}
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setReplanOpen(true)}
            className="text-ui font-semibold text-ink px-[10px] py-[5px] rounded-field border border-line-2 bg-panel hover:bg-hover"
          >
            Replan
          </button>
        </div>
      )}

      {/* ── Now ── */}
      <section aria-label="Now" className="mb-[22px]">
        {focus ? (
          <div className="border border-line-2 rounded-card p-[14px] bg-panel">
            <div className="flex items-center gap-[8px] text-meta text-muted mb-[6px]">
              <span className="font-semibold text-ink-soft">{focus.current ? 'Now' : 'Next'}</span>
              {focus.item.startMin !== undefined && (
                <span className="tabular-nums">{clockLabel(focus.item.startMin)}</span>
              )}
              {focus.item.estimateMin !== undefined && (
                <span className="tabular-nums">{fmtMinutes(focus.item.estimateMin)}</span>
              )}
            </div>
            <div className="flex items-start gap-[10px]">
              <span className="pt-[2px]">
                <TodayCheckbox
                  checked={false}
                  onToggle={() => complete(focus.item)}
                  ariaLabel={`Mark "${focus.item.title}" as done`}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-lead text-ink">{focus.item.title}</div>
                {/* Why this matters, in the one place it is being asked. */}
                {focus.item.goalTitle && (
                  <div className="text-meta text-muted mt-[2px] truncate">{focus.item.goalTitle}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => openItem(focus.item)}
                aria-label={`Open "${focus.item.title}"`}
                className="flex-none text-meta text-muted hover:text-ink px-[8px] py-[5px] rounded-field hover:bg-hover inline-flex items-center gap-[5px]"
              >
                Open <IconArrowRight size={12} />
              </button>
            </div>
          </div>
        ) : (
          <p className="text-ui text-muted">
            {doneCount > 0
              ? `Nothing left today — ${doneCount} done.`
              : 'Nothing committed to today. Plan a task, or capture one with ⌘N.'}
          </p>
        )}
      </section>

      {/* ── Today's plan ── */}
      {open.length > 1 && (
        <section aria-label="Today’s plan" className="mb-[22px]">
          <h2 className="text-meta font-semibold text-muted mb-[6px]">Rest of today</h2>
          <ul className="border-t border-line">
            {open.map((item, i) => (
              <li key={item.key}>
                {/* One rule, where the day turns from behind you to ahead. */}
                {i === divider && i > 0 && (
                  <div aria-hidden="true" className="h-px bg-accent my-[2px]" />
                )}
                <div className="flex items-center gap-[9px] py-[7px] border-b border-line group">
                  <TodayCheckbox
                    checked={false}
                    onToggle={() => complete(item)}
                    ariaLabel={`Mark "${item.title}" as done`}
                  />
                  <span className="w-[54px] flex-none text-meta text-muted tabular-nums">
                    {item.startMin === undefined ? '' : clockLabel(item.startMin)}
                  </span>
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <span className="block truncate text-ui text-ink-soft">{item.title}</span>
                    {item.goalTitle && (
                      <span className="block truncate text-meta text-muted">{item.goalTitle}</span>
                    )}
                  </button>
                  {item.estimateMin !== undefined && (
                    <span className="flex-none text-meta text-muted tabular-nums">
                      {fmtMinutes(item.estimateMin)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Attention ── */}
      {attention.length > 0 && (
        <section aria-label="Attention">
          <h2 className="text-meta font-semibold text-muted mb-[6px]">Attention</h2>
          <ul className="flex flex-col gap-[2px]">
            {attention.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => (a.goalId ? actions.openProject(a.goalId) : actions.setView('plan'))}
                  className="w-full text-left flex items-center gap-[8px] px-[8px] py-[7px] rounded-field hover:bg-hover"
                >
                  <span className="text-warn flex-none inline-flex" aria-hidden="true">
                    <IconWarning size={13} />
                  </span>
                  <span className="flex-1 min-w-0 truncate text-ui text-ink-soft">{a.text}</span>
                  <span className="flex-none text-faint inline-flex" aria-hidden="true">
                    <IconArrowRight size={12} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {doneCount > 0 && (
        <p className="mt-[22px] text-meta text-muted">
          {doneCount} finished today.
        </p>
      )}

      <ReplanPreview
        open={replanOpen}
        proposal={proposal}
        onCancel={() => setReplanOpen(false)}
        onApply={() => {
          const moved = actions.applyReplan(proposal.moves);
          setReplanOpen(false);
          if (moved) {
            actions.showToast(`Moved ${proposal.moves.length} task${proposal.moves.length === 1 ? '' : 's'} · ${fmtMinutes(proposalMinutes(proposal))}`);
          }
        }}
      />
    </div>
  );
}
