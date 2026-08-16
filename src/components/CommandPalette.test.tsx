// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal, Habit, Task } from '../db/types';
import { CommandPalette } from './CommandPalette';

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

const GOALS: Goal[] = [
  {
    id: 'g1',
    title: 'Physics Final',
    nodes: [
      { id: 'n1', title: 'Problems 1–15' },
      { id: 'area', title: 'Mechanics', children: [{ id: 'n2', title: 'Review Chapter 7' }] },
      { id: 'n3', title: 'Old pset', status: 'done' },
    ],
  },
];
const TASKS: Task[] = [{ id: 't1', title: 'Email the TA', done: false, goalId: null }];
const HABITS: Habit[] = [];

function mount() {
  const onCommand = vi.fn();
  const onObjectAction = vi.fn();
  const onClose = vi.fn();
  render(createElement(CommandPalette, {
    open: true, onClose, goals: GOALS, tasks: TASKS, habits: HABITS, onCommand, onObjectAction,
  }));
  return { onCommand, onObjectAction, onClose, user: userEvent.setup() };
}

const input = () => screen.getByRole('combobox');
const options = () => screen.getAllByRole('option').map((el) => el.textContent ?? '');

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('the command palette', () => {
  /**
   * The empty state used to be three navigation rows, which is what taught
   * people the palette was a finder and nothing else.
   */
  it('offers verbs before anything is typed', () => {
    mount();
    expect(options().some((t) => t.includes('Add a task'))).toBe(true);
    expect(options().some((t) => t.includes('New goal'))).toBe(true);
  });

  it('runs a command by id', async () => {
    const { onCommand, user, onClose } = mount();

    await user.type(input(), 'new goal{Enter}');

    expect(onCommand).toHaveBeenCalledWith('new-goal');
    expect(onClose).toHaveBeenCalled();
  });

  it('finds a command by a word that is not in its label', async () => {
    const { user } = mount();
    await user.type(input(), 'unused');
    expect(options().some((t) => t.includes('Reclaim space'))).toBe(true);
  });

  it('shows only commands after a >', async () => {
    const { user } = mount();
    await user.type(input(), '>');
    expect(options().every((t) => !t.includes('Physics Final'))).toBe(true);
  });

  it('puts the object you named above the verbs that share its letters', async () => {
    const { user } = mount();
    await user.type(input(), 'physics');
    expect(options()[0]).toContain('Physics Final');
  });

  /**
   * Finding a thing and going to it is most of what this input is for, so Enter
   * runs the default verb rather than taxing the common case with a submenu.
   */
  it('opens on Enter without a detour through the verb list', async () => {
    const { onObjectAction, user } = mount();

    await user.type(input(), 'problems{Enter}');

    expect(onObjectAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'n1' }),
      'open',
    );
  });

  it('opens the verb list with the right arrow, and runs one from it', async () => {
    const { onObjectAction, user } = mount();

    await user.type(input(), 'problems');
    await user.keyboard('{ArrowRight}');
    expect(options()).toEqual(['Open in its goal', 'Mark as done', 'Schedule today', 'Schedule tomorrow', 'Clear its schedule']);

    await user.keyboard('{ArrowDown}{Enter}');
    expect(onObjectAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }), 'complete');
  });

  it('keeps the chosen object on screen while its verbs show', async () => {
    const { user } = mount();
    await user.type(input(), 'problems');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('Problems 1–15')).toBeTruthy();
  });

  /** Escape closes in layers — the verb list first, the palette second. */
  it('backs out of the verb list before closing the palette', async () => {
    const { onClose, user } = mount();

    await user.type(input(), 'problems');
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
    expect(options().some((t) => t.includes('Physics Final'))).toBe(true);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('offers a container only the verb it can honour', async () => {
    const { user } = mount();
    await user.type(input(), 'mechanics');
    await user.keyboard('{ArrowRight}');
    expect(options()).toEqual(['Open in its goal']);
  });

  it('offers a finished task nothing but reopening', async () => {
    const { user } = mount();
    await user.type(input(), 'old pset');
    await user.keyboard('{ArrowRight}');
    expect(options()).toEqual(['Open in its goal', 'Mark as not done']);
  });

  /**
   * Two loose tasks with the same title were indistinguishable rows — neither
   * carries a goal, so the second line was blank on both. The committed date is
   * the disambiguator.
   */
  it('disambiguates identical loose-task titles by their date', async () => {
    const dupes: Task[] = [
      { id: 'd1', title: '6.006 Problem Set 4', done: false, goalId: null, date: '2026-07-30' },
      { id: 'd2', title: '6.006 Problem Set 4', done: false, goalId: null, date: '2026-08-02' },
    ];
    const onCommand = vi.fn();
    const onObjectAction = vi.fn();
    render(createElement(CommandPalette, {
      open: true, onClose: vi.fn(), goals: [], tasks: dupes, habits: [], onCommand, onObjectAction,
    }));
    const user = userEvent.setup();

    await user.type(input(), 'problem set 4');
    const rows = options();
    expect(rows.some((t) => t.includes('Jul 30'))).toBe(true);
    expect(rows.some((t) => t.includes('Aug 2'))).toBe(true);
  });
});
