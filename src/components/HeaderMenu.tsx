import { useEffect, useRef } from 'react';
import { IconDots } from './Icons';

/**
 * The header's `⋯` utility menu — the single home for everything the app can
 * do that is not navigating, searching or capturing.
 *
 * It used to be an overflow that only existed below `lg`, with theme, export,
 * reclaim space and import spelled out inline above that width. Frequency does
 * not determine visual priority there: those are operations a person runs a
 * handful of times a year, and advertising them on every screen made the
 * header read as an inventory of what was implemented. They live in here at
 * every width now.
 *
 * Closes on outside pointerdown, Escape, and after any item runs.
 */
export function HeaderMenu({
  open,
  onOpenChange,
  label = 'Settings and data',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What this particular `⋯` opens — the goal header reuses the component. */
  label?: string;
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
    <div ref={wrapRef} className="relative flex-none">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="w-[28px] h-[28px] grid place-items-center rounded-full border border-line-2 text-ink-soft hover:text-ink hover:border-muted"
      >
        {/* The glyph this replaced needed `text-title -mt-[3px]` to sit on the
            button's optical centre, because U+22EF rides low on its baseline in
            whichever fallback face drew it. A 16px box centres by itself. */}
        <IconDots size={16} />
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
