import { Modal } from './Modal';
import { AvailabilitySettings } from '../views/plan/AvailabilitySettings';

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
 * utility menu or `⌘K`, never stumbled into.
 */
export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Working hours">
      <p className="text-ui text-muted mb-[12px] leading-[1.5]">
        The hours Phase may schedule into. Everything that reports free time —
        the week's capacity, where a dragged task lands, whether a goal still
        fits before its deadline — is measured against these.
      </p>
      <AvailabilitySettings />
    </Modal>
  );
}
