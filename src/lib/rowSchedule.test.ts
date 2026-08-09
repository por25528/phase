import { describe, expect, it } from 'vitest';
import type { GoalNode } from '../db/types';
import { dayLabel, scheduleCell } from './rowSchedule';
import { makeBlock } from './blocks';

// 2026-08-12 is a Wednesday; its Monday is 2026-08-10.
const TODAY = '2026-08-12';

const leaf = (over: Partial<GoalNode> = {}): GoalNode => ({ id: 'n', title: 'n', ...over });

describe('dayLabel', () => {
  it.each([
    ['2026-08-12', 'Today'],
    ['2026-08-13', 'Tomorrow'],
    ['2026-08-15', 'Sat'],
    ['2026-08-24', 'Aug 24'],
    ['2026-08-01', 'Aug 1'],
  ])('reads %s as %s', (date, expected) => {
    expect(dayLabel(date, TODAY)).toBe(expected);
  });

  /**
   * The weekday form only holds inside the next seven days. Past that, "Tue"
   * is ambiguous between two Tuesdays and a date is the shorter answer anyway.
   */
  it('stops using weekday names once they stop being unambiguous', () => {
    expect(dayLabel('2026-08-19', TODAY)).toBe('Aug 19');
  });
});

describe('scheduleCell', () => {
  it('prefers an actual time over everything else the node carries', () => {
    const cell = scheduleCell(
      leaf({ plannedWeek: '2026-08-10', deadline: '2026-08-24', blocks: [makeBlock(TODAY, 840, 60)] }),
      TODAY,
    );
    expect(cell?.text).toMatch(/^Today /);
    expect(cell?.tone).toBe('muted');
  });

  it('names the day and the time of the next sitting', () => {
    expect(scheduleCell(leaf({ blocks: [makeBlock('2026-08-13', 540, 60)], plannedWeek: '2026-08-10' }), TODAY)?.text)
      .toMatch(/^Tomorrow /);
  });

  /**
   * A task can be sat several times, so "when" is a run of dates. Naming the
   * next one and counting the rest is the only version of that which fits a
   * row.
   */
  it('counts the sittings beyond the next one', () => {
    const cell = scheduleCell(leaf({
      plannedWeek: '2026-08-10',
      blocks: [makeBlock('2026-08-13', 540, 60), makeBlock('2026-08-14', 540, 60)],
    }), TODAY);
    expect(cell?.text).toMatch(/\+1$/);
    expect(cell?.hint).toContain('1 more sitting');
  });

  it('warns on a day that has been and gone', () => {
    expect(scheduleCell(leaf({ blocks: [makeBlock('2026-08-11', 540, 60)], plannedWeek: '2026-08-10' }), TODAY)?.tone)
      .toBe('warn');
  });

  it('says the week when the work is committed but not placed', () => {
    expect(scheduleCell(leaf({ plannedWeek: '2026-08-10' }), TODAY))
      .toMatchObject({ text: 'This week', tone: 'muted' });
  });

  it('warns on a week that has passed — that is the carry-over', () => {
    expect(scheduleCell(leaf({ plannedWeek: '2026-08-03' }), TODAY))
      .toMatchObject({ text: 'Wk Aug 3', tone: 'warn' });
  });

  /**
   * "When will I do this" beats "when is it due" once the first is answered —
   * showing both would be two columns of mostly-empty metadata.
   */
  it('falls through to the deadline only when nothing is committed', () => {
    expect(scheduleCell(leaf({ deadline: '2026-08-24' }), TODAY))
      .toMatchObject({ text: 'Due Aug 24', tone: 'muted' });
  });

  it('warns on a deadline that has passed', () => {
    expect(scheduleCell(leaf({ deadline: '2026-08-01' }), TODAY))
      .toMatchObject({ text: 'Overdue Aug 1', tone: 'warn' });
  });

  it('says nothing about a node with no dates at all', () => {
    expect(scheduleCell(leaf(), TODAY)).toBeNull();
  });

  /**
   * A finished task's schedule is history. "Tue 14:00" beside a ticked box
   * reads as work still to come, on the one row that has none left.
   */
  it('says nothing once the task is done', () => {
    expect(scheduleCell(leaf({ status: 'done', blocks: [makeBlock(TODAY, 600, 60)] }), TODAY))
      .toBeNull();
  });
});
