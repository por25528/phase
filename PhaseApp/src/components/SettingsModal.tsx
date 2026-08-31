import { Modal } from './Modal';
import { sectionLabel } from './sectionLabel';
import { LivesSettings } from '../views/goals/LivesSettings';
import { AssistantShortcutSettings } from './assistant/AssistantShortcutSettings';
import { LaunchAtLoginSettings } from './assistant/LaunchAtLoginSettings';
import { OverlaySettings } from './assistant/OverlaySettings';
import { BackupsSettings } from './BackupsSettings';
import type { BackupNowResult } from '../state/autoBackup';
import { CalendarSettings } from './CalendarSettings';
import { useAppStore } from '../state/store';

/**
 * Where the low-frequency system operations live.
 *
 * Working hours used to be the reason this dialog existed — they had been an
 * accordion in the Plan rail, sitting as a peer of the section used most while
 * planning. They are gone entirely now, and what is left is the class of thing
 * they were moved here to join.
 *
 * A dialog earns itself here for the reason §14 gives: this is provider-style
 * configuration, not routine editing, and it is reached deliberately from the
 * utility menu or `⌘K`, never stumbled into. Naming your lives belongs to the
 * same class — done once a semester, and it costs the board no chrome.
 */
export function SettingsModal({
  open,
  onClose,
  onRestoreBackup,
  onBackupNow,
}: {
  open: boolean;
  onClose: () => void;
  /** Hands one local snapshot to the ordinary import path, confirmation and all. */
  onRestoreBackup: (file: File) => void;
  /** Takes a manual snapshot through the same scheduler the automatic ones use. */
  onBackupNow: () => Promise<BackupNowResult>;
}) {
  const { assistantAccelerator, assistantShortcut, actions } = useAppStore();
  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <h3 className={`mb-[6px] ${sectionLabel}`}>Lives</h3>
      <p className="text-ui text-muted mb-[12px] leading-[1.5]">
        The handful of things you are doing at once. A goal belongs to one of
        them, or to none — an errand is nobody's project.
      </p>
      <LivesSettings />

      <h3 className={`mt-[20px] mb-[6px] ${sectionLabel}`}>Calendar</h3>
      <p className="text-ui text-muted mb-[12px] leading-[1.5]">
        Phase reads your Google Calendar so it stops putting work on top of
        time you have already committed. Read-only and one-way — it never
        writes to Google, and the events stay on this Mac.
      </p>
      <CalendarSettings />

      <h3 className={`mt-[20px] mb-[6px] ${sectionLabel}`}>Assistant shortcut</h3>
      <p className="text-ui text-muted mb-[12px] leading-[1.5]">
        Opens the assistant from anywhere on this Mac. If another app owns the
        chord — Spotlight usually owns ⌘ Space — Phase says so here rather than
        silently picking a different one.
      </p>
      <AssistantShortcutSettings
        accelerator={assistantAccelerator}
        status={assistantShortcut}
        onSave={(next) => {
          // The desktop shell re-registers via AssistantHost's push effect,
          // which reports the outcome back into `assistantShortcut`.
          actions.setAssistantAccelerator(next);
        }}
      />
      {/* Desktop only: the row renders nothing in the plain browser. */}
      <LaunchAtLoginSettings />
      <OverlaySettings />

      {/* Same rule, and the same reason it is HERE: a backup is provider-style
          configuration you look at twice a year, not routine editing. It sits
          last because the list is the only thing in this dialog that grows.

          It brings its OWN heading and copy, unlike every other section above.
          That is not an inconsistency to tidy: this is the one section that can
          be absent entirely — the browser build has no backup folder — and a
          heading owned by this file could not vanish with it. */}
      <BackupsSettings onRestore={onRestoreBackup} onBackupNow={onBackupNow} />
    </Modal>
  );
}
