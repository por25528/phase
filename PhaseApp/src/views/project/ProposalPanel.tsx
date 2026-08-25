import { useEffect, useId, useRef, useState } from 'react';
import type { Goal, GoalNode } from '../../db/types';
import type { useAppStore } from '../../state/store';
import { IconSparkle, IconX } from '../../components/Icons';
import { fmtMinutes } from '../../lib/effort';
import { buildSubtaskPrompt } from '../../lib/goalImport';
import { acceptedRows, parseProposal, type ProposalRow } from '../../lib/proposal';
import { formatEstimateValue, parseEstimateInput } from '../../lib/estimateInput';
import { todayStr } from '../../lib/dates';
import { dayLabel } from '../../lib/todayPlan';

/**
 * A proposed breakdown, inline, under the task it belongs to.
 *
 * What this replaces was a centred dialog whose body had to EXPLAIN its own
 * workflow: pick a task from a dropdown you had already picked, copy a prompt,
 * leave Phase, choose a model, paste, wait, copy the reply, come back, paste it
 * into a field that showed you JSON, read a parser preview, press "Add
 * subtasks". A heavy user does that once and then writes vague tasks instead,
 * which is worse than having no feature.
 *
 * The round trip is still here, because Phase has no provider and pretending
 * otherwise would be the same dishonesty one layer up. What changed is
 * everything around it: the panel is attached to the task, every proposed row
 * is editable and can be un-ticked, estimates come through priced, and
 * accepting is one undoable write. When a provider does land it replaces the
 * paste box and nothing else — the acceptance surface is already the right
 * shape.
 */
export function ProposalPanel({
  goal,
  node,
  actions,
  freeDay,
  onClose,
}: {
  goal: Goal;
  node: GoalNode;
  actions: ReturnType<typeof useAppStore>['actions'];
  /**
   * The next day with a run long enough to sit down in, for pricing the
   * breakdown against reality. Absent when no day inside the horizon has one —
   * say nothing rather than guess.
   */
  freeDay?: { date: string; gapMin: number };
  onClose: () => void;
}) {
  const [raw, setRaw] = useState('');
  const [rows, setRows] = useState<ProposalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const idBase = useId();

  useEffect(() => {
    const t = setTimeout(() => pasteRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  // A new subject means a new proposal. Leaving the old rows up under a
  // different task's name is the one way this could create work nobody asked
  // for.
  useEffect(() => {
    setRaw('');
    setRows(null);
    setError(null);
  }, [node.id]);

  function read(text: string): void {
    const parsed = parseProposal(text, (i) => `${idBase}-${i}`);
    if ('error' in parsed) {
      setError(parsed.error);
      setRows(null);
      return;
    }
    setError(null);
    setRows(parsed.rows);
  }

  function patch(id: string, change: Partial<ProposalRow>): void {
    setRows((current) => current?.map((r) => (r.id === id ? { ...r, ...change } : r)) ?? null);
  }

  function accept(): void {
    const taking = acceptedRows(rows ?? []);
    if (taking.length === 0) return;
    actions.addChildren(node.id, taking.map((r) => ({ title: r.title, estimateMin: r.estimateMin })));
    actions.showToast(`Added ${taking.length} subtask${taking.length === 1 ? '' : 's'}`);
    onClose();
  }

  const accepted = acceptedRows(rows ?? []);
  const taking = accepted.length;
  // Unestimated rows count as zero in the total; disclosing their count beside
  // it makes clear what the total does not capture.
  const takingMin = accepted.reduce((n, r) => n + (r.estimateMin ?? 0), 0);
  const unpriced = accepted.filter((r) => r.estimateMin === undefined).length;

  return (
    <div className="mt-[8px] mb-[10px] border border-line-2 rounded-card bg-panel p-[12px]">
      <div className="flex items-center gap-[8px] mb-[8px]">
        <span className="text-accent inline-flex" aria-hidden="true"><IconSparkle size={12} /></span>
        <h3 className="text-ui font-semibold text-ink flex-1 min-w-0 truncate">
          Break down “{node.title}”
        </h3>
        <button
          type="button"
          aria-label="Dismiss the proposal"
          onClick={onClose}
          className="text-muted hover:text-ink px-[4px] min-h-[24px] inline-flex items-center rounded-[6px] hover:bg-hover"
        >
          <IconX size={13} />
        </button>
      </div>

      {rows === null ? (
        <>
          <p className="text-meta text-muted mb-[7px] leading-[1.5]">
            No AI is connected to Phase yet, so this hands you the prompt and takes the
            reply. Paste a list — one line each, a trailing <code>45m</code> becomes the
            estimate.
          </p>
          <div className="flex items-center gap-[6px] mb-[7px]">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(
                  buildSubtaskPrompt(goal.title, node.title, todayStr()),
                ).then(() => setCopied(true), () => setCopied(false));
              }}
              className="text-meta font-semibold text-accent-deep px-[8px] py-[4px] rounded-field hover:bg-accent-tint"
            >
              {copied ? 'Prompt copied' : 'Copy the prompt'}
            </button>
          </div>
          <textarea
            ref={pasteRef}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onPaste={(e) => {
              // Parse on paste rather than behind a button. The button was one
              // more step in a flow that already had nine, and there is nothing
              // to decide between pasting and seeing what was understood.
              const text = e.clipboardData.getData('text');
              if (text.trim()) {
                e.preventDefault();
                setRaw(text);
                read(text);
              }
            }}
            rows={4}
            aria-label="Paste the reply"
            placeholder={'Read chapter 7 — 45m\nProblems 1–15 — 1h\nMock quiz — 30m'}
            className="w-full bg-field border border-line-2 rounded-field px-[10px] py-[7px] text-body text-ink outline-none focus:border-accent resize-y leading-[1.5]"
          />
          {raw.trim() && (
            <button
              type="button"
              onClick={() => read(raw)}
              className="mt-[7px] text-meta font-semibold text-accent-deep px-[8px] py-[4px] rounded-field hover:bg-accent-tint"
            >
              Read it
            </button>
          )}
          {error && <p className="mt-[6px] text-meta text-warn" role="alert">{error}</p>}
        </>
      ) : (
        <>
          <ul className="border-t border-line">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-[8px] py-[5px] border-b border-line">
                <input
                  type="checkbox"
                  checked={row.selected}
                  onChange={(e) => patch(row.id, { selected: e.target.checked })}
                  aria-label={`Include “${row.title}”`}
                  className="flex-none w-[15px] h-[15px] accent-current"
                />
                {/* Editable BEFORE it is real. A proposal you cannot correct is
                    one you either accept wholesale or throw away, and both of
                    those are worse than typing it yourself. */}
                <input
                  value={row.title}
                  onChange={(e) => patch(row.id, { title: e.target.value })}
                  aria-label="Proposed task"
                  className={`flex-1 min-w-0 bg-transparent text-ui outline-none rounded-[4px] px-[3px] py-[2px] focus:bg-hover ${
                    row.selected ? 'text-ink-soft' : 'text-faint line-through'
                  }`}
                />
                {/* A plain field, not `EstimateField`: that one autofocuses on
                    mount because its host summons it from a badge, and a list
                    of five would fight over the caret. */}
                <input
                  defaultValue={formatEstimateValue(row.estimateMin)}
                  onBlur={(e) => {
                    const parsed = parseEstimateInput(e.target.value);
                    if (parsed === undefined) {
                      // Unparseable reverts rather than wiping a duration the
                      // proposal already got right.
                      e.target.value = formatEstimateValue(row.estimateMin);
                      return;
                    }
                    patch(row.id, { estimateMin: parsed ?? undefined });
                  }}
                  aria-label={`Estimate for “${row.title}”`}
                  placeholder="est"
                  className="flex-none w-[52px] bg-transparent text-meta text-ink-soft text-right outline-none rounded-[4px] px-[3px] py-[2px] focus:bg-hover placeholder:text-faint"
                />
              </li>
            ))}
          </ul>
          {/* What this will cost, beside where it could go. Stated BEFORE the
              write, because after it the leaf becomes a container and this
              panel is gone. */}
          {taking > 0 && (
            <p className="mt-[8px] text-meta text-muted">
              {takingMin > 0 && (
                <span className="tabular-nums">{fmtMinutes(takingMin)}</span>
              )}
              {unpriced > 0 && `${takingMin > 0 ? ' · ' : ''}${unpriced} unestimated`}
              {freeDay && (takingMin > 0 || unpriced > 0) && ' · '}
              {freeDay && (
                <>
                  {dayLabel(freeDay.date, todayStr())} has{' '}
                  <span className="tabular-nums">{fmtMinutes(freeDay.gapMin)}</span> open
                </>
              )}
            </p>
          )}
          <div className="flex items-center gap-[8px] mt-[10px]">
            <button
              type="button"
              onClick={accept}
              disabled={taking === 0}
              className="text-body font-semibold text-paper bg-ink px-[13px] py-[6px] rounded-field hover:bg-ink-hover disabled:opacity-40 disabled:pointer-events-none"
            >
              Add {taking} subtask{taking === 1 ? '' : 's'}
            </button>
            <button
              type="button"
              onClick={() => { setRows(null); setRaw(''); }}
              className="text-body text-ink-soft px-[10px] py-[6px] rounded-field hover:bg-hover"
            >
              Paste something else
            </button>
          </div>
        </>
      )}
    </div>
  );
}
