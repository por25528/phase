// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * The fatal screen is the one surface that renders BECAUSE the app failed, so
 * every promise it makes has to be one it can keep from there.
 *
 * It used to tell people to "export a backup from the sidebar" — a sidebar
 * that has not existed for a long time, reached through a store that has just
 * crashed. That is worse than saying nothing: it sends someone looking for a
 * control that is not there while the data they want is one click away.
 *
 * So the recovery is ON this screen, and it reads the DATABASE rather than the
 * store — the store is the thing that broke, and asking it for the data would
 * be asking the fault for the rescue.
 */

const dbMocks = vi.hoisted(() => ({
  emergencyBackupText: vi.fn(async () => '{"goals":[]}'),
  downloadBackupText: vi.fn(),
}));

vi.mock('../db/db', () => dbMocks);

function Boom(): never {
  throw new Error('render exploded');
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dbMocks.emergencyBackupText.mockClear();
  dbMocks.downloadBackupText.mockClear();
  dbMocks.emergencyBackupText.mockResolvedValue('{"goals":[]}');
  // React logs the caught error itself; the noise is not the test's subject.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  cleanup();
});

function crash() {
  return render(createElement(ErrorBoundary, { children: createElement(Boom) }));
}

describe('ErrorBoundary', () => {
  it('renders its children while nothing has thrown', () => {
    render(createElement(ErrorBoundary, { children: createElement('p', null, 'the app') }));
    expect(screen.getByText('the app')).toBeTruthy();
  });

  it('says nothing about a sidebar that does not exist', () => {
    crash();
    expect(screen.getByText('Something broke.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('sidebar');
  });

  it('offers a backup that reads the database, not the store that just crashed', async () => {
    crash();
    await userEvent.click(screen.getByRole('button', { name: /save a backup/i }));
    await waitFor(() => expect(dbMocks.emergencyBackupText).toHaveBeenCalled());
    expect(dbMocks.downloadBackupText).toHaveBeenCalledWith(
      '{"goals":[]}',
      expect.stringMatching(/^phase-recovery-\d{4}-\d{2}-\d{2}\.json$/),
    );
  });

  it('answers the press rather than leaving it silent', async () => {
    crash();
    await userEvent.click(screen.getByRole('button', { name: /save a backup/i }));
    await screen.findByRole('status');
  });

  /**
   * `downloadBackupText` clicks an anchor. That starts a download and reports
   * NOTHING back — not the destination, not a cancelled save prompt, not a
   * disk that filled up. The screen used to answer "Saved to your downloads",
   * which is a claim it cannot make in either Electron or a browser, on the
   * one surface whose entire job is to not lie about whether data is safe.
   */
  describe('what it can honestly say about the download', () => {
    const started = async () => {
      crash();
      await userEvent.click(screen.getByRole('button', { name: /save a backup/i }));
      return screen.findByRole('status');
    };

    it('says the download started, not that a file was saved', async () => {
      const status = await started();
      expect(status.textContent).toMatch(/started/i);
      expect(status.textContent, 'claims a completed save').not.toMatch(/\bsaved\b/i);
    });

    it('names no destination it cannot know', async () => {
      const status = await started();
      // "your downloads" was the specific lie: Electron may put it anywhere,
      // and a browser may have asked and been cancelled.
      expect(status.textContent).not.toMatch(/your downloads/i);
    });

    it('tells the user to finish a save prompt, which only they can see', async () => {
      const status = await started();
      expect(status.textContent).toMatch(/prompt/i);
    });

    it('says the outcome is unconfirmed, so nobody reloads on a guess', async () => {
      const status = await started();
      // The whole point of the screen: reloading in the belief you have a copy
      // is the one mistake it must not cause.
      expect(status.textContent).toMatch(/can.t confirm|unconfirmed|check/i);
    });

    it('still names the file, which is the one fact it does know', async () => {
      const status = await started();
      expect(dbMocks.downloadBackupText).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/^phase-recovery-\d{4}-\d{2}-\d{2}\.json$/),
      );
      expect(status.textContent).toMatch(/phase-recovery-/);
    });
  });

  it('says so plainly when the database cannot be read either', async () => {
    dbMocks.emergencyBackupText.mockRejectedValueOnce(new Error('IndexedDB gone'));
    crash();
    await userEvent.click(screen.getByRole('button', { name: /save a backup/i }));
    // The one thing this screen must never do is claim a rescue that did not
    // happen: a file the user thinks they have is worse than none.
    await screen.findByText(/couldn’t read/i);
    expect(dbMocks.downloadBackupText).not.toHaveBeenCalled();
  });

  it('keeps Reload as the other way out', () => {
    crash();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('cannot be double-fired into two downloads', async () => {
    let release: (text: string) => void = () => {};
    dbMocks.emergencyBackupText.mockReturnValueOnce(
      new Promise<string>((resolve) => { release = resolve; }),
    );
    crash();
    const button = screen.getByRole('button', { name: /save a backup/i });
    await userEvent.click(button);
    await userEvent.click(button);
    release('{"goals":[]}');
    await waitFor(() => expect(dbMocks.downloadBackupText).toHaveBeenCalledTimes(1));
    expect(dbMocks.emergencyBackupText).toHaveBeenCalledTimes(1);
  });
});
