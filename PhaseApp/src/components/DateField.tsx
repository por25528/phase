import { useEffect, useRef, useState } from 'react';
import { fmtD, todayStr } from '../lib/dates';
import { parseDateInput } from '../lib/dateInput';

/**
 * A date field that speaks the app's own language.
 *
 * `<input type="date">` renders in the browser's locale, so the drawer showed
 * `02/08/2026` one line above a card reading `Aug 2` — genuinely ambiguous
 * (Feb 8 to a US reader) on the one field where a misread moves a deadline, and
 * the only unstyled control in an otherwise controlled visual system.
 *
 * Idle it shows `Aug 2`, exactly as cards do. On focus it swaps to ISO
 * (`2026-08-02`) — unambiguous and easy to type — and commits on blur or Enter.
 * Escape reverts. Unparseable text snaps back rather than writing a wrong date.
 *
 * `size` exists because `className` is APPENDED, not merged, and Tailwind has no
 * last-one-wins rule. New goal passed the dialogs' field class in and shipped an
 * input carrying `rounded-[6px]` AND `rounded-field`, `text-meta` AND `text-ui`,
 * `px-[5px]` AND `px-[8px]`. Which half of each pair applied was decided by the
 * order Tailwind happened to emit them in — today the caller's intent wins all
 * four, by luck, and a rename would flip any of them silently. `w-[86px]`
 * collided with nothing, so it survived unopposed: the deadline was the one
 * field in that dialog still sized for a table row, clipping its own "No
 * deadline" placeholder. Callers pick a size now instead of patching one.
 */
const SIZES = {
  /** Inline in a row, a popover or the docked inspector — the original. */
  inline: 'w-[86px] min-h-[24px] px-[5px] rounded-[6px] text-meta',
  /** A form field in a dialog — deliberately identical to `fieldCls`, `leading` included. */
  field: 'w-full min-h-[30px] leading-[21px] px-[8px] py-[5px] rounded-field text-ui',
} as const;

/**
 * `muted`, where `fieldCls` takes `faint` — and the split is the same one
 * `DatePopover`'s trigger already makes in a comment two files over.
 *
 * This control had no placeholder colour at all, so "No dates", "Not set",
 * "Start", "End" and "Due" all rendered in near-full ink and read as values
 * somebody had entered. But the fix is not `fieldCls`'s: none of those strings
 * is an EXAMPLE of what to type. Every one of them names an UNSET property, and
 * `TaskPage`'s rule — written down in CLAUDE.md — is that an unset value is
 * `text-muted` and never `text-faint`, because it is read and it is the only
 * affordance for setting one. `PropertyLineField` says the same thing in the
 * same words at `PropertyRow.tsx`.
 *
 * A hint that vanishes when you type is faint; a value that is absent is muted.
 */
const PLACEHOLDER = 'placeholder:text-muted';

export function DateField({
  value,
  onCommit,
  ariaLabel,
  placeholder = 'Aug 2',
  className = '',
  size = 'inline',
  inputRef,
}: {
  /** 'YYYY-MM-DD', or '' for empty. */
  value: string;
  onCommit: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  /** Positioning only — anything that sets radius, padding, width or type size belongs in `size`. */
  className?: string;
  size?: keyof typeof SIZES;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;

  // Follow external edits (undo, Clear dates) while not being typed in.
  useEffect(() => {
    if (!editing) setDraft('');
  }, [value, editing]);

  const display = editing ? draft : value ? fmtD(value) : '';

  function commit(): void {
    setEditing(false);
    const text = draft.trim();
    if (text === '') {
      if (value !== '') onCommit('');
      return;
    }
    const parsed = parseDateInput(text, value || todayStr());
    if (parsed && parsed !== value) onCommit(parsed);
  }

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      value={display}
      aria-label={ariaLabel}
      placeholder={placeholder}
      title={value ? `${fmtD(value)} — edit as ${value}` : placeholder}
      onFocus={() => {
        setDraft(value);
        setEditing(true);
        requestAnimationFrame(() => ref.current?.select());
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          ref.current?.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setEditing(false);
          setDraft('');
          ref.current?.blur();
        }
      }}
      className={`border border-line-2 text-ink ${PLACEHOLDER} bg-transparent outline-none focus-visible:border-accent ${SIZES[size]} ${className}`}
    />
  );
}
