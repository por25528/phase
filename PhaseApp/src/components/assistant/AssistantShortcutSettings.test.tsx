// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantShortcutSettings } from './AssistantShortcutSettings';

afterEach(cleanup);

describe('AssistantShortcutSettings', () => {
  it('renders the default chord as key caps', () => {
    render(<AssistantShortcutSettings accelerator="Command+Space" status={null} onSave={() => {}} />);
    const kbds = screen.getAllByText(/^(⌘|Space)$/).map((el) => el.textContent);
    expect(kbds).toEqual(['⌘', 'Space']);
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
  });

  it('captures only a real chord and stages it for saving', () => {
    const onSave = vi.fn();
    render(<AssistantShortcutSettings accelerator="Command+Space" status={null} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));

    const field = screen.getByRole('textbox', { name: 'New shortcut' });
    // A bare key is typing, not a chord: nothing stages and the hint appears.
    fireEvent.keyDown(field, { key: 'k' });
    expect(screen.getByText(/needs a modifier/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);

    fireEvent.keyDown(field, { key: 'k', metaKey: true });
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('Command+K');
  });

  it('cancel leaves the stored chord untouched', () => {
    const onSave = vi.fn();
    render(<AssistantShortcutSettings accelerator="Command+Space" status={null} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'New shortcut' }), { key: 'k', metaKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
  });

  it('says a conflict plainly and keeps the field editable', () => {
    render(
      <AssistantShortcutSettings
        accelerator="Command+Space"
        status={{ requested: 'Command+Space', active: null, registered: false, conflict: true }}
        onSave={() => {}}
      />,
    );
    expect(screen.getByText(/another app owns it/i)).toBeTruthy();
    expect(screen.getByText(/Spotlight/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
  });

  it('names the chord that still works when a change conflicted', () => {
    render(
      <AssistantShortcutSettings
        accelerator="Control+Alt+K"
        status={{ requested: 'Control+Alt+K', active: 'Command+Space', registered: false, conflict: true }}
        onSave={() => {}}
      />,
    );
    expect(screen.getByText(/Command\+Space still works/)).toBeTruthy();
  });

  it('reports an active registration quietly', () => {
    render(
      <AssistantShortcutSettings
        accelerator="Command+Space"
        status={{ requested: 'Command+Space', active: 'Command+Space', registered: true, conflict: false }}
        onSave={() => {}}
      />,
    );
    expect(screen.getByText('Active everywhere while Phase is running.')).toBeTruthy();
  });
});
