import type { ReactNode } from 'react';

export interface TaskRowProps {
  title: string;
  subtitle?: string;
  /** Interactive leading control (a checkbox). Rendered ABOVE the row overlay. */
  lead?: ReactNode;
  /** Fixed-width tabular time cell, e.g. "14:00". Reserves width only when given. */
  time?: string;
  /** Trailing metadata — reason chips, due chips, estimates. Not interactive. */
  meta?: ReactNode;
  /** Activates the row. Renders the title as a button stretched across the row. */
  onOpen?: () => void;
  /** Accessible name for the row button. Defaults to `title`. */
  ariaLabel?: string;
  completed?: boolean;
}

/**
 * One list row, for every surface that lists work.
 *
 * Today alone hand-rolled three of these — a commitment row, an offer row and
 * the card in `Now` — which is how the same page ended up with a hover
 * background on one list and none on the list above it.
 *
 * The shape is dictated by one constraint: a row needs an interactive leading
 * control AND a full-row click target, and `<button>` inside `<button>` is
 * invalid — it swallows the inner control's accessible name. So the title is
 * the ONLY button and it carries an absolutely-positioned overlay stretched
 * across the row; the lead control is a sibling raised above that overlay.
 * One focusable element, a full-row target, no nesting.
 *
 * Focus lands on the row rather than the title because `focus-within` is on
 * the shell: a ring around 14px of text inside a 720px row reads as a bug.
 */
export function TaskRow({
  title,
  subtitle,
  lead,
  time,
  meta,
  onOpen,
  ariaLabel,
  completed = false,
}: TaskRowProps) {
  const titleCls = `block truncate text-ui ${
    completed ? 'line-through text-muted' : 'text-ink-soft'
  }`;

  return (
    <div
      className={`relative flex items-center gap-[8px] px-[8px] py-[6px] rounded-[6px] transition-colors duration-150 focus-within:ring-2 focus-within:ring-accent ${
        onOpen ? 'hover:bg-hover' : ''
      }`}
    >
      {lead && <span className="relative z-10 flex-none">{lead}</span>}

      {time !== undefined && (
        <span
          data-row-time
          className="relative z-10 w-[48px] flex-none text-meta text-muted tabular-nums"
        >
          {time}
        </span>
      )}

      <span className="min-w-0 flex-1">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={ariaLabel ?? title}
            className="block w-full text-left focus:outline-none"
          >
            {/* The stretched target. `aria-hidden` because the button already
                has its name, and an empty span would otherwise be announced. */}
            <span aria-hidden="true" className="absolute inset-0 rounded-[6px]" />
            <span className={titleCls}>{title}</span>
            {subtitle && <span className="block truncate text-meta text-muted">{subtitle}</span>}
          </button>
        ) : (
          <>
            <span className={titleCls}>{title}</span>
            {subtitle && <span className="block truncate text-meta text-muted">{subtitle}</span>}
          </>
        )}
      </span>

      {meta && (
        <span className="relative z-10 flex-none flex items-center gap-[8px] text-meta text-muted">
          {meta}
        </span>
      )}
    </div>
  );
}
