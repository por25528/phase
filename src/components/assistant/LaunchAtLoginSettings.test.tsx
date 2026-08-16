// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LaunchAtLoginSettings } from './LaunchAtLoginSettings';
import type { PhaseShellBridge } from '../../lib/shellBridge';

const bridgeMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/shellBridge', () => ({
  shellBridge: () => bridgeMock(),
}));

function fixture(over: Partial<PhaseShellBridge> = {}): PhaseShellBridge {
  return {
    available: true,
    insetTitleBar: false,
    openAssistant: vi.fn(async () => true),
    onOpenSettings: vi.fn(() => () => {}),
    getLaunchAtLogin: vi.fn(async () => false),
    setLaunchAtLogin: vi.fn(async () => true),
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LaunchAtLoginSettings', () => {
  it('loads the current desktop value and toggles it once', async () => {
    const setLaunchAtLogin = vi.fn(async () => true);
    bridgeMock.mockReturnValue(fixture({ setLaunchAtLogin }));
    render(<LaunchAtLoginSettings />);

    const toggle = await screen.findByRole('switch', { name: 'Launch Phase at login' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(setLaunchAtLogin).toHaveBeenCalledWith(true);
    expect(setLaunchAtLogin).toHaveBeenCalledTimes(1);
  });

  it('does not flip visually while a save is in flight and disables the switch', async () => {
    let resolveSet: (value: boolean | null) => void = () => {};
    bridgeMock.mockReturnValue(fixture({
      setLaunchAtLogin: vi.fn(() => new Promise<boolean | null>((resolve) => { resolveSet = resolve; })),
    }));
    render(<LaunchAtLoginSettings />);

    const toggle = await screen.findByRole('switch', { name: 'Launch Phase at login' });
    fireEvent.click(toggle);

    // The old value stays put until the OS answers — the returned boolean is authoritative.
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.hasAttribute('disabled')).toBe(true);

    await act(async () => { resolveSet(true); });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.hasAttribute('disabled')).toBe(false);
  });

  it('restores the truthful value and shows the exact warning when the OS refuses', async () => {
    bridgeMock.mockReturnValue(fixture({ setLaunchAtLogin: vi.fn(async () => null) }));
    render(<LaunchAtLoginSettings />);

    const toggle = await screen.findByRole('switch', { name: 'Launch Phase at login' });
    fireEvent.click(toggle);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("Phase couldn't change this setting.");
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('renders nothing in the plain browser', () => {
    bridgeMock.mockReturnValue(fixture({
      available: false,
      getLaunchAtLogin: vi.fn(async () => null),
      setLaunchAtLogin: vi.fn(async () => null),
    }));
    const { container } = render(<LaunchAtLoginSettings />);
    expect(container.innerHTML).toBe('');
  });

  it('shows a quiet skeleton line while the read is pending, then the switch', async () => {
    let resolveRead: (value: boolean | null) => void = () => {};
    bridgeMock.mockReturnValue(fixture({
      getLaunchAtLogin: vi.fn(() => new Promise<boolean | null>((resolve) => { resolveRead = resolve; })),
    }));
    render(<LaunchAtLoginSettings />);

    expect(screen.queryByRole('switch')).toBeNull();
    // The skeleton is presentational: the live `status` role belongs to the
    // Good luck send-off and the app's notices, never to a placeholder that
    // announces nothing.
    expect(screen.getByTestId('launch-skeleton')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();

    await act(async () => { resolveRead(true); });
    const toggle = await screen.findByRole('switch', { name: 'Launch Phase at login' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('ignores a write that resolves after the row unmounts', async () => {
    let resolveSet: (value: boolean | null) => void = () => {};
    bridgeMock.mockReturnValue(fixture({
      setLaunchAtLogin: vi.fn(() => new Promise<boolean | null>((resolve) => { resolveSet = resolve; })),
    }));
    const errors: unknown[][] = [];
    const onError = vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args); });
    try {
      const { unmount } = render(<LaunchAtLoginSettings />);
      const toggle = await screen.findByRole('switch', { name: 'Launch Phase at login' });
      fireEvent.click(toggle);
      expect(toggle.hasAttribute('disabled')).toBe(true);

      unmount();
      await act(async () => { resolveSet(true); });

      // The deferred write settled on a dead component: no act warning, no
      // unmounted-update warning, no leftover DOM.
      expect(errors).toHaveLength(0);
      expect(screen.queryByRole('switch')).toBeNull();
      expect(screen.queryByTestId('launch-skeleton')).toBeNull();
    } finally {
      onError.mockRestore();
    }
  });

  it('treats a null read as the default and never leaves the row stuck loading', async () => {
    bridgeMock.mockReturnValue(fixture({ getLaunchAtLogin: vi.fn(async () => null) }));
    render(<LaunchAtLoginSettings />);

    const toggle = await screen.findByRole('switch', { name: 'Launch Phase at login' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('stops the skeleton, keeps the default off, and shows the exact warning when the read rejects', async () => {
    bridgeMock.mockReturnValue(fixture({
      getLaunchAtLogin: vi.fn(async () => {
        throw new Error('shell down');
      }),
    }));
    render(<LaunchAtLoginSettings />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("Phase couldn't change this setting.");
    expect(screen.queryByTestId('launch-skeleton')).toBeNull();
    const toggle = await screen.findByRole('switch', { name: 'Launch Phase at login' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('re-enables the switch, preserves the old value, and shows the exact warning when the write rejects', async () => {
    bridgeMock.mockReturnValue(fixture({
      getLaunchAtLogin: vi.fn(async () => true),
      setLaunchAtLogin: vi.fn(async () => {
        throw new Error('shell down');
      }),
    }));
    render(<LaunchAtLoginSettings />);

    const toggle = await screen.findByRole('switch', { name: 'Launch Phase at login' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe("Phase couldn't change this setting.");
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.hasAttribute('disabled')).toBe(false);
  });

  it('is quiet when the read rejects after the row unmounts', async () => {
    let rejectRead: (reason: unknown) => void = () => {};
    bridgeMock.mockReturnValue(fixture({
      getLaunchAtLogin: vi.fn(() => new Promise<boolean | null>((_, reject) => { rejectRead = reject; })),
    }));
    const errors: unknown[][] = [];
    const onError = vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args); });
    try {
      const { unmount } = render(<LaunchAtLoginSettings />);
      expect(screen.getByTestId('launch-skeleton')).toBeTruthy();

      unmount();
      await act(async () => { rejectRead(new Error('shell down')); });

      // The rejected read settled on a dead component: no warning, no act error.
      expect(errors).toHaveLength(0);
      expect(screen.queryByTestId('launch-skeleton')).toBeNull();
    } finally {
      onError.mockRestore();
    }
  });

  it('is quiet when the write rejects after the row unmounts', async () => {
    let rejectSet: (reason: unknown) => void = () => {};
    bridgeMock.mockReturnValue(fixture({
      setLaunchAtLogin: vi.fn(() => new Promise<boolean | null>((_, reject) => { rejectSet = reject; })),
    }));
    const errors: unknown[][] = [];
    const onError = vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args); });
    try {
      const { unmount } = render(<LaunchAtLoginSettings />);
      const toggle = await screen.findByRole('switch', { name: 'Launch Phase at login' });
      fireEvent.click(toggle);

      unmount();
      await act(async () => { rejectSet(new Error('shell down')); });

      // The rejected write settled on a dead component: no warning, no act error.
      expect(errors).toHaveLength(0);
      expect(screen.queryByRole('switch')).toBeNull();
    } finally {
      onError.mockRestore();
    }
  });
});
