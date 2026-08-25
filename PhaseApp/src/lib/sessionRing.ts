import type { ExpectedTime } from './expectedTime';
import type { FocusLevel } from './focusLens';

/**
 * What the small circle on a running session should draw.
 *
 * ONE rule: the ring fills only against evidence, and only when the shelf is
 * showing comparisons at all.
 *
 * A `starter` is Phase's own 30-minute default standing in for evidence it does
 * not have — `fitsWindow` already refuses to treat it as a promise, and
 * `teachingSessions` already refuses to learn from a constrained sitting. Fill
 * a ring against it and the guess becomes a target, and a target is the
 * countdown this whole surface exists without, wearing a circle. So it turns
 * instead.
 *
 * At the lowest focus the ring turns whatever the evidence, because
 * `elapsedAgainstExpected` already drops the comparison there. A graphic that
 * kept asserting a target the text had just withheld would make the card
 * contradict itself.
 *
 * `overflow` is a FRACTION of the target and is capped at 1. Past the
 * expectation the arc completes and the excess is drawn as a second sweep, so
 * going over reads as a fact rather than a failure — the same thing
 * `38m of 30m` says in words. The cap is what stops a session left running
 * overnight from asking for eleven revolutions.
 */

export type RingState =
  | { kind: 'turn' }
  | { kind: 'fill'; fraction: number; overflow: number };

/** The figure a range is judged against: its HIGH end, exactly as `fitsWindow` does. */
function targetMinutes(expected: ExpectedTime): number | null {
  switch (expected.kind) {
    case 'history': return expected.highMin;
    case 'estimate': return expected.minutes;
    case 'starter': return null;
  }
}

export function ringState(
  expected: ExpectedTime,
  elapsedMin: number,
  focus: FocusLevel,
): RingState {
  if (focus === 'low') return { kind: 'turn' };
  const target = targetMinutes(expected);
  if (target === null || target <= 0) return { kind: 'turn' };

  const clamped = Math.max(0, elapsedMin);
  if (clamped <= target) return { kind: 'fill', fraction: clamped / target, overflow: 0 };
  return { kind: 'fill', fraction: 1, overflow: Math.min(1, (clamped - target) / target) };
}
