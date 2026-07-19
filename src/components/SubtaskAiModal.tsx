import { useState, useRef, useEffect } from 'react';
import type { Goal, GoalNode } from '../db/types';
import type { useAppStore } from '../state/store';
import { Modal } from './Modal';
import { todayStr } from '../lib/dates';
import { buildSubtaskPrompt, parseSubtasks } from '../lib/goalImport';

const field =
  'rounded-field border border-line-2 px-[8px] py-[5px] text-[.8rem] text-ink bg-transparent outline-none focus-visible:border-accent';
const label = 'text-[.72rem] font-medium text-muted';
const primary =
  'text-[.84rem] font-semibold text-paper bg-ink px-[13px] py-[7px] rounded-field hover:bg-ink-hover disabled:opacity-40';
const ghost = 'text-[.84rem] text-muted px-[10px] py-[7px] rounded-field hover:bg-hover';

interface OpenLeaf {
  id: string;
  title: string;
  path: string; // container context, for disambiguation
}

// Flatten to the open (breakable) leaves, carrying their container path.
function collectOpenLeaves(nodes: GoalNode[], prefix = '', out: OpenLeaf[] = []): OpenLeaf[] {
  for (const n of nodes) {
    if (n.children && n.children.length) {
      collectOpenLeaves(n.children, prefix ? `${prefix} / ${n.title}` : n.title, out);
    } else if (!n.done) {
      out.push({ id: n.id, title: n.title, path: prefix });
    }
  }
  return out;
}

export function SubtaskAiModal({
  open,
  onClose,
  goal,
  defaultStepId,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  goal: Goal;
  defaultStepId?: string | null;
  actions: ReturnType<typeof useAppStore>['actions'];
}) {
  const leaves = collectOpenLeaves(goal.nodes);
  const [stepId, setStepId] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const fallback = leaves[0]?.id ?? '';
    setStepId(defaultStepId && leaves.some((l) => l.id === defaultStepId) ? defaultStepId : fallback);
    setText('');
    setError(null);
    setCopied(false);
    // leaves is derived from goal.nodes; recompute only when the modal (re)opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal.id]);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const step = leaves.find((l) => l.id === stepId) ?? null;

  function copyPrompt() {
    if (!step) return;
    navigator.clipboard?.writeText(buildSubtaskPrompt(goal.title, step.title, todayStr())).then(
      () => {
        setCopied(true);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 1600);
      },
      () => setError('Could not access the clipboard.'),
    );
  }

  function submit() {
    if (!step) return;
    const result = parseSubtasks(text);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    actions.addChildren(step.id, result.titles);
    actions.showToast(`Added ${result.titles.length} subtask${result.titles.length === 1 ? '' : 's'}`);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Break a step into daily tasks">
      <div className="flex flex-col gap-[14px]">
        {leaves.length === 0 ? (
          <p className="text-[.85rem] text-muted">
            This project has no open steps to break down — add a step first.
          </p>
        ) : (
          <>
            <p className="text-[.82rem] text-muted leading-[1.5]">
              Pick a step, copy the prompt, and ask any AI to split it into subtasks each doable in a day.
              Paste its reply below to add them under the step.
            </p>

            <div className="flex flex-col gap-[5px]">
              <label className={label}>Step</label>
              <select value={stepId} onChange={(e) => setStepId(e.target.value)} className={`${field} w-full`}>
                {leaves.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.path ? `${l.path} / ${l.title}` : l.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-[10px]">
              <button className={primary} onClick={copyPrompt} disabled={!step}>
                {copied ? 'Copied!' : 'Copy AI prompt'}
              </button>
              <span className="text-[.74rem] text-faint">Paste into ChatGPT, Claude, etc.</span>
            </div>

            <div className="flex flex-col gap-[5px]">
              <label className={label}>Paste subtasks JSON</label>
              <textarea
                value={text}
                onChange={(e) => { setText(e.target.value); if (error) setError(null); }}
                rows={6}
                placeholder={'["First subtask", "Second subtask", "Third subtask"]'}
                className={`${field} w-full resize-y font-mono text-[.76rem] leading-[1.5]`}
              />
              {error && <p className="text-[.78rem] text-[#b4453a]">{error}</p>}
            </div>

            <div className="flex items-center gap-[8px] mt-[2px]">
              <button className={primary} onClick={submit} disabled={!text.trim() || !step}>
                Add subtasks
              </button>
              <button className={ghost} onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
