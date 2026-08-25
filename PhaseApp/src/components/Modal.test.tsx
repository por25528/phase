// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';
import { Popover } from './Popover';

afterEach(cleanup);

/**
 * Escape, when a popover is open inside a dialog.
 *
 * `Popover` and `Modal` both listen for `keydown` on `window` in the CAPTURE
 * phase. `stopPropagation` does not stop a listener on the SAME target — that
 * needs `stopImmediatePropagation` — and capture listeners on one node run in
 * registration order, so the modal, which opened first, always ran first. One
 * press therefore closed the popover AND the dialog behind it.
 *
 * Nothing caught this because nothing had ever nested the two: on `main`,
 * none of the three modals contained a `Popover`. The New goal calendar is the
 * first, which is why the test arrives with it.
 */
describe('Escape inside a dialog that holds a popover', () => {
  function mount() {
    const onClose = vi.fn();
    render(
      createElement(Modal, {
        open: true,
        onClose,
        title: 'New goal',
        children: createElement(Popover, {
          label: 'Deadline',
          trigger: 'No deadline',
          children: () => createElement('button', { type: 'button' }, 'Aug 30'),
        }),
      }),
    );
    return { onClose, user: userEvent.setup() };
  }

  it('closes the popover and leaves the dialog standing', async () => {
    const { onClose, user } = mount();
    await user.click(screen.getByRole('button', { name: 'Deadline' }));
    expect(screen.getByRole('button', { name: 'Aug 30' })).toBeTruthy();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('button', { name: 'Aug 30' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  /**
   * The other half of the same rule: once the popover is shut, Escape belongs
   * to the dialog again. Gating on a `data-popover-open` attribute that is
   * absent while closed is what keeps a focused trigger from swallowing it.
   */
  it('closes the dialog on a second press', async () => {
    const { onClose, user } = mount();
    await user.click(screen.getByRole('button', { name: 'Deadline' }));

    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes the dialog on the first press when no popover was opened', async () => {
    const { onClose, user } = mount();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
