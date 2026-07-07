import { useState, useRef, useEffect } from 'react';
import type { Goal } from '../../db/types';
import { Modal } from '../../components/Modal';
import { todayStr } from '../../lib/dates';
import { buildAiPrompt, parseGoalImport, FORMAT_HINT } from '../../lib/goalImport';
import { fieldCls, labelCls, primaryBtn, ghostBtn } from './styles';

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
    <Modal open={open} onClose={onClose} title="Import goal">
      <div className="flex flex-col gap-[14px]">
        <p className="text-[.82rem] text-muted leading-[1.5]">
          Paste JSON to create a goal with its subgoals. No AI handy? Copy the prompt below
          and ask any AI to plan a goal for you, then paste its reply here.
        </p>

        <div className="flex items-center gap-[10px]">
          <button className={primaryBtn} onClick={copyPrompt}>
            {copied ? 'Copied!' : 'Copy AI prompt'}
          </button>
          <span className="text-[.74rem] text-faint">Paste into ChatGPT, Claude, etc.</span>
        </div>

        <details className="rounded-field border border-line-2 px-[10px] py-[8px]">
          <summary className="text-[.76rem] font-medium text-muted cursor-pointer select-none">
            Format reference
          </summary>
          <pre className="mt-[8px] text-[.68rem] leading-[1.45] text-ink-soft font-mono overflow-x-auto whitespace-pre">
            {FORMAT_HINT}
          </pre>
        </details>

        <div className="flex flex-col gap-[5px]">
          <label className={labelCls}>Paste goal JSON</label>
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); if (error) setError(null); }}
            rows={8}
            placeholder={'{ "title": "…", "subgoals": ["…"] }'}
            className={`${fieldCls} w-full resize-y font-mono text-[.76rem] leading-[1.5]`}
          />
          {error && <p className="text-[.78rem] text-[#b4453a]">{error}</p>}
        </div>

        <div className="flex items-center gap-[8px] mt-[2px]">
          <button className={primaryBtn} onClick={submit} disabled={!text.trim()}>
            Add to board
          </button>
          <button className={ghostBtn} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
