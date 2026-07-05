import { useEffect, useRef } from 'react';

/**
 * Centered modal dialog — mirrors the goal drawer's scrim/panel styling.
 * Closes on scrim click, ✕, and Escape. Renders nothing when `open` is false.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeBtnRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(20,20,18,0.28)] px-[16px] py-[24px] overflow-y-auto"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-[480px] bg-panel border border-line-2 rounded-card shadow-card px-[24px] pt-[22px] pb-[24px] my-auto"
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
