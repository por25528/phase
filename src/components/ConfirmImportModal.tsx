import { useEffect, useState } from 'react';
import { Modal } from './Modal';

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
        This replaces every project, habit and task currently in Phase with the contents of{' '}
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
          className="mt-[6px] w-full bg-field border border-line-2 rounded-field px-[10px] py-[7px] text-body text-ink outline-none focus:border-accent"
        />
      </label>
      <div className="mt-[18px] flex justify-end gap-[8px]">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[24px] px-[12px] py-[6px] rounded-field text-ui text-muted hover:bg-hover hover:text-ink"
        >
          Cancel
        </button>
        {/* Same words as the menu item that opened it. */}
        <button
          type="button"
          disabled={!armed}
          onClick={onConfirm}
          className="min-h-[24px] px-[12px] py-[6px] rounded-field text-ui font-semibold bg-accent text-accent-contrast hover:bg-accent-deep disabled:opacity-40 disabled:pointer-events-none"
        >
          Import backup
        </button>
      </div>
    </Modal>
  );
}
