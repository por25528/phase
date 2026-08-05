import { describe, it, expect } from 'vitest';
import { dayBusySpans } from './busyLayout';
import { DAY_START_MIN, DAY_END_MIN } from './grid';
import type { BusyBlock } from '../db/types';

const DAY = '2026-08-04';

function timed(title: string, startMin: number, endMin: number, date = DAY): BusyBlock {
  return { date, startMin, endMin, title, allDay: false };
}
function allDay(title: string, date = DAY): BusyBlock {
  return { date, startMin: 0, endMin: 1440, title, allDay: true };
}

describe('dayBusySpans', () => {
  it('ignores blocks belonging to other days', () => {
    const spans = dayBusySpans(DAY, [timed('here', 540, 600), timed('elsewhere', 540, 600, '2026-08-05')], true);
    expect(spans.map((s) => s.title)).toEqual(['here']);
  });

  it('passes timed blocks through with their own bounds', () => {
    expect(dayBusySpans(DAY, [timed('standup', 540, 600)], true))
      .toEqual([{ key: `busy:${DAY}:0`, title: 'standup', startMin: 540, endMin: 600 }]);
  });

  // DEFECT 1. The old code built `busy` as EITHER the all-day block OR the
  // timed ones, so an all-day event made every meeting disappear from the
  // column while capacity.ts's blockedBy went on listing them. The grid and
  // the header contradicting each other is the failure this product exists to
  // avoid.
  it('keeps timed events visible on a day that also has an all-day event', () => {
    const spans = dayBusySpans(DAY, [allDay('Conference'), timed('standup', 540, 600)], true);
    expect(spans.map((s) => s.title)).toEqual(['Conference', 'standup']);
  });

  // DEFECT 2. The old code used find(), which silently dropped every all-day
  // event after the first.
  it('collapses several all-day events into one span with joined titles', () => {
    const spans = dayBusySpans(DAY, [allDay('Conference'), allDay('Holiday')], true);
    expect(spans).toEqual([
      { key: `busy:${DAY}:allday`, title: 'Conference, Holiday', startMin: DAY_START_MIN, endMin: DAY_END_MIN },
    ]);
  });

  it('spans the whole day for an all-day event', () => {
    const [span] = dayBusySpans(DAY, [allDay('Holiday')], true);
    expect(span.startMin).toBe(DAY_START_MIN);
    expect(span.endMin).toBe(DAY_END_MIN);
  });

  it('puts the all-day span first, so it lands in lane 0', () => {
    const spans = dayBusySpans(DAY, [timed('standup', 540, 600), allDay('Holiday')], true);
    expect(spans[0].title).toBe('Holiday');
  });

  // Matches capacity.ts, which filters `(allDayBlocks || !b.allDay)`. With the
  // preference off, an all-day event consumes nothing and shows nothing.
  it('drops all-day events when the preference is off, keeping timed ones', () => {
    const spans = dayBusySpans(DAY, [allDay('Conference'), timed('standup', 540, 600)], false);
    expect(spans.map((s) => s.title)).toEqual(['standup']);
  });

  it('gives every span a distinct key', () => {
    const spans = dayBusySpans(DAY, [allDay('Holiday'), timed('a', 540, 600), timed('b', 660, 720)], true);
    expect(new Set(spans.map((s) => s.key)).size).toBe(spans.length);
  });

  it('returns nothing for a day with no blocks, and still lays out a real day', () => {
    expect(dayBusySpans(DAY, [], true)).toEqual([]);
    expect(dayBusySpans(DAY, [timed('standup', 540, 600)], true)).toHaveLength(1);
  });
});
