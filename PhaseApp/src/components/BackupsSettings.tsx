import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  backupBridge, describeBackup, backupReasonLabel, type BackupEntry,
} from '../lib/backupBridge';
import { secondaryBtn } from './dialogStyles';
import { sectionLabel } from './sectionLabel';
import type { BackupNowResult } from '../state/autoBackup';

/**
 * The Backups section in Settings — where a snapshot Phase took by itself
 * becomes something a person can reach.
 *
 * An automatic backup nobody can find is a folder, not a feature, and the two
 * halves of that are equally load-bearing: the LIST says the snapshots exist,
 * and Restore is the route back. Both are desktop-only, so the whole section
 * renders null in the plain browser, exactly as `LaunchAtLoginSettings` does —
 * a list that could never fill, above a button that could never write, would
 * promise a capability the web build does not have.
 *
 * It carries its own HEADING and its own introductory paragraph, which the
 * other Settings sections do not. That is the price of being able to vanish: a
 * heading owned by `SettingsModal` cannot disappear with the section it
 * introduces, so the browser build showed "Backups" over a paragraph promising
 * versioned local copies, above nothing at all. One component, one decision
 * about whether any of this exists.
 *
 * Restore hands `onRestore` a real `File`, and that is deliberate: it goes
 * through the SAME `ConfirmImportModal` and the same validated
 * `importStateFromFile` the file picker does. A second reader for "our own"
 * backups would be a second opinion about what a backup is, and the one that
 * drifts is always the one with fewer callers. It is also why restoring is
 * still gated behind the typed REPLACE: reading a file Phase wrote does not
 * make replacing everything with it any less irreversible.
 *
 * `onBackupNow` is a CALLBACK rather than a direct `bridge.write`, so a manual
 * snapshot spends the same scheduler the automatic ones do. Writing straight
 * past it would leave the interval thinking nothing had been saved, and the
 * next automatic snapshot would land a minute later on identical data.
 */

type Notice = { tone: 'muted' | 'warn'; text: string } | null;

/**
 * One notice per outcome, in one place, so the three cannot drift into two.
 * `saved` says nothing: the new row appearing at the top of the list is the
 * report, and a line saying so beside it would be the same fact twice.
 */
const BACKUP_NOW_NOTICE: Record<BackupNowResult, Notice> = {
  saved: null,
  failed: { tone: 'warn', text: 'Couldn’t save a backup to this Mac.' },
  'not-owner': {
    tone: 'warn',
    text: 'Phase is open in another tab, which owns your data — back up from there.',
  },
};

/**
 * The section's own heading and its one paragraph.
 *
 * Inside this file rather than in `SettingsModal` so they cannot outlive the
 * list they introduce; see the note on the component below.
 */
function Heading() {
  return (
    <>
      <h3 className={`mt-[20px] mb-[6px] ${sectionLabel}`}>Backups</h3>
      <p className="text-ui text-muted mb-[12px] leading-[1.5]">
        Phase keeps versioned copies of everything on this Mac, and takes one
        before any import replaces your data. Restoring goes through the same
        confirmation an imported file does.
      </p>
    </>
  );
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function BackupsSettings({
  onRestore,
  onBackupNow,
}: {
  /** Hands one snapshot to the ordinary import path, confirmation and all. */
  onRestore: (file: File) => void;
  /**
   * Takes a manual snapshot through the scheduler.
   *
   * THREE answers, not two. `not-owner` is a second window's turn rather than
   * a disk problem, and reporting it as a save failure would send someone
   * hunting free space over another tab being open.
   */
  onBackupNow: () => Promise<BackupNowResult>;
}) {
  const bridge = useMemo(() => backupBridge(), []);
  const [entries, setEntries] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  // One guard shared by every async path here: a promise that settles after
  // the dialog closes must not setState on a dead component.
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const listed = await bridge.list();
      if (!mountedRef.current) return;
      setEntries(listed);
    } catch {
      // `backupBridge` swallows its own failures, so this is belt and braces —
      // but a section stuck on its skeleton would be worse than an empty one.
      if (!mountedRef.current) return;
      setEntries([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    mountedRef.current = true;
    if (!bridge.available) return;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [bridge, refresh]);

  if (!bridge.available) return null;

  if (loading) {
    // One quiet bar where the list will land — a skeleton, never a spinner,
    // and never taller than what it stands in for. The heading is already
    // drawn above it: a section that appeared a beat after the rest of the
    // dialog would read as the dialog still loading.
    return (
      <>
        <Heading />
        <div aria-hidden="true" data-testid="backups-skeleton" className="h-[42px] rounded-field bg-fill" />
      </>
    );
  }

  const backUpNow = () => {
    setBusy(true);
    setNotice(null);
    void onBackupNow()
      .then(async (result) => {
        if (!mountedRef.current) return;
        // Refresh either way: a failed write can still follow a successful
        // prune, and a list that did not move leaves the user pressing again.
        await refresh();
        if (!mountedRef.current) return;
        setNotice(BACKUP_NOW_NOTICE[result]);
      })
      .catch(() => {
        if (mountedRef.current) setNotice(BACKUP_NOW_NOTICE.failed);
      })
      .finally(() => {
        if (mountedRef.current) setBusy(false);
      });
  };

  const restore = (entry: BackupEntry) => {
    setBusy(true);
    setNotice(null);
    void bridge.read(entry.name)
      .then((text) => {
        if (!mountedRef.current) return;
        if (text === null) {
          setNotice({ tone: 'warn', text: 'That backup couldn’t be read.' });
          return;
        }
        onRestore(new File([text], entry.name, { type: 'application/json' }));
      })
      .catch(() => {
        if (mountedRef.current) setNotice({ tone: 'warn', text: 'That backup couldn’t be read.' });
      })
      .finally(() => {
        if (mountedRef.current) setBusy(false);
      });
  };

  return (
    <>
      <Heading />
      <div className="flex flex-col gap-[8px]">
        <div className="flex items-center gap-[8px]">
          <button type="button" className={secondaryBtn} disabled={busy} onClick={backUpNow}>
            Back up now
          </button>
        </div>

        {entries.length === 0 ? (
          <p className="text-meta text-muted">
            No backups yet. Phase saves one shortly after you start working, and again
            at most every half hour.
          </p>
        ) : (
          <ul className="flex flex-col border border-line rounded-field overflow-hidden">
            {entries.map((entry) => (
              <li
                key={entry.name}
                className="flex items-center gap-[12px] px-[10px] py-[7px] border-b border-line-soft last:border-b-0"
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-ui text-ink truncate">{describeBackup(entry.stamp)}</span>
                  <span className="block text-meta text-muted">
                    {backupReasonLabel(entry.reason)} · {sizeLabel(entry.bytes)}
                  </span>
                </span>
                <button
                  type="button"
                  className={secondaryBtn}
                  disabled={busy}
                  aria-label={`Restore the backup from ${describeBackup(entry.stamp)}`}
                  onClick={() => restore(entry)}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}

        {notice && (
          <p
            role={notice.tone === 'warn' ? 'alert' : 'status'}
            className={`text-meta ${notice.tone === 'warn' ? 'text-warn' : 'text-muted'}`}
          >
            {notice.text}
          </p>
        )}
      </div>
    </>
  );
}
