// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupsSettings } from './BackupsSettings';
import { actions } from '../state/store';
import type { BackupEntry, PhaseBackupBridge } from '../lib/backupBridge';
import type { BackupNowResult } from '../state/autoBackup';

/**
 * The history surface is the only place a backup Phase took by itself is
 * REACHABLE. Automatic snapshots nobody can find are a folder, not a feature —
 * so what is pinned here is the route from a row to a restore, and that the
 * restore hands the ordinary import path an ordinary file.
 */

const bridgeMocks = vi.hoisted(() => ({ backupBridge: vi.fn() }));
vi.mock('../lib/backupBridge', async (original) => ({
  ...(await original<typeof import('../lib/backupBridge')>()),
  backupBridge: bridgeMocks.backupBridge,
}));

function entry(stamp: string, reason: BackupEntry['reason'] = 'auto', bytes = 4096): BackupEntry {
  return { name: `phase-backup-${stamp}-${reason}.json`, stamp, reason, bytes };
}

function installBridge(overrides: Partial<PhaseBackupBridge> = {}) {
  const bridge: PhaseBackupBridge = {
    available: true,
    list: vi.fn(async () => [entry('20260830-142530'), entry('20260829-090000', 'pre-import')]),
    write: vi.fn(async () => null),
    read: vi.fn(async () => '{"goals":[]}'),
    ...overrides,
  };
  bridgeMocks.backupBridge.mockReturnValue(bridge);
  return bridge;
}

function setup(props: Partial<Parameters<typeof BackupsSettings>[0]> = {}) {
  const onRestore = vi.fn();
  const onBackupNow = vi.fn(async (): Promise<BackupNowResult> => 'saved');
  render(createElement(BackupsSettings, { onRestore, onBackupNow, ...props }));
  return { onRestore, onBackupNow };
}

beforeEach(() => {
  bridgeMocks.backupBridge.mockReset();
});

afterEach(cleanup);

describe('BackupsSettings', () => {
  it('renders nothing at all in the plain browser — heading and copy included', () => {
    installBridge({ available: false });
    const { container } = render(
      createElement(BackupsSettings, {
        onRestore: vi.fn(),
        onBackupNow: vi.fn(async (): Promise<BackupNowResult> => 'saved'),
      }),
    );
    // The web build has no backup folder. The heading and the paragraph live
    // HERE rather than in SettingsModal precisely so they vanish with the list
    // they introduce — a "Backups" heading over a paragraph describing
    // versioned local copies, above nothing, describes a feature this build
    // does not have.
    expect(container.textContent).toBe('');
    expect(document.body.textContent).not.toContain('Backups');
  });

  it('carries its own heading on desktop, so the two halves cannot disagree', async () => {
    installBridge();
    setup();
    expect(await screen.findByRole('heading', { name: 'Backups' })).toBeTruthy();
  });

  it('lists what is on disk, newest first, with when and why', async () => {
    installBridge();
    setup();
    await screen.findByText('30 Aug 2026, 14:25');
    expect(screen.getByText('29 Aug 2026, 09:00')).toBeTruthy();
    expect(screen.getByText(/Before import/)).toBeTruthy();
    expect(screen.getByText(/Automatic/)).toBeTruthy();
  });

  it('says so plainly when there is nothing to list yet', async () => {
    installBridge({ list: vi.fn(async () => []) });
    setup();
    await screen.findByText(/No backups yet/i);
  });

  it('restores a row by handing the import path an ordinary file', async () => {
    const bridge = installBridge();
    const { onRestore } = setup();
    const row = await screen.findByText('30 Aug 2026, 14:25');
    await userEvent.click(
      screen.getAllByRole('button', { name: /restore/i })[0],
    );
    expect(row).toBeTruthy();

    await waitFor(() => expect(onRestore).toHaveBeenCalled());
    expect(bridge.read).toHaveBeenCalledWith('phase-backup-20260830-142530-auto.json');
    const file = onRestore.mock.calls[0][0] as File;
    // A File, not a parsed object: the restore goes through the SAME validated
    // import the file picker does, rather than a second reader that could
    // disagree with it about what a backup is.
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('phase-backup-20260830-142530-auto.json');
    await expect(file.text()).resolves.toBe('{"goals":[]}');
  });

  it('does not hand over a restore whose file could not be read', async () => {
    installBridge({ read: vi.fn(async () => null) });
    const { onRestore } = setup();
    await screen.findByText('30 Aug 2026, 14:25');
    await userEvent.click(screen.getAllByRole('button', { name: /restore/i })[0]);
    await screen.findByText(/couldn’t be read/i);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('takes a snapshot on demand and shows it in the list', async () => {
    const list = vi.fn(async () => [entry('20260830-142530')]);
    installBridge({ list });
    const { onBackupNow } = setup();
    await screen.findByText('30 Aug 2026, 14:25');

    list.mockResolvedValue([entry('20260830-160000', 'manual'), entry('20260830-142530')]);
    await userEvent.click(screen.getByRole('button', { name: /back up now/i }));
    await waitFor(() => expect(onBackupNow).toHaveBeenCalled());
    // A list that did not refresh would leave the user pressing again.
    await screen.findByText('30 Aug 2026, 16:00');
  });

  it('says so when the snapshot could not be written', async () => {
    installBridge();
    setup({ onBackupNow: vi.fn(async (): Promise<BackupNowResult> => 'failed') });
    await screen.findByText('30 Aug 2026, 14:25');
    await userEvent.click(screen.getByRole('button', { name: /back up now/i }));
    await screen.findByText(/couldn’t save/i);
  });

  /**
   * A second window holds a STALE view of the owner's database — that is what
   * the single-writer lock is for — so a backup written from it would launder
   * that stale view into the file someone later restores from. The refusal has
   * to name the real reason: reported as a save failure it would send someone
   * hunting a disk problem that does not exist.
   */
  it('names the other window rather than blaming the disk', async () => {
    installBridge();
    setup({ onBackupNow: vi.fn(async (): Promise<BackupNowResult> => 'not-owner') });
    await screen.findByText('30 Aug 2026, 14:25');
    await userEvent.click(screen.getByRole('button', { name: /back up now/i }));
    await screen.findByText(/another (tab|window)/i);
    expect(document.body.textContent).not.toContain('disk');
  });

  it('still lists what is on disk in a window that may not write', async () => {
    installBridge();
    setup({ onBackupNow: vi.fn(async (): Promise<BackupNowResult> => 'not-owner') });
    // Reading is not writing: the history is still worth showing, and a
    // restore from here goes through the store, which does its own lock check.
    expect(await screen.findByText('30 Aug 2026, 14:25')).toBeTruthy();
  });

  it('reports an unreachable folder rather than pretending it is empty', async () => {
    installBridge({ list: vi.fn(async () => { throw new Error('EACCES'); }) });
    setup();
    // `backupBridge` swallows its own failures, so a throw here is the
    // belt-and-braces case; either way the section must settle, never hang on
    // its skeleton.
    await waitFor(() => expect(screen.queryByTestId('backups-skeleton')).toBeNull());
  });
});

/**
 * The section's heading PROMISES something: "Phase keeps versioned copies of
 * everything on this Mac". While the scheduler is failing that is false, and
 * this is the surface where the falsehood costs the most — someone reads it,
 * believes they are covered, and finds out otherwise the day the database will
 * not open. So the promise has to yield to the fact.
 */
describe('while the scheduler is failing', () => {
  afterEach(() => { actions.setAutoBackupFailed(false); });

  it('says so, in the section that made the promise', async () => {
    installBridge();
    actions.setAutoBackupFailed(true);
    render(createElement(BackupsSettings, { onRestore: vi.fn(), onBackupNow: vi.fn(async () => 'saved' as BackupNowResult) }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/couldn.t|failed|not.*being saved/i);
  });

  it('stops claiming copies are being kept', async () => {
    installBridge();
    actions.setAutoBackupFailed(true);
    render(createElement(BackupsSettings, { onRestore: vi.fn(), onBackupNow: vi.fn(async () => 'saved' as BackupNowResult) }));
    await screen.findByRole('alert');
    expect(document.body.textContent, 'still promises versioned copies while failing')
      .not.toMatch(/Phase keeps versioned copies/i);
  });

  it('keeps the promise when the scheduler is healthy', async () => {
    installBridge();
    render(createElement(BackupsSettings, { onRestore: vi.fn(), onBackupNow: vi.fn(async () => 'saved' as BackupNowResult) }));
    await waitFor(() => expect(document.body.textContent).toMatch(/Phase keeps versioned copies/i));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leaves the manual outcome messages alone', async () => {
    // The manual notice is a different fact — what THIS press did — and the
    // standing warning must not swallow it.
    installBridge();
    actions.setAutoBackupFailed(true);
    const onBackupNow = vi.fn(async () => 'not-owner' as BackupNowResult);
    render(createElement(BackupsSettings, { onRestore: vi.fn(), onBackupNow }));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: /back up now/i }));
    await waitFor(() => expect(onBackupNow).toHaveBeenCalled());
    await waitFor(() => expect(document.body.textContent).toMatch(/another window|another tab/i));
  });
});
