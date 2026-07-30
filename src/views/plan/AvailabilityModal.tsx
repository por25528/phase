import { Modal } from '../../components/Modal';
import { AvailabilitySettings } from './AvailabilitySettings';

/**
 * Availability lives behind a Modal so Plan owns its own working-hours entry
 * point. Before this it was only reachable through the week overlay, which is
 * why Plan had to open that overlay to let you set a single number.
 */
export function AvailabilityModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Working hours">
      <AvailabilitySettings />
    </Modal>
  );
}
