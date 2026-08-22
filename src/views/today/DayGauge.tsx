import type { DayGauge as Gauge } from '../../lib/dayGauge';
import { clockLabel } from '../../lib/clock';

const pct = (n: number) => `${n * 100}%`;

/**
 * Today's window, drawn to scale.
 *
 * The signature element of the Instrument direction, and it is made entirely of
 * data Phase already computed and only ever said one clause at a time: when the
 * day opens and shuts, what is booked inside it, how much of it is behind you,
 * and where you are standing. `lib/dayGauge.ts` owns every number below; this
 * file owns only where the ink goes.
 *
 * **It is `aria-hidden`, and that is a claim about the page, not a shrug.** A
 * gauge is a SECOND reading of facts the page already states in words — the
 * free-time sentence on the Free time rule, the clock on each timed row, the
 * "no working hours set" notice when there is no window at all. If any of those
 * sentences ever leaves, this cannot become the only place the fact is made:
 * an instrument with no legend is a decoration.
 *
 * Positioned `<span>`s in a relative track, never SVG. The whole drawing is
 * five rectangles and a rule; SVG would buy a viewBox to keep in step with a
 * fluid width and nothing else.
 *
 * The hatch doing double duty is deliberate. The gutters outside the frame are
 * hatched because they are space you cannot put work in; the spent head of the
 * day is hatched because it is time you cannot put work in. One material, one
 * meaning, and a past block still reads THROUGH it — spent is not gone.
 */
export function DayGauge({ gauge }: { gauge: Gauge }) {
  return (
    <div aria-hidden="true" className="mt-[20px]">
      <div className="relative">
        {/* The clipped track. The now marker sits OUTSIDE it, below, because
            it overhangs both edges and a rounded track has to clip. */}
        <div className="relative h-[34px] rounded-[4px] border border-line-2 bg-bg overflow-hidden">
          {/* Open ground. One span per window — exactly one today, covering the
              whole track, so this paints as a plain fill until the day the
              availability model can split. */}
          {gauge.open.map((w) => (
            <span
              key={`open-${w.startFrac}`}
              className="absolute inset-y-0 bg-panel"
              style={{ left: pct(w.startFrac), width: pct(w.widthFrac) }}
            />
          ))}

          {/* Every two hours, so the bar is a scale you can read a value off
              rather than a proportion you have to trust. */}
          {gauge.ticks.map((t) => (
            <span
              key={`tick-${t.minute}`}
              className="absolute inset-y-0 w-px bg-line"
              style={{ left: pct(t.frac) }}
            />
          ))}

          {/* What is booked. Neutral ink and not a project hue: the gauge is
              handed intervals with no project on them, and colouring them all
              one project's colour would be a claim rather than a drawing. */}
          {gauge.blocks.map((b) => (
            <span
              key={`block-${b.startFrac}`}
              className="absolute top-[6px] bottom-[6px] rounded-[4px] bg-ink-soft/80"
              style={{ left: pct(b.startFrac), width: pct(b.widthFrac) }}
            />
          ))}

          {gauge.spentFrac !== null && gauge.spentFrac > 0 && (
            <span
              className="hatch absolute inset-y-0 left-0 bg-bg/55"
              style={{ width: pct(gauge.spentFrac) }}
            />
          )}
        </div>

        {gauge.nowFrac !== null && (
          <span
            className="absolute -top-[4px] -bottom-[4px] w-[2px] bg-warn"
            style={{ left: pct(gauge.nowFrac) }}
          />
        )}
      </div>

      {/* The legend. Both ends of the window, and the clock where it stands.
          Only three marks are labelled: at 11px across a 720px measure a label
          under every tick collides with the now reading exactly when the now
          reading is the one you came for. */}
      <div className="relative mt-[6px] h-[14px] font-mono text-micro tracking-[.09em] text-faint tabular-nums">
        <span className="absolute left-0">{clockLabel(gauge.startMin)}</span>
        <span className="absolute right-0">{clockLabel(gauge.endMin)}</span>
        {gauge.nowFrac !== null && gauge.nowMinute !== null && (
          <span
            className="absolute -translate-x-1/2 text-warn"
            style={{ left: pct(gauge.nowFrac) }}
          >
            {clockLabel(gauge.nowMinute)}
          </span>
        )}
      </div>
    </div>
  );
}
