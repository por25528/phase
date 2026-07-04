/** Warn pill shown when a goal is meaningfully behind its expected pace
 * (callers gate on their own threshold, conventionally ≥10 pts). */
export function BehindChip({ pts, className = '' }: { pts: number; className?: string }) {
  return (
    <span
      className={`text-[.62rem] font-semibold px-[6px] py-[1px] rounded-full bg-warn-tint text-warn whitespace-nowrap ${className}`}
    >
      {pts} pts behind
    </span>
  );
}
