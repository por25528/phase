// @vitest-environment jsdom
import { createElement, type ReactElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Icons from './Icons';

/**
 * The icon set drifted once already, in two directions at the same time.
 *
 * Half the icons were Unicode characters that were not in the subsetted Public
 * Sans — `designScale.test.ts` guards that half, and stops them coming back. The
 * other half were real SVGs, hand-rolled per file: `Icons.tsx` drew at stroke
 * 1.8 on a 24 grid, `App.tsx` drew a byte-identical sun path at 2, `Habits.tsx`
 * drew a pencil at 2, `GoalRow.tsx` drew a chevron at 1.4 on an 8 grid, and
 * `TodayCheckbox` drew at 2.4 on a 12 grid. Four weights, three grids, for one
 * app's worth of icons — and nothing said they were meant to match.
 *
 * So the assertions below iterate the module's own exports rather than a list
 * written out here. A new icon added tomorrow is covered the moment it is
 * exported, which is the only version of this test worth having: a hand-kept
 * list would have to be updated by the same person who would have matched the
 * stroke weight anyway.
 */

afterEach(cleanup);

type IconComponent = (p: object) => ReactElement;

const entries = Object.entries(Icons).filter(
  (e): e is [string, IconComponent] => typeof e[1] === 'function',
);

function draw(Component: IconComponent, props: object = {}) {
  const { container } = render(createElement(Component, props));
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('icon rendered no <svg>');
  return svg;
}

describe('Icons', () => {
  it('exports a set worth testing', () => {
    // Guards the guard: if the filter above ever matched nothing, every
    // it.each below would silently pass on an empty table.
    expect(entries.length).toBeGreaterThan(10);
  });

  it.each(entries)('%s draws on the shared 24 grid', (_name, Component) => {
    expect(draw(Component).getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it.each(entries)('%s uses the one stroke weight', (_name, Component) => {
    expect(draw(Component).getAttribute('stroke-width')).toBe('1.8');
  });

  /**
   * Every icon is decorative. The control around it carries the name — via
   * aria-label, or its own text — so an icon that announced itself would
   * double up. `✦ Break a step into subtasks…` was read out with its
   * decoration until this pass; nothing here should reintroduce that.
   */
  it.each(entries)('%s is hidden from assistive tech', (_name, Component) => {
    expect(draw(Component).getAttribute('aria-hidden')).toBe('true');
    expect(draw(Component).getAttribute('focusable')).toBe('false');
  });

  it.each(entries)('%s is square and sized by its prop', (_name, Component) => {
    const svg = draw(Component, { size: 19 });
    expect(svg.getAttribute('width')).toBe('19');
    expect(svg.getAttribute('height')).toBe('19');
  });

  /**
   * Filled icons opt out of the stroke rather than keeping a stroke the same
   * colour — a dot with a 1.8 outline is a fatter dot, not a matched one.
   */
  it.each(entries)('%s takes its colour from currentColor', (_name, Component) => {
    const svg = draw(Component);
    const paint = [svg.getAttribute('fill'), svg.getAttribute('stroke')];
    expect(paint).toContain('currentColor');
    expect(paint.every((p) => p === 'currentColor' || p === 'none')).toBe(true);
  });

  /**
   * Geometry stays inside the box. An icon drawn to a different grid — a 32
   * box pasted in from another set, say — would be silently scaled into the 24
   * viewBox, coming out smaller and thinner than everything beside it. That is
   * precisely the drift this module exists to end, and it is near-invisible at
   * 11px.
   *
   * Only ABSOLUTE segments are checked. In relative commands the numbers are
   * deltas, not coordinates (`l-1.4` moves left by 1.4, it is not x = -1.4), so
   * bounding them would need a full path walk with arc and bézier maths — a
   * parser that would itself need a test. Every icon here starts with an
   * absolute `M`, so the check still sees each shape's origin, and the four
   * icons built entirely from absolute commands are covered end to end.
   */
  it.each(entries)('%s stays inside the viewBox', (_name, Component) => {
    const svg = draw(Component);
    const coords: number[] = [];
    svg.querySelectorAll('path').forEach((p) => {
      const segments = (p.getAttribute('d') ?? '').match(/[A-Za-z][^A-Za-z]*/g) ?? [];
      for (const seg of segments) {
        const cmd = seg[0];
        if (cmd === cmd.toLowerCase() || cmd === 'Z') continue;
        for (const n of seg.match(/-?\d+(?:\.\d+)?/g) ?? []) coords.push(Number(n));
      }
    });
    svg.querySelectorAll('circle').forEach((c) => {
      const cx = Number(c.getAttribute('cx'));
      const cy = Number(c.getAttribute('cy'));
      const r = Number(c.getAttribute('r'));
      coords.push(cx - r, cx + r, cy - r, cy + r);
    });
    expect(coords.length).toBeGreaterThan(0);
    for (const n of coords) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(24);
    }
  });

  it('draws the checkpoint solid when set and hollow when not', () => {
    expect(draw(Icons.IconDiamond, { filled: true }).getAttribute('fill')).toBe('currentColor');
    expect(draw(Icons.IconDiamond, { filled: false }).getAttribute('fill')).toBe('none');
  });
});
