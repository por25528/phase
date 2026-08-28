// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateBanner } from './UpdateBanner';
import type { PhaseUpdateBridge, UpdateInfo } from '../lib/updateBridge';

/**
 * This jsdom build answers `undefined` for `window.localStorage` — the getter
 * is present and the property is `in window`, so a `typeof` guard would not
 * have caught it. The banner's whole dismissal contract is storage, so the
 * suite installs its own in-memory one rather than asserting nothing.
 * (`theme.ts` documents the mirror-image hazard in production: storage that is
 * present but whose methods throw, in private mode. The component try/catches
 * for the same reason.)
 */
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
});

function bridgeWith(result: UpdateInfo | null, available = true): PhaseUpdateBridge {
  return { available, check: vi.fn(async () => result) };
}

const RELEASE = {
  version: '0.2.0',
  url: 'https://github.com/por25528/phase/releases/tag/v0.2.0',
};

describe('UpdateBanner', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('shows the notice with a link to the release', async () => {
    render(<UpdateBanner bridge={bridgeWith(RELEASE)} />);
    expect(await screen.findByText(/Phase 0\.2\.0 is available/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download' }).getAttribute('href')).toBe(RELEASE.url);
  });

  it('renders nothing when up to date', async () => {
    const bridge = bridgeWith(null);
    const { container } = render(<UpdateBanner bridge={bridge} />);
    await waitFor(() => expect(bridge.check).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('never calls through when the bridge is unavailable', async () => {
    const bridge = bridgeWith(RELEASE, false);
    const { container } = render(<UpdateBanner bridge={bridge} />);
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(bridge.check).not.toHaveBeenCalled();
  });

  it('dismiss hides the notice and remembers the version', async () => {
    render(<UpdateBanner bridge={bridgeWith(RELEASE)} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss update notice' }));
    expect(screen.queryByText(/is available/)).toBeNull();
    expect(localStorage.getItem('phase-update-dismissed')).toBe('0.2.0');
  });

  it('stays hidden for a version already dismissed', async () => {
    localStorage.setItem('phase-update-dismissed', '0.2.0');
    const bridge = bridgeWith(RELEASE);
    const { container } = render(<UpdateBanner bridge={bridge} />);
    await waitFor(() => expect(bridge.check).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('shows again for a NEWER version than the dismissed one', async () => {
    localStorage.setItem('phase-update-dismissed', '0.1.5');
    render(<UpdateBanner bridge={bridgeWith(RELEASE)} />);
    expect(await screen.findByText(/Phase 0\.2\.0 is available/)).toBeTruthy();
  });
});
