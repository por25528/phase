import { useMemo } from 'react';
import { todayStr, weekDates, parseD } from '@app/lib/dates';
import { scheduledByDate } from '@app/lib/scheduled';
import { clockLabel } from '@app/lib/clock';
import type { PhoneStore } from '../state/phoneStore';
import { SectionRule } from './today/SectionRule';

/**
 * This week, and nothing you can do to it.
 *
 * Read-only on purpose: every gesture that would change a sitting — drag,
 * resize, replan — is a PLACEMENT, and placement stays on the Mac where the
 * grid is. What the phone answers is "what did I say I would be doing on
 * Thursday", which needs no grid at all, only the days and the times.
 *
 * `scheduledByDate` is the desktop's own week derivation, in one pass over the
 * dataset rather than seven.
 */
export function Week({ store }: { store: PhoneStore }) {
  const state = store.usePhoneStore();
  const today = todayStr();
  const days = useMemo(() => weekDates(today), [today]);
  const byDate = useMemo(
    () => scheduledByDate(state.projected?.goals ?? [], state.projected?.tasks ?? [], days),
    [state.projected, days],
  );

  const placed = days.some((date) => (byDate.get(date)?.length ?? 0) > 0);

  return (
    <div className="flex flex-col">
      {!placed && (
        <p className="px-[18px] py-[22px] text-body text-muted">
          Nothing placed on the calendar this week.
        </p>
      )}
      {days.map((date) => {
        const items = byDate.get(date) ?? [];
        if (items.length === 0) return null;
        const d = parseD(date);
        const label = `${d.toLocaleDateString('en-US', { weekday: 'long' })} ${d.getDate()}`;
        return (
          <section key={date} className="mt-[18px] first:mt-0">
            {/* Today is named as today. A highlight the reader has to decode
                against six neighbours is a highlight that states nothing. */}
            <SectionRule label={label} right={date === today ? 'Today' : undefined} />
            <ul>
              {items.map((item) => (
                <li
                  key={item.blockId}
                  className={`flex items-baseline gap-[12px] px-[18px] py-[11px] border-b border-line ${
                    date === today ? '' : 'opacity-80'
                  }`}
                >
                  <span className="flex-none font-mono text-micro text-muted tabular-nums">
                    {clockLabel(item.startMin)} – {clockLabel(item.endMin)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-body ${item.done ? 'text-muted line-through' : 'text-ink'}`}
                    >
                      {item.title}
                    </span>
                    {item.goalTitle && (
                      <span className="block text-meta text-muted truncate">{item.goalTitle}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
