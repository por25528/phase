import { clockLabel } from '../../lib/clock';

/**
 * Where the day turns from behind you to ahead of it.
 *
 * This was an `aria-hidden` hairline. The accent is the app's scarcest signal
 * — it means action, overdue or now — and spending it on an unlabelled rule
 * asks the reader to infer the one thing the rule exists to state.
 *
 * `nowDividerIndex` can only return a divider when an item has a `startMin`,
 * and Today reserves the time column whenever any row is timed. The checkbox
 * spacer is therefore always the row's leading column, so the divider's clock
 * stays aligned with the rows' clocks rather than becoming a magic offset.
 */
export function NowDivider({ nowMinute }: { nowMinute: number }) {
  const label = clockLabel(nowMinute);
  return (
    <div
      role="separator"
      aria-label={`Now, ${label}`}
      className="flex items-center gap-[8px] px-[8px] my-[4px]"
    >
      <span aria-hidden="true" className="w-[22px] flex-none" />
      <span className="w-[48px] flex-none text-meta font-semibold text-accent tabular-nums">{label}</span>
      <span aria-hidden="true" className="flex-1 h-px bg-accent" />
    </div>
  );
}
