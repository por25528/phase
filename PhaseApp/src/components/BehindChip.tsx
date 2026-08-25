import { behindPaceHint, behindPaceLabel } from '../lib/pace';

/**
 * Warn pill shown when a goal is meaningfully behind its expected pace
 * (callers gate on their own threshold, conventionally ≥10 pts).
 *
 * Pass `donePct` to get the explanatory tooltip; without it the chip still
 * renders, just without the arithmetic.
 */
export function BehindChip({
  pts,
  donePct,
  className = '',
}: {
  pts: number;
  donePct?: number;
  className?: string;
}) {
  return (
    <span
      title={donePct == null ? undefined : behindPaceHint(donePct, donePct + pts)}
      className={`text-kbd font-semibold px-[6px] py-[1px] rounded-full bg-warn-tint text-warn whitespace-nowrap ${className}`}
    >
      {behindPaceLabel(pts)}
    </span>
  );
}
