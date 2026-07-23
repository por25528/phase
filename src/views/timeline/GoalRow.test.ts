import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GoalWithSpan } from '../../lib/schedule';
import { canEditProjectSpan, GoalRow } from './GoalRow';

function goal(datesConfirmed?: boolean): GoalWithSpan {
  return {
    id: 'g',
    title: 'Project',
    start: '2026-07-01',
    deadline: '2026-12-31',
    datesConfirmed,
    nodes: [],
  };
}

describe('Timeline project span editing', () => {
  it('keeps legacy unconfirmed spans read-only while preserving confirmed editing', () => {
    expect(canEditProjectSpan(goal())).toBe(false);
    expect(canEditProjectSpan(goal(false))).toBe(false);
    expect(canEditProjectSpan(goal(true))).toBe(true);
  });

  it('renders an unconfirmed span without Timeline drag or keyboard-edit affordances', () => {
    const shared = {
      index: 0,
      rangeStart: '2026-01-01',
      pxPerDay: 10,
      labelW: 200,
      segs: [],
      bands: [],
      todayX: 0,
      canvasW: 2000,
      isExpanded: false,
      onToggle: () => {},
      isLast: true,
    };
    const unconfirmed = renderToStaticMarkup(createElement(GoalRow, {
      ...shared,
      goal: goal(),
    }));
    const confirmed = renderToStaticMarkup(createElement(GoalRow, {
      ...shared,
      goal: goal(true),
    }));

    expect(unconfirmed).toContain('dates unconfirmed');
    expect(unconfirmed).toContain('cursor-pointer');
    expect(unconfirmed).not.toContain('Arrow keys move by day');
    expect(unconfirmed).not.toContain('cursor-grab');
    expect(confirmed).toContain('Arrow keys move by day');
    expect(confirmed).toContain('cursor-grab');
  });
});
