import { useEffect } from 'react';
import type { CSSProperties } from 'react';

/** Stagger delay as a custom property. One helper so every delay on the page
 *  is written the same way and the increments stay comparable at a glance. */
export function delay(ms: number): CSSProperties {
  return { '--m-d': `${ms}ms` } as CSSProperties;
}

/**
 * One observer for the whole page.
 *
 * Every element carrying `data-reveal` is watched once and unobserved the
 * moment it lands — reveals are a one-shot event, and re-running them on
 * scroll-back is the fastest way to make a page feel cheap. Threshold and
 * root margin are tuned so a block starts arriving just after its top edge
 * clears the fold, which is where the eye is already looking.
 *
 * IntersectionObserver, never a scroll listener: the browser does this work
 * off the main thread, and nothing here reads layout.
 */
export function useReveal() {
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));

    // Belt and braces: if the API is missing, show everything rather than
    // leaving a reader staring at an empty sheet.
    if (!('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('is-in'));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;

          // The reader is already past this element's starting point — a fast
          // flick, a scrollbar drag, an End key or a deep link can carry a
          // block from below the fold to above it between two callbacks. The
          // test is the TOP edge, not the bottom: a row clipped by the top of
          // the viewport shows less than the threshold and never counts as
          // intersecting, yet it is on screen and must not stay at opacity 0.
          // There is no reveal left to play here, so land it without a delay.
          if (!entry.isIntersecting) {
            if (entry.boundingClientRect.top < 0) {
              el.style.setProperty('--m-d', '0ms');
              el.classList.add('is-in');
              io.unobserve(el);
            }
            continue;
          }

          el.classList.add('is-in');
          io.unobserve(el);
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -60px 0px' },
    );

    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}
