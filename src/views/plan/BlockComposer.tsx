import { useEffect, useRef } from 'react';
import { minuteToPx, PX_PER_MINUTE, Z_BLOCK_REVEALED } from '../../lib/grid';
import { clockLabel } from '../../lib/clock';

/**
 * The inline title field for a block being drawn.
 *
 * It writes NOTHING. The field is local state and the parent only hears about
 * it through `onCommit`, so a stray click costs an empty field that Esc or
 * blur dismisses. Committing an empty title cancels rather than creating
 * "Untitled" — that is what lets the create gesture be a single click with no
 * confirmation step.
 *
 * `resolved` guards the three exits against each other: committing unmounts
 * the field, which fires `blur`, which would otherwise cancel the commit that
 * had just succeeded.
 */
export function BlockComposer({
  startMin, durationMin, onCommit, onCancel, variant = 'block', label,
}: {
  startMin: number;
  durationMin: number;
  onCommit: (title: string) => void;
  onCancel: () => void;
  /**
   * `block` positions itself on the hour grid from `startMin`/`durationMin`.
   * `bar` is a static row for surfaces with no time axis — the month grid,
   * where the hour is chosen by `resolveSlot` rather than by the gesture.
   *
   * One component rather than two because the commit/cancel rules are the
   * subtle part (see `resolved` below); duplicating them for a different
   * shell is how the two would drift.
   */
  variant?: 'block' | 'bar';
  /** Shown instead of the span when there is no span to show. */
  label?: string;
}) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const resolved = useRef(false);

  useEffect(() => { fieldRef.current?.focus(); }, []);

  function finish(commit: boolean): void {
    if (resolved.current) return;
    resolved.current = true;
    const title = fieldRef.current?.value.trim() ?? '';
    if (commit && title) onCommit(title);
    else onCancel();
  }

  const isBar = variant === 'bar';

  return (
    <div
      className={`rounded-[6px] border border-accent bg-panel px-[5px] py-[2px] overflow-hidden text-badge leading-[1.2] ${
        isBar ? 'mb-[6px] flex items-baseline gap-[8px]' : 'absolute left-[2px] right-[2px]'
      }`}
      style={isBar ? undefined : {
        top: `${minuteToPx(startMin)}px`,
        height: `${durationMin * PX_PER_MINUTE}px`,
        zIndex: Z_BLOCK_REVEALED,
      }}
      // The blocks' own buttons do this so a pointerdown does not start a drag
      // (EventBlock.tsx:137, :153). Typing in a field inside the grid needs the
      // same protection.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        ref={fieldRef}
        type="text"
        aria-label="Title for the new block"
        placeholder="What is this?"
        className="w-full bg-transparent outline-none font-medium text-ink placeholder:text-faint"
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); finish(true); }
          else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        }}
        onBlur={() => finish(false)}
      />
      <div
        data-testid="composer-span"
        className={`truncate text-muted text-tiny tabular-nums ${isBar ? 'flex-none order-first' : ''}`}
      >
        {label ?? `${clockLabel(startMin)}–${clockLabel(startMin + durationMin)}`}
      </div>
    </div>
  );
}
