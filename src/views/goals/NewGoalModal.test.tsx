// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

    expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('study');
  });

  it('re-guesses while you are still typing', async () => {
    const { user } = mount();

    await user.type(title(), 'Repaint the kitchen');
    expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('general');
  });

  it('stops guessing once the user has chosen', async () => {
    const { user, onAdd } = mount();

    await user.type(title(), 'Physics Final');
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'project' } });
    await user.type(title(), ' revision');

    expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('project');
    await user.keyboard('{Enter}');
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ type: 'project' }));
  });

  /**
   * `datesConfirmed` exists for IMPORTED dates nobody has read. A date the user
   * just typed needs no review, and asking for one would make the first thing a
   * new goal does be a warning about itself.
   */
  it('treats a typed deadline as already confirmed', async () => {
    const { onAdd, user } = mount();

    await user.type(title(), 'Physics Final');
    /*
     * `fireEvent`, not `user.type`, for the date. `DateField` only starts
     * tracking a draft once `onFocus` has run, and typing a string ending in
     * `{Enter}` races that under load — the Enter arrives before React has
     * committed `editing`, and the field commits an empty draft. Driving
     * focus → change → Enter explicitly is deterministic and is the same three
     * events a person produces.
     */
    const deadline = screen.getByLabelText('Deadline');
    fireEvent.focus(deadline);
    fireEvent.change(deadline, { target: { value: '2099-08-24' } });
    fireEvent.keyDown(deadline, { key: 'Enter' });

    await user.click(title());
    await user.keyboard('{Enter}');

    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      deadline: '2099-08-24',
      datesConfirmed: true,
    }));
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
