import { useEffect, useRef } from 'react';

/**
 * The header's `⋯` overflow menu. Below `lg` the utility cluster (shortcuts,
 * theme, export, import) does not fit beside the nav, and letting it push the
 * document wider is what made every view side-scroll on a phone — so it
 * collapses in here instead.
 *
 * Closes on outside pointerdown, Escape, and after any item runs.
 */
export function HeaderMenu({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) onOpenChange(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onOpenChange(false);
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={wrapRef} className="relative lg:hidden">
      <button
        type="button"
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="w-[28px] h-[28px] grid place-items-center rounded-full border border-line-2 text-ink-soft hover:text-ink hover:border-muted"
      >
        <span aria-hidden="true" className="leading-none text-title -mt-[3px]">⋯</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[34px] z-40 min-w-[190px] bg-panel border border-line-2 rounded-card shadow-card py-[6px]"
          onClick={() => onOpenChange(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** One row in the overflow menu — full-width, left-aligned, comfortable target. */
export function HeaderMenuItem({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="w-full text-left px-[14px] py-[8px] text-body text-ink-soft hover:bg-hover hover:text-ink disabled:opacity-40 disabled:pointer-events-none flex items-center gap-[9px]"
    >
      {children}
    </button>
  );
}
