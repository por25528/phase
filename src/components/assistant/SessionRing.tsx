import { useEffect, useRef } from 'react';
import type { RingState } from '../../lib/sessionRing';

/**
 * The circle beside a running session. Aesthetic, and honest about it: what it
 * draws is decided entirely by `ringState`, which refuses to fill against a
 * guess.
 *
 * A 34px box with a 2.5px stroke. `r={14}` leaves the stroke inside the box, so
 * nothing is clipped by a scroll container the way an outset focus ring is.
 * Both arcs are rotated -90° so they start at twelve o'clock, where a person
 * looks first.
 *
 * `aria-hidden`: every figure this states is already in the sentence beside it,
 * and a screen reader that read a decorative sweep would be reading the
 * elapsed time twice.
 *
 * The `turn` sweep is one revolution per 1.6s — deliberately outside the
 * 100–200ms band `designScale.test.ts` holds every OTHER animation to, so it
 * runs off `Element.animate()` rather than an `index.css` keyframe, exactly
 * as the focus pulse in `Project.tsx` does, and checks reduced-motion itself
 * for the same reason that pulse does.
 */
const R = 14;
const CIRCUMFERENCE = 2 * Math.PI * R;

export function SessionRing({ state, paused }: { state: RingState; paused: boolean }) {
  const arcStroke = paused ? 'text-faint-2' : 'text-fill';
  const turnRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (state.kind !== 'turn' || paused) return;
    const el = turnRef.current;
    if (!el || typeof el.animate !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const anim = el.animate(
      [{ transform: 'rotate(-90deg)' }, { transform: 'rotate(270deg)' }],
      { duration: 1600, easing: 'linear', iterations: Infinity },
    );
    return () => anim.cancel();
  }, [state.kind, paused]);

  return (
    <svg
      aria-hidden
      width="34"
      height="34"
      viewBox="0 0 34 34"
      className="shrink-0"
    >
      <circle
        cx="17" cy="17" r={R} fill="none" strokeWidth="2.5"
        className={paused ? 'text-faint-2' : 'text-track'}
        stroke="currentColor"
        strokeDasharray={paused ? '3 4' : undefined}
      />
      {state.kind === 'turn' ? (
        <circle
          ref={turnRef}
          cx="17" cy="17" r={R} fill="none" strokeWidth="2.5" strokeLinecap="round"
          className={`${arcStroke} origin-center -rotate-90`}
          stroke="currentColor"
          strokeDasharray={`${CIRCUMFERENCE * 0.16} ${CIRCUMFERENCE}`}
        />
      ) : (
        <>
          <circle
            cx="17" cy="17" r={R} fill="none" strokeWidth="2.5" strokeLinecap="round"
            className={`${arcStroke} origin-center -rotate-90`}
            stroke="currentColor"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - state.fraction)}
          />
          {state.overflow > 0 && (
            <circle
              cx="17" cy="17" r={R} fill="none" strokeWidth="2.5" strokeLinecap="round"
              className="origin-center -rotate-90 text-accent"
              stroke="currentColor"
              strokeDasharray={`${CIRCUMFERENCE * state.overflow} ${CIRCUMFERENCE}`}
            />
          )}
        </>
      )}
    </svg>
  );
}
