import { GRID_VIEWPORT_PX } from '../../lib/grid';

/**
 * What Plan shows before hydration.
 *
 * A skeleton is a SURFACE, not three bars of ink — the lesson the shelf's
 * skeleton already learned. So this mirrors the real layout: the 272px rail
 * column, the divider, the header strip and one grid-sized block. Its job is to
 * stop the page jumping when the data lands, which a centred "Loading…" cannot
 * do because it occupies none of the space the calendar is about to claim.
 */
export function PlanSkeleton() {
  return (
    <div role="status" aria-label="Loading your plan" className="grid grid-cols-1 md:grid-cols-[272px_1fr] gap-[18px] md:gap-0">
      <div className="min-w-0 md:relative md:border-r md:border-line">
        <div className="flex flex-col gap-[8px] md:pr-[18px]">
          <div className="h-[14px] w-[80px] rounded-[4px] bg-fill/10" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[22px] rounded-[6px] bg-fill/10" />
          ))}
        </div>
      </div>
      <div className="min-w-0 md:pl-[18px]">
        <div className="flex items-center gap-[14px] mb-[12px]">
          <div className="h-[24px] w-[160px] rounded-[6px] bg-fill/10" />
          <div className="h-[6px] flex-1 max-w-[420px] rounded-full bg-fill/10" />
        </div>
        <div className="rounded-card bg-fill/5" style={{ height: `${GRID_VIEWPORT_PX}px` }} />
      </div>
    </div>
  );
}
