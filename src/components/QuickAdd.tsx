import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAppStore } from '../state/store';
import { fmtD, todayStr } from '../lib/dates';
import { formatEstimateValue } from '../lib/estimateInput';
import { parseQuickAdd, type QuickAddToken } from '../lib/quickAdd';

/**
 * One line, anchored under the header.
 *
 * What this replaces was a centred modal with a title field, a `When` fieldset
 * of three large pills, a conditional date picker, a `Choose goal` toggle and a
 * goal select — a form, blocking the whole interface, for the single most
 * frequent action in the product. It also could not express "not yet": every
 * capture landed on a day, so a Tuesday's stray thoughts became Tuesday's
 * commitments.
 *
 * The composer takes a sentence and reads `#goal`, `@date` and `~45m` out of
 * it, showing what it understood underneath as it goes. Nothing is required
 * but the title, and an unresolved token is left in the text rather than
 * silently eaten.
 *
 * It deliberately does NOT register with `modalRegistry`. That registry exists
 * to tell App's key handler that a centred dialog owns the keyboard; this is a
 * popover over a live page, and suppressing the view shortcuts behind it would
 * be claiming a weight it does not have.
 */
const TOKEN_TONE: Record<QuickAddToken['kind'], string> = {
  goal: 'bg-accent-tint text-accent-deep',
  date: 'bg-hover-deep text-ink-soft',
  estimate: 'bg-hover-deep text-ink-soft',
};

export function QuickAdd({
  open,
  onClose,
  focusRequest = 0,
  enabled,
}: {
  open: boolean;
  onClose: () => void;
  focusRequest?: number;
  enabled: boolean;
}) {
  const { goals, actions } = useAppStore();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const handledFocusRef = useRef(focusRequest);

  useEffect(() => {
    if (!open) return;
    setText('');
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  // ⌘N while the composer is already up means "focus me", not "reopen me" —
  // the same contract the modal had, minus the modal.
  useEffect(() => {
    if (!open || focusRequest === handledFocusRef.current) return;
    handledFocusRef.current = focusRequest;
    inputRef.current?.focus();
  }, [open, focusRequest]);

  /**
   * Escape closes the composer, and stops there.
   *
   * It is a popover over a page, not a page state: without stopping
   * propagation the same keypress reached App's handler and left the goal
   * workspace behind it, which is two levels for one press.
   */
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const today = todayStr();
  const parsed = parseQuickAdd(text, goals, today);
  const canSubmit = enabled && parsed.title.length > 0;

  function commit(keepOpen: boolean): void {
    if (!canSubmit) return;
    actions.addTask(
      parsed.title,
      parsed.date,
      parsed.goalId,
      parsed.estimateMin ?? undefined,
    );
    actions.showToast(parsed.date ? `Task added for ${fmtD(parsed.date)}` : 'Task added — unscheduled');
    setText('');
    if (keepOpen) inputRef.current?.focus();
    else onClose();
  }

  function submit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    commit(false);
  }

  return (
    <>
      {/* A click-away catcher rather than a dimmer. The composer does not take
          the interface hostage, so darkening the page behind it would claim a
          weight it does not have. */}
      <div className="fixed inset-0 z-[45]" onClick={onClose} role="presentation" />
      <div className="fixed left-1/2 -translate-x-1/2 top-[58px] z-[46] w-[min(620px,calc(100vw-24px))]">
        <form
          onSubmit={submit}
          className="bg-panel border border-line-2 rounded-card shadow-card overflow-hidden"
        >
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // ⌘Enter keeps the composer open, for a run of captures. This is
              // the difference between writing down five things and opening a
              // dialog five times.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                commit(true);
              }
            }}
            placeholder="Add a task…  #goal  @friday  ~45m"
            aria-label="Add a task"
            autoComplete="off"
            className="w-full bg-transparent text-title text-ink placeholder:text-faint outline-none px-[16px] py-[13px]"
          />

          <div className="flex items-center gap-[6px] px-[16px] py-[8px] border-t border-line text-meta min-h-[34px] flex-wrap">
            {parsed.tokens.map((t) => (
              <span
                key={t.raw}
                className={`px-[7px] py-[2px] rounded-field font-medium ${TOKEN_TONE[t.kind]}`}
              >
                {t.kind === 'date'
                  ? fmtD(t.label)
                  : t.kind === 'estimate'
                    ? formatEstimateValue(parsed.estimateMin ?? undefined)
                    : t.label}
              </span>
            ))}
            {/* Saying "unscheduled" out loud, every time. It is the default, and
                a default nobody can see is a default nobody trusts. */}
            {parsed.date === null && (
              <span className="text-muted">Unscheduled</span>
            )}
            {parsed.unresolved.length > 0 && (
              <span className="text-warn" role="status">
                Didn’t recognise {parsed.unresolved.join(', ')} — left it in the title
              </span>
            )}
            <span className="flex-1" />
            <span className="text-faint hidden sm:inline">
              ↵ add · ⌘↵ add and keep typing
            </span>
          </div>
        </form>
      </div>
    </>
  );
}
