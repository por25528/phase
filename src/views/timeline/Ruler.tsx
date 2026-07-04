import { dateToX } from '../../lib/timeline';
import type { RulerTick } from '../../lib/timeline';

/**
 * Adaptive ruler strip for the timeline header: bottom-anchored graduations
 * whose height climbs with the unit — days are hairlines, Sundays medium
 * (numbered once wide enough), month starts tall and labeled, January full
 * height with the year. Finer units appear as the scale earns them, so
 * pinch-zooming reads like leaning into a physical ruler.
 */
export function Ruler({
  ticks, rangeStart, pxPerDay,
}: { ticks: RulerTick[]; rangeStart: string; pxPerDay: number }) {
  return (
    <div className="relative h-[46px]">
      {ticks.map((t) => {
        const x = dateToX(t.start, rangeStart, pxPerDay);
        if (x <= 0) return null;
        const mark =
          t.unit === 'year' ? 'top-0 bottom-0 border-l border-line-2'
          : t.unit === 'month' ? 'top-[16px] bottom-0 border-l border-line-2'
          : t.unit === 'week' ? 'h-[12px] bottom-0 border-l border-line'
          : 'h-[6px] bottom-0 border-l border-line';
        return (
          <span key={t.start} className={`absolute ${mark}`} style={{ left: `${x}px` }}>
            {t.label && (
              <span
                className={`absolute left-[5px] whitespace-nowrap select-none ${
                  t.unit === 'week'
                    ? 'bottom-[2px] text-[.6rem] text-faint tabular-nums'
                    : t.unit === 'year'
                    ? 'top-[3px] text-[.72rem] text-ink-soft font-semibold tabular-nums'
                    : 'top-[3px] text-[.72rem] text-muted font-medium'
                }`}
              >
                {t.label}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
