import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { EstimateField } from './EstimateField';
import { ESTIMATE_PRESETS } from './EstimateControl';
import { formatEstimateValue } from '../lib/estimateInput';
import { compareEstimate } from '../lib/actuals';

/**
 * Record time actually spent, beside the estimate that predicted it.
 *
 * Deliberately a SEPARATE control from `EstimateControl` rather than a mode of
 * it, because the two write in opposite directions: setting an estimate
 * replaces a number, logging time appends a record. Folding them together would
 * make the same field mean "this is how long it will take" or "this is how long
 * it took" depending on state, which is exactly the ambiguity that makes time
 * tracking feel like bookkeeping.
 *
 * At rest it shows nothing until time exists, then shows the total with the
 * over/under against the estimate in its tooltip. Logging is always explicit —
 * nothing here or anywhere else infers minutes from a scheduled block.
 */
export function LogTimeControl({
  loggedMin,
  estimateMin,
  label,
  onLog,
  onClear,
}: {
  loggedMin: number;
  /** Only for the comparison tooltip; this control never writes it. */
  estimateMin: number | undefined;
  label: string;
  onLog: (minutes: number) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const logged = loggedMin > 0;
  const badgeRef = useRef<HTMLButtonElement>(null);
  // Committing unmounts the control the user is standing on; without this,
  // focus falls to `<body>` after every entry. See EstimateControl, which
  // carries the full reasoning.
  const returnFocus = useRef(false);
  useEffect(() => {
    if (editing || !returnFocus.current) return;
    returnFocus.current = false;
    badgeRef.current?.focus();
  }, [editing]);

  function close(commit: boolean) {
    returnFocus.current = commit;
    setEditing(false);
  }

  /*
   * Closes on focusout, but must NOT decide whether this was a commit.
   *
   * `EstimateField` blurs itself immediately after committing on Enter, so this
   * handler runs for a keyboard commit too. Resetting the flag here clobbered
   * the one `onChange` had just set a tick earlier, and Enter lost focus to
   * `<body>` while a preset click kept it — the same interaction behaving two
   * different ways. The flag is owned by whoever knows a write happened; this
   * only leaves it alone. It is cleared by the effect above once consumed, so a
   * plain click-away can never inherit a stale `true`.
   */
  function handleBlur(e: FocusEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setEditing(false);
  }

  if (!editing) {
    const comparison = compareEstimate(estimateMin, loggedMin);
    const hint = comparison
      ? `Logged ${formatEstimateValue(loggedMin)} against a ${formatEstimateValue(comparison.estimateMin)} estimate — ${comparison.ratio.toFixed(1)}× ${comparison.ratio >= 1 ? 'over' : 'under'}`
      : logged
        ? `Logged ${formatEstimateValue(loggedMin)} — no estimate to compare against`
        : `Log time spent on "${label}"`;

    return (
      <button
        ref={badgeRef}
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        aria-label={
          logged
            ? `Logged ${formatEstimateValue(loggedMin)} on "${label}". Log more`
            : `Log time on "${label}"`
        }
        title={hint}
        // Only advertises itself on hover until there is time to show, the same
        // rule the estimate badge follows. Once time exists it is information
        // and stays legible at rest.
        className={`flex-none font-mono text-eyebrow tabular-nums min-w-[24px] min-h-[24px] inline-flex items-center justify-center rounded-[4px] hover:bg-hover ${
          logged
            ? // Over the estimate is worth seeing without hovering; that is the
              // whole point of recording it.
              comparison && comparison.ratio >= 1.15
              ? 'text-warn'
              : 'text-muted hover:text-ink-soft'
            : 'quiet-control text-muted hover:text-ink-soft'
        }`}
      >
        {logged ? `⏱${formatEstimateValue(loggedMin)}` : '⏱'}
      </button>
    );
  }

  return (
    <div
      className="flex-none flex flex-wrap items-center gap-[3px]"
      onBlur={handleBlur}
      onClick={(e) => e.stopPropagation()}
    >
      {/* `minutes={undefined}` on purpose: the field is an ENTRY for another
          sitting, not an editor for the running total. Seeding it with the
          total would make Enter look like it replaced the ledger. */}
      <EstimateField
        minutes={undefined}
        label={`time on ${label}`}
        onChange={(minutes) => {
          if (minutes !== null) onLog(minutes);
          close(true);
        }}
      />
      {ESTIMATE_PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          // preventDefault, not just stopPropagation. `EstimateField` commits
          // on blur, and pressing this button blurs the input BEFORE its own
          // click fires — so a typed draft committed first and then unmounted
          // these buttons, swallowing the click. On the estimate that wrote
          // twice and armed two undo entries; on the append-only time ledger it
          // logged the typed value INSTEAD of the preset the user pressed.
          // Preventing the default on pointerdown suppresses the focus change,
          // so the input never blurs and only the click writes.
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onLog(preset);
            close(true);
          }}
          aria-label={`Log ${formatEstimateValue(preset)} on "${label}"`}
          className="font-mono text-eyebrow tabular-nums min-h-[24px] px-[4px] inline-flex items-center rounded-[4px] border border-line-2 text-muted hover:text-ink hover:bg-hover"
        >
          {formatEstimateValue(preset)}
        </button>
      ))}
      {logged && (
        <button
          type="button"
          // preventDefault, not just stopPropagation. `EstimateField` commits
          // on blur, and pressing this button blurs the input BEFORE its own
          // click fires — so a typed draft committed first and then unmounted
          // these buttons, swallowing the click. On the estimate that wrote
          // twice and armed two undo entries; on the append-only time ledger it
          // logged the typed value INSTEAD of the preset the user pressed.
          // Preventing the default on pointerdown suppresses the focus change,
          // so the input never blurs and only the click writes.
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onClear();
            close(true);
          }}
          aria-label={`Clear the time logged on "${label}"`}
          className="font-mono text-eyebrow min-h-[24px] px-[4px] inline-flex items-center rounded-[4px] border border-line-2 text-muted hover:text-warn hover:bg-warn-tint"
        >
          clear
        </button>
      )}
    </div>
  );
}
