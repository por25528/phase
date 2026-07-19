import { useEffect, useRef } from 'react';

/**
 * Centered modal dialog — mirrors the goal drawer's scrim/panel styling.
 * Closes on scrim click, ✕, and Escape. Renders nothing when `open` is false.
 * Focus is trapped inside while open and restored to the opener on close;
 * body scroll is locked. size='full' is the wide, content-sized planner variant.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'default',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'default' | 'full';
}) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
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
      document.body.style.overflow = prevOverflow;
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;

  // `full` is the wide planner variant (fits the week grid). It sizes to its
  // content — no forced min-height, which otherwise leaves a large empty panel.
  const width = size === 'full' ? 'max-w-[980px]' : 'max-w-[480px]';

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(20,20,18,0.28)] px-[16px] py-[24px] overflow-y-auto"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-full ${width} bg-panel border border-line-2 rounded-card shadow-card px-[24px] pt-[22px] pb-[24px] my-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-[12px] mb-[16px]">
          <h2 className="font-disp text-[1.15rem] font-semibold tracking-[-0.01em]">{title}</h2>
          <button
            ref={closeBtnRef}
            aria-label="Close"
            className="flex-none text-muted text-[17px] px-[7px] py-[3px] rounded-[6px] hover:bg-hover"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
