import { useEffect, useId, useRef } from 'react';
import { modalRegistry } from '../lib/modalRegistry';
import { IconX } from './Icons';
import { ruleTag } from './sectionLabel';
import {
  dialogHead, dialogRule, dialogRuleCell, dialogRuleHint, dialogTitle,
} from './dialogStyles';

/**
 * Centered modal dialog — mirrors the goal drawer's scrim/panel styling.
 * Closes on scrim click, the close button, and Escape. Renders nothing when
 * `open` is false.
 * Focus is trapped inside while open and restored to the opener on close;
 * body scroll is locked. size='full' is the wide, content-sized planner variant.
 *
 * Two frames, chosen by whether a `verb` was given. The card frame is the
 * original — panel padding, an `h2`, a ✕ in the corner — and is what
 * `SettingsModal` and the week planner still wear. The
 * INSTRUMENT frame replaces that chrome with a ruled strip carrying the verb
 * and a masthead carrying the name, and hands the padding to the content so a
 * body and a footer bar can run edge to edge.
 *
 * Nothing about Escape, focus, the scrim or the registry differs between them.
 * That is deliberate to the point of being the rule: `Modal.test.tsx` guards
 * two Escape mechanisms — the capture-phase `stopPropagation` and the
 * `data-popover-open` deferral that lets New goal's calendar own the key
 * first — and a frame is a wrapper, never a second key handler.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'default',
  verb,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'default' | 'full';
  /**
   * The verb this dialog performs — `Create`, `Import`, `Replace`. Its
   * presence selects the instrument frame, because the two are the same
   * decision: a dialog whose rule states the verb is one whose title is free
   * to be a name, and a card-framed dialog has nowhere to put a verb.
   */
  verb?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const modalId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const unregister = modalRegistry.register(modalId);
    const opener = document.activeElement as HTMLElement | null;
    // The panel, not the close button. A dialog that opens with "dismiss this"
    // selected has answered itself before it finished appearing, and both
    // dialogs that cared worked around it in different ways — one with
    // `autoFocus`, one with a `setTimeout`. Content that wants a specific field
    // still claims it (`autoFocus` lands during commit, a child's effect runs
    // before this one's owner renders again); this only supplies the fallback,
    // and only when nothing inside has taken focus already.
    const panelEl = panelRef.current;
    if (panelEl && !panelEl.contains(document.activeElement)) panelEl.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKey(e: KeyboardEvent) {
      if (!modalRegistry.isTopmost(modalId)) return;
      if (e.key === 'Escape') {
        // An open anchored panel owns Escape first. `Popover` consumes the key
        // to dismiss itself, but it cannot stop this handler: both listen on
        // `window` in the capture phase, `stopPropagation` does not reach a
        // listener on the same target, and the modal registered first because
        // it opened first. So one press closed the popover AND this dialog —
        // which the New goal calendar made reachable the moment a popover was
        // first nested inside a modal. Deferring here is what leaves Escape
        // meaning "close the thing on top".
        if ((e.target as Element | null)?.closest?.('[data-popover-open]')) return;
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter(
        // A radio group is ONE tab stop and the browser decides which member —
        // an attribute selector cannot see that, so the wrap would aim shift-Tab
        // at an unchecked radio and land nowhere. `:disabled` is the same class
        // of bug reached by a different route: a dimmed "Create" was still being
        // counted as the last stop it could never receive.
        (el) => !(el instanceof HTMLInputElement && el.type === 'radio' && !el.checked),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      unregister();
      document.body.style.overflow = prevOverflow;
      opener?.focus();
    };
  }, [open, modalId]);

  if (!open) return null;

  // `full` is the wide planner variant (fits the week grid). It sizes to its
  // content — no forced min-height, which otherwise leaves a large empty panel.
  const width = size === 'full' ? 'max-w-[980px]' : 'max-w-[480px]';

  /*
   * No `overflow-hidden` on the panel, and this is the trap worth naming:
   * New goal's calendar is a `Popover`, absolutely positioned INSIDE this
   * panel, and it is taller than the dialog on purpose. Clipping the panel to
   * round the strip's corners would cut the picker off at the dialog's own
   * bottom edge. So the strip and the bar round their OWN corners instead —
   * `rounded-t-card` on `dialogRule`, `rounded-b-card` on `dialogBar`.
   */
  const pad = verb ? '' : 'px-[24px] pt-[22px] pb-[24px]';

  return (
    <div
      className="scrim fixed inset-0 z-50 grid place-items-center px-[16px] py-[24px] overflow-y-auto"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative w-full ${width} bg-panel border border-line-2 rounded-card shadow-card ${pad} my-auto outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        {verb ? (
          <>
            <div className={dialogRule}>
              <span className={dialogRuleCell}><span className={ruleTag}>{verb}</span></span>
              <span className="flex-1" />
              {/*
                `Esc`, not `⎋`. The app already spells this key that way in
                `ShortcutsOverlay` ("Esc — Close drawer or dialog"), and three
                ASCII letters cannot fall out of the subsetted mono face the
                way a lone technical glyph can — the exact failure
                `designScale.test.ts` keeps a list of icon characters to
                prevent.
              */}
              <span className={dialogRuleHint}>Esc to cancel</span>
            </div>
            <div className={dialogHead}>
              <h2 className={dialogTitle}>{title}</h2>
            </div>
          </>
        ) : (
          <div className="flex items-start justify-between gap-[12px] mb-[16px]">
            <h2 className="text-h2 font-semibold tracking-[-0.01em]">{title}</h2>
            <button
              type="button"
              aria-label="Close"
              className="flex-none text-muted w-[24px] h-[24px] inline-flex items-center justify-center rounded-[6px] hover:bg-hover hover:text-ink"
              onClick={onClose}
            >
              <IconX size={15} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
