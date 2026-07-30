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
 */
export function DateField({
  value,
  onCommit,
  ariaLabel,
  placeholder = 'Aug 2',
  className = '',
  inputRef,
}: {
  /** 'YYYY-MM-DD', or '' for empty. */
  value: string;
  onCommit: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
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
      className={`rounded-[6px] border border-line-2 px-[5px] min-h-[24px] text-meta text-ink bg-transparent outline-none focus-visible:border-accent w-[86px] ${className}`}
    />
  );
}
