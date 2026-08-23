import { Modal } from './Modal';
import { sectionLabel } from './sectionLabel';
import { LivesSettings } from '../views/goals/LivesSettings';
import { AssistantShortcutSettings } from './assistant/AssistantShortcutSettings';
import { LaunchAtLoginSettings } from './assistant/LaunchAtLoginSettings';
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
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { assistantAccelerator, assistantShortcut, actions } = useAppStore();
  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <h3 className={`mb-[6px] ${sectionLabel}`}>Lives</h3>
      <p className="text-ui text-muted mb-[12px] leading-[1.5]">
        The handful of things you are doing at once. A goal belongs to one of
        them, or to none — an errand is nobody's project.
      </p>
      <LivesSettings />

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
    </Modal>
  );
}
