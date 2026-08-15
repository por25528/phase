import { Modal } from './Modal';
import { sectionLabel } from './sectionLabel';
import { AvailabilitySettings } from '../views/plan/AvailabilitySettings';
import { LivesSettings } from '../views/goals/LivesSettings';
import { AssistantShortcutSettings } from './assistant/AssistantShortcutSettings';
import { LaunchAtLoginSettings } from './assistant/LaunchAtLoginSettings';
import { useAppStore } from '../state/store';

/**
 * Where the low-frequency system operations live.
 *
 * Working hours were an accordion in the Plan rail, sitting as a peer of "To
 * plan" — the one section used repeatedly while planning — even though a
 * person edits their availability roughly never after the first week. The rail
 * is 249px of the most valuable column on the busiest screen; a settings form
 * is not what it is for.
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

      <h3 className={`mt-[20px] mb-[6px] ${sectionLabel}`}>Working hours</h3>
      <p className="text-ui text-muted mb-[12px] leading-[1.5]">
        The hours Phase may schedule into. Everything that reports free time —
        the week's capacity, where a dragged task lands, whether a goal still
        fits before its deadline — is measured against these.
      </p>
      <AvailabilitySettings />

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
