import { useState, useRef, useEffect } from 'react';
import type { Goal } from '../../db/types';
import { Modal } from '../../components/Modal';
import { todayStr } from '../../lib/dates';
import { buildAiPrompt, parseGoalImport, FORMAT_HINT } from '../../lib/goalImport';
import {
  fieldCls, primaryBtn, ghostBtn, secondaryBtn,
  dialogBar, dialogBody, dialogLine, dialogLineTall,
  dialogLineKey, dialogLineKeyTall, dialogLineValue,
} from '../../components/dialogStyles';
import { captionLabel } from '../../components/sectionLabel';

export function ImportGoalModal({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (goals: Goal[]) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setText('');
    setError(null);
    setCopied(false);
  }, [open]);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  function copyPrompt() {
    navigator.clipboard?.writeText(buildAiPrompt(todayStr())).then(
      () => {
        setCopied(true);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 1600);
      },
      () => setError('Could not access the clipboard.'),
    );
  }

  function submit() {
    const result = parseGoalImport(text, todayStr());
    if ('error' in result) {
      setError(result.error);
      return;
    }
    onImport(result.goals);
  }

  return (
    <Modal open={open} onClose={onClose} title="Import goal" verb="Import">
      <div className={dialogBody}>
        {/*
          Prose, and it stays prose. The key column is a register of the
          dialog's FIELDS, and a paragraph explaining what the dialog is for is
          not one of them — giving it a key would make "ABOUT" the loudest word
          on a surface whose job is to receive a paste.
        */}
        <p className="text-body text-muted leading-[1.5] pb-[12px]">
          Paste JSON to create a goal with its tasks. No AI handy? Copy the prompt below
          and ask any AI to plan a goal for you, then paste its reply here.
        </p>

        <div className={dialogLine}>
          <span className={`${dialogLineKey} ${captionLabel}`} aria-hidden="true">Prompt</span>
          <span className={dialogLineValue}>
            {/* A nested row, never `${dialogLineValue} flex` — see that
                constant: appending `flex` to a `grid` leaves which display
                applies to Tailwind's emit order. */}
            <span className="flex items-center gap-[10px]">
              {/* Outlined, not filled. This is a convenience on the way to the
                  dialog's actual job, and wearing the same ink button as "Import
                  goal" put the heavier-looking of the two commit-shaped buttons on
                  the lesser action. */}
              <button type="button" className={secondaryBtn} onClick={copyPrompt}>
                {copied ? 'Copied' : 'Copy AI prompt'}
              </button>
              <span className="text-compact text-muted">Paste into ChatGPT, Claude, etc.</span>
            </span>
          </span>
        </div>

        <div className={dialogLine}>
          <span className={`${dialogLineKey} ${captionLabel}`} aria-hidden="true">Format</span>
          <span className={dialogLineValue}>
            {/* Borderless now. The box around it was doing the job the line's
                own key and hairline already do, and two nested outlines inside
                one row is what made the old body read as a stack of cards. */}
            <details>
              <summary className="text-compact font-medium text-muted cursor-pointer select-none">
                Format reference
              </summary>
              <pre className="mt-[8px] text-badge leading-[1.45] text-ink-soft font-mono overflow-x-auto whitespace-pre">
                {FORMAT_HINT}
              </pre>
            </details>
          </span>
        </div>

        <div className={dialogLineTall}>
          <span className={`${dialogLineKeyTall} ${captionLabel}`} aria-hidden="true">JSON</span>
          <span className={dialogLineValue}>
            <textarea
              aria-label="Paste goal JSON"
              value={text}
              onChange={(e) => { setText(e.target.value); if (error) setError(null); }}
              rows={8}
              placeholder={'{ "title": "…", "subgoals": ["…"] }'}
              className={`${fieldCls} resize-y font-mono text-compact leading-[1.5]`}
            />
            {error && <p role="alert" className="mt-[5px] text-ui text-warn">{error}</p>}
          </span>
        </div>
      </div>

      {/* "Import goal" — the words on the dialog and on the menu item that
          opened it. "Add to board" was a third name for one action, in a
          codebase whose other import dialog already carries a comment insisting
          the button repeat the menu. */}
      <div className={dialogBar}>
        <button type="button" className={ghostBtn} onClick={onClose}>Cancel</button>
        <button type="button" className={primaryBtn} onClick={submit} disabled={!text.trim()}>
          Import goal
        </button>
      </div>
    </Modal>
  );
}
