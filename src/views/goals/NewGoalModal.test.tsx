// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal } from '../../db/types';
import { NewGoalModal } from './NewGoalModal';

function mount() {
  const onAdd = vi.fn<(goal: Goal) => void>();
  const onClose = vi.fn();
  render(createElement(NewGoalModal, { open: true, onAdd, onClose }));
  return { onAdd, onClose, user: userEvent.setup() };
}

const title = () => screen.getByRole('textbox', { name: /What do you want to finish/ });

/**
 * Type is a segmented radio group, not a `<select>`, so "what is it showing?"
 * is answered by which radio is checked rather than by reading `.value` off the
 * collapsed control. That is also the stronger assertion: a select's value is
 * legible only to the DOM, while `checked` is what a screen reader announces.
 */
const chosenType = () =>
  (screen.getAllByRole('radio') as HTMLInputElement[]).find((r) => r.checked)?.value;

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('creating a goal', () => {
  /**
   * Six decisions before the goal existed — title, horizon, start, deadline,
   * first tasks, notes — is a form-shaped interpretation of planning. A person
   * with "Physics Final, Aug 24" should be inside a real workspace after two
   * fields.
   */
  it('needs nothing but a title', async () => {
    const { onAdd, user } = mount();

    await user.type(title(), 'Physics Final{Enter}');

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'Physics Final' }));
  });

  it('asks for no horizon, no start date, no first tasks and no notes', () => {
    mount();
    expect(screen.queryByLabelText(/Horizon/)).toBeNull();
    expect(screen.queryByLabelText(/^Start/)).toBeNull();
    expect(screen.queryByText(/First tasks/)).toBeNull();
    expect(screen.queryByText(/Notes/)).toBeNull();
  });

  /**
   * A guess that hides has to be right. A guess shown as a filled control only
   * has to be reasonable, and "Final" → Study is.
   */
  it('guesses the type from the title and shows the guess', async () => {
    const { user } = mount();

    await user.type(title(), 'Physics Final');

    expect(chosenType()).toBe('study');
  });

  /**
   * A `<select>` showed one of three options and hid the rest behind a click,
   * so the guess was legible but the alternatives were not. Laying all three out
   * is what makes "shown as a control rather than applied silently" true in the
   * pixels and not just in the DOM.
   */
  it('shows what it picked over, not only what it picked', async () => {
    const { user } = mount();

    await user.type(title(), 'Physics Final');

    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value))
      .toEqual(['study', 'project', 'general']);
  });

  it('re-guesses while you are still typing', async () => {
    const { user } = mount();

    await user.type(title(), 'Repaint the kitchen');
    expect(chosenType()).toBe('general');
  });

  it('stops guessing once the user has chosen', async () => {
    const { user, onAdd } = mount();

    await user.type(title(), 'Physics Final');
    await user.click(screen.getByRole('radio', { name: 'Project' }));
    await user.type(title(), ' revision');

    expect(chosenType()).toBe('project');
    await user.keyboard('{Enter}');
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ type: 'project' }));
  });

  /**
   * `datesConfirmed` exists for IMPORTED dates nobody has read. A date the user
   * just picked needs no review, and asking for one would make the first thing
   * a new goal does be a warning about itself.
   *
   * The `fireEvent.focus/change/keyDown` dance this replaces was working around
   * `DateField`'s draft lifecycle. A grid has no draft: the click IS the value.
   */
  it('treats a picked deadline as already confirmed', async () => {
    const { onAdd, user } = mount();

    await user.type(title(), 'Physics Final');
    await user.click(screen.getByRole('button', { name: /^Deadline:/ }));
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: /^Sep 24, / }));

    await user.click(title());
    await user.keyboard('{Enter}');

    const created = onAdd.mock.calls[0][0];
    expect(created.deadline).toMatch(/^\d{4}-09-24$/);
    expect(created.datesConfirmed).toBe(true);
  });

  it('offers no textbox for the deadline at all', () => {
    mount();
    expect(screen.queryByRole('textbox', { name: 'Deadline' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Deadline: not set' })).toBeTruthy();
  });

  it('creates no deadline at all when none was typed', async () => {
    const { onAdd, user } = mount();
    await user.type(title(), 'Someday thing{Enter}');
    expect(onAdd.mock.calls[0][0].deadline).toBeUndefined();
  });

  it('refuses an empty title rather than creating an untitled goal', async () => {
    const { onAdd, user } = mount();
    await user.type(title(), '   {Enter}');
    expect(onAdd).not.toHaveBeenCalled();
  });
});
