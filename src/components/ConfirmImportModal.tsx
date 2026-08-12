import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { dangerBtn, ghostBtn, dialogFooter, fieldCls } from './dialogStyles';

/**
 * The one destructive action in Phase that cannot be undone.
 *
 * Everything else that destroys user data — deleting a project, a step, a
 * habit, a task, clearing a time log — deliberately has NO confirmation
 * dialog, because it has a real undo: the toast names what went and holds for
 * 15 seconds. That trade is correct and this modal does not change it.
 *
 * Import is the exception. `importBackup` clears `undoStack` and `pendingUndo`
 * by design (an import is a generation boundary — a whole-slice restore armed
 * against the previous dataset would overwrite the imported one), so the safety
 * net every delete relies on is the very thing this action removes. It was
 * guarded by a bare `window.confirm()`: one keystroke, native OS chrome, and
 * nothing to stop a mis-aimed Return.
 *
 * So the friction lives here instead, and it is typed rather than clicked —
 * the point is to make the user read the filename.
 */
const PHRASE = 'REPLACE';

export function ConfirmImportModal({
  open,
  fileName,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  fileName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const armed = typed.trim().toUpperCase() === PHRASE;

  // Reset between openings: a modal that reopens still armed from last time is
  // a confirmation in name only.
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  return (
    <Modal open={open} onClose={onCancel} title="Import backup">
      <p className="text-body text-ink-soft leading-[1.6]">
        This replaces every goal, habit and task currently in Phase with the contents of{' '}
        <span className="text-ink font-semibold">{fileName}</span>. It cannot be undone.
      </p>
      <label className="mt-[16px] block text-body text-ink-soft">
        Type <span className="font-mono text-ui text-ink">{PHRASE}</span> to continue.
        <input
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && armed) onConfirm();
          }}
          className={`mt-[6px] ${fieldCls}`}
        />
      </label>
      <div className={dialogFooter}>
        <button type="button" onClick={onCancel} className={ghostBtn}>
          Cancel
        </button>
        {/* Same words as the menu item that opened it — and the app's only
            coloured button, because this is the app's only action with no undo
            behind it. It wore `accent` before, which index.css defines as
            ACTION: the same meaning every other dialog's commit button carries,
            so the colour marked nothing. `warn` means trouble. */}
        <button type="button" disabled={!armed} onClick={onConfirm} className={dangerBtn}>
          Import backup
        </button>
      </div>
    </Modal>
  );
}
