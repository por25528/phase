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
  /** Accessible name for the row button, when provided. */
  ariaLabel?: string;
  completed?: boolean;
  /**
   * Keep the leading control's column with no control in it, so a list whose
   * rows have no checkbox still shares a left edge with one whose rows do.
   * Ignored when `lead` is given — that already occupies the column.
   */
  reserveLead?: boolean;
  /** The one row on the page that is the answer. Sets the title one step up. */
  emphasis?: boolean;
}

/**
 * One list row, for every surface that lists work.
 *
 * Today had three hand-rolled versions of these — a commitment row, an offer
 * row and the card in `Now`. The two lists are now unified here; the `Now`
 * card deliberately remains its own shape, which is how the same page ended
 * up with a hover background on one list and none on the list above it.
 *
 * The shape is dictated by one constraint: a row needs an interactive leading
 * control AND a full-row click target, and `<button>` inside `<button>` is
 * invalid — it swallows the inner control's accessible name. So the title is
 * the ONLY button and it carries an absolutely-positioned overlay stretched
 * across the row; the lead control is a sibling raised above that overlay.
 * One guaranteed focusable element (the title button), with a second permitted
 * when a caller supplies an interactive lead, a full-row target, no nesting.
 * Both the row and title button carry `group` for different reasons: the row
 * lets `.quiet-control` descendants passed through `lead` or `meta` resolve
 * the hover gate, while the button's `group` drives its focus ring; the row
 * div is never `:focus-visible`.
 *
 * Focus lands on the title button, while the overlay draws the ring at row
 * scale: a ring around 14px of text inside a 720px row reads as a bug.
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
  reserveLead,
  emphasis,
}: TaskRowProps) {
  const titleCls = `block truncate ${emphasis ? 'text-lead' : 'text-ui'} ${
    completed ? 'line-through text-muted' : 'text-ink-soft'
  }`;

  return (
    <div
      className={`group relative flex items-center gap-[8px] px-[8px] py-[6px] rounded-[6px] transition-colors duration-150 ${
        onOpen ? 'hover:bg-hover' : ''
      }`}
    >
      {lead && <span data-row-lead className="relative z-10 flex-none">{lead}</span>}
      {!lead && reserveLead && (
        /* The reserved column stays below the overlay: it has no control to raise, and raising an empty span would carve a dead patch out of the row's own click target. */
        <span data-row-lead aria-hidden="true" className="w-[22px] flex-none" />
      )}

      {time !== undefined && (
        <span
          data-row-time
          className="w-[48px] flex-none text-meta text-muted tabular-nums"
        >
          {time}
        </span>
      )}

      <span className="min-w-0 flex-1">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={ariaLabel}
            className="group block w-full text-left focus:outline-none"
          >
            {/* The stretched target. `aria-hidden` because the button's
                accessible name comes from its title/subtitle content (or an
                explicit ariaLabel), while this empty span is purely visual. */}
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-[6px] group-focus-visible:ring-2 group-focus-visible:ring-accent"
            />
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
        <span className="flex-none flex items-center gap-[8px] text-meta text-muted">
          {meta}
        </span>
      )}
    </div>
  );
}
