import { clockLabel } from '../../lib/clock';

/**
 * Where the day turns from behind you to ahead of it.
 *
 * This was an `aria-hidden` hairline. The accent is the app's scarcest signal
 * — it means action, overdue or now — and spending it on an unlabelled rule
 * asks the reader to infer the one thing the rule exists to state.
 */
export function NowDivider({ nowMinute }: { nowMinute: number }) {
  const label = clockLabel(nowMinute);
  return (
    <div
      role="separator"
      aria-label={`Now, ${label}`}
      className="flex items-center gap-[8px] px-[8px] my-[4px]"
    >
      <span className="text-meta font-semibold text-accent tabular-nums">{label}</span>
      <span aria-hidden="true" className="flex-1 h-px bg-accent" />
    </div>
  );
}
