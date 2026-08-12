import { useEffect, useId, useRef, useState } from 'react';

/**
 * An anchored floating panel with a trigger.
 *
 * Phase had three of these and no primitive: `HeaderMenu`, `GoalMetaPopover`
 * and the board card's overflow each hand-rolled the same capture-phase
 * pointerdown listener, the same Escape handler and the same absolute offset.
 * That was tolerable at three. The compact inspector turns every property into
 * a popover, so it stops being tolerable — and three copies is already three
 * chances for one of them to forget `stopPropagation` and let Escape walk off
 * the page behind it.
 *
 * Escape is consumed, not observed. A popover is the topmost thing on screen
 * while it is open, so the key that closes it must not also close the step
 * panel or leave the goal page — `App.tsx` listens on the bubble phase, and a
 * capture listener here that calls `stopPropagation` never lets it get there.
 *
 * Deliberately NOT registered with `modalRegistry`. That registry answers "is
 * a dialog blocking the view shortcuts", and a popover is not: it is anchored,
 * it does not trap focus, and 1–7 over an open estimate popover should still
 * mean what they mean on the surface underneath.
 */
export function Popover({
  label,
  align = 'start',
  disabled,
  trigger,
  triggerClassName = '',
  panelClassName = '',
  panelWidth,
  role = 'dialog',
  triggerRef: externalTriggerRef,
  onOpenChange,
  children,
}: {
  /** Names the trigger for assistive tech — what this popover edits. */
  label: string;
  /** Which edge the panel lines up with. `end` for right-aligned row menus. */
  align?: 'start' | 'end';
  disabled?: boolean;
  trigger: React.ReactNode;
  triggerClassName?: string;
  panelClassName?: string;
  panelWidth?: number;
  /** `menu` for a list of verbs, `dialog` for a property editor. */
  role?: 'dialog' | 'menu';
  /**
   * Exposes the trigger so a keyboard shortcut elsewhere can open this popover
   * by clicking it.
   *
   * A ref to the real button rather than an `open` prop, deliberately: making
   * the component controlled would move the dismissal rules — outside
   * pointerdown, Escape, focus return — up into every host that wanted a
   * shortcut, which is exactly the duplication this primitive exists to end.
   */
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  onOpenChange?: (open: boolean) => void;
  /** Given `close` so a picker can commit and dismiss in one gesture. */
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ownTriggerRef = useRef<HTMLButtonElement>(null);
  const triggerRef = externalTriggerRef ?? ownTriggerRef;
  const panelId = useId();

  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const close = () => {
    change(false);
    // Focus goes back where the user left it. Without this, dismissing a
    // property popover drops focus on <body> and the next arrow key does
    // nothing at all — which reads as the row having lost selection.
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        onOpenChange?.(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      onOpenChange?.(false);
      triggerRef.current?.focus();
    }
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup={role}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : change(true))}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={panelId}
          role={role}
          aria-label={label}
          style={panelWidth ? { width: `${panelWidth}px` } : undefined}
          className={`absolute z-40 top-[calc(100%+4px)] ${
            align === 'end' ? 'right-0' : 'left-0'
          } bg-panel border border-line-2 rounded-card shadow-card py-[5px] ${panelClassName}`}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

/**
 * One verb in a popover whose `role` is `menu`.
 *
 * Closes the popover before running, so an action that navigates away does not
 * leave a panel anchored to a row that no longer exists.
 */
export function PopoverItem({
  onSelect,
  close,
  disabled,
  tone = 'normal',
  hint,
  children,
}: {
  onSelect: () => void;
  close: () => void;
  disabled?: boolean;
  /** `danger` for the destructive tail of a menu. */
  tone?: 'normal' | 'danger';
  /** The keyboard route to the same verb, when there is one. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        close();
        onSelect();
      }}
      className={`w-full text-left px-[12px] py-[6px] text-ui flex items-center gap-[9px] disabled:opacity-40 disabled:pointer-events-none ${
        tone === 'danger'
          ? 'text-ink-soft hover:bg-warn-tint hover:text-warn'
          : 'text-ink-soft hover:bg-hover hover:text-ink'
      }`}
    >
      <span className="flex-1 min-w-0 truncate">{children}</span>
      {hint && <span className="flex-none text-meta text-faint tabular-nums">{hint}</span>}
    </button>
  );
}

/** A hairline between groups of verbs. */
export function PopoverSeparator() {
  return <div role="separator" className="my-[4px] border-t border-line" />;
}
