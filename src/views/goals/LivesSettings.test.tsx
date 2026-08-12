// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LivesSettings } from './LivesSettings';

// vi.mock factories are hoisted above the imports, so the mocks they reference
// must be created before the module body runs — `vi.hoisted` is the pattern the
// rest of the suite uses for exactly this reason.
const mocks = vi.hoisted(() => ({
  addLife: vi.fn(() => true),
  renameLife: vi.fn(),
  removeLife: vi.fn(),
  lives: [{ id: 'l1', title: 'MIT', order: 0 }] as { id: string; title: string; order: number }[],
}));

vi.mock('../../state/store', () => ({
  useAppStore: () => ({ lives: mocks.lives, actions: { addLife: mocks.addLife, renameLife: mocks.renameLife, removeLife: mocks.removeLife } }),
  actions: { addLife: mocks.addLife, renameLife: mocks.renameLife, removeLife: mocks.removeLife },
}));

beforeEach(() => {
  mocks.lives = [{ id: 'l1', title: 'MIT', order: 0 }];
  mocks.addLife.mockClear();
  mocks.renameLife.mockClear();
  mocks.removeLife.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('LivesSettings', () => {
  it('lists each life in an editable field', () => {
    render(<LivesSettings />);
    expect((screen.getByLabelText('Life name') as HTMLInputElement).value).toBe('MIT');
  });

  it('adds a life from the new-life field', () => {
    render(<LivesSettings />);
    const field = screen.getByLabelText('New life name');
    fireEvent.change(field, { target: { value: 'Startup' } });
    fireEvent.submit(field.closest('form')!);

    expect(mocks.addLife).toHaveBeenCalledWith('Startup');
  });

  it('renames on blur', () => {
    render(<LivesSettings />);
    const field = screen.getByLabelText('Life name');
    fireEvent.change(field, { target: { value: 'Course 6' } });
    fireEvent.blur(field);

    expect(mocks.renameLife).toHaveBeenCalledWith('l1', 'Course 6');
  });

  it('deletes a life', () => {
    render(<LivesSettings />);
    fireEvent.click(screen.getByLabelText('Delete MIT'));
    expect(mocks.removeLife).toHaveBeenCalledWith('l1');
  });

  // The cap is a product rule, so it is stated rather than enforced silently
  // by a control that stops working for no visible reason.
  it('replaces the add field with the reason once three exist', () => {
    mocks.lives = [
      { id: 'l1', title: 'MIT', order: 0 },
      { id: 'l2', title: 'Startup', order: 1 },
      { id: 'l3', title: 'Music', order: 2 },
    ];
    render(<LivesSettings />);

    expect(screen.queryByLabelText('New life name')).toBeNull();
    expect(screen.getByText('Three is the most Phase will hold.')).toBeTruthy();
  });
});
