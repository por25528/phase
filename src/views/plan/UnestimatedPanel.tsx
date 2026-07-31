import { actions } from '../../state/store';
import { EstimateControl } from '../../components/EstimateControl';
import type { UnestimatedItem } from '../../lib/unestimated';

/**
 * The work behind the header's "N unestimated", listed and priceable in place.
 *
 * The count used to be inert text. It is the app telling you that part of its
 * own capacity arithmetic is fiction, and then refusing to say which part — so
 * the only way to resolve it was to scan the rail for rows with no estimate,
 * and that does not even cover the placed ones.
 *
 * A list rather than a cursor that walks to each item in turn: the whole set is
 * the useful unit here (this is a Sunday-planning action, not a lookup), the
 * items are frequently not all on one surface — some are rail rows, some are
 * grid blocks — and pricing them one at a time through a reveal would mean
 * seven round trips to fix a number you wanted correct once.
 *
 * Rows disappear as they are estimated, because the list IS the count: when it
 * empties, the header's button goes with it. Nothing here writes anything
 * except through `EstimateControl`, so every edit is undoable exactly as it is
 * everywhere else.
 */
export function UnestimatedPanel({
  items,
  onClose,
}: {
  items: UnestimatedItem[];
  onClose: () => void;
}) {
  return (
    <section
      aria-label="Unestimated work"
      className="mb-[10px] rounded-card border border-line-2 bg-panel px-[12px] py-[10px]"
    >
      <div className="flex items-baseline gap-[8px] mb-[8px]">
        <h4 className="font-mono text-kbd tracking-[.1em] uppercase text-muted font-semibold">
          Unestimated
        </h4>
        <p className="text-meta text-muted flex-1 min-w-0">
          These are committed this week but carry no duration, so the week's free
          and planned figures don't count them.
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close unestimated work"
          className="text-body text-muted px-[6px] min-w-[24px] min-h-[24px] inline-flex items-center justify-center rounded-field hover:bg-hover hover:text-ink"
        >
          ✕
        </button>
      </div>

      <ul className="flex flex-col gap-[1px]">
        {items.map((item) => (
          <li
            key={`${item.kind}:${item.id}`}
            className="group flex items-center gap-[8px] px-[6px] py-[3px] rounded-[6px] hover:bg-hover text-ui text-ink-soft"
          >
            {/* Clicking the title takes you to the item itself — the rail row
                or the grid block, whichever it currently is. Estimating is the
                common case and happens right here, so this is the secondary
                action and is styled as one. */}
            {/* Named explicitly: a list of buttons whose only accessible name
                is the item title gives no clue what activating one does, and
                the estimate control beside it is a second button about the
                same item. The label still CONTAINS the visible text, so
                speech input matching the label works (WCAG 2.5.3). */}
            <button
              type="button"
              onClick={() => actions.revealInPlan(item.kind, item.id)}
              aria-label={`Show "${item.title}" in the week`}
              className="flex-1 min-w-0 text-left truncate rounded-[4px] hover:text-ink"
            >
              {item.title}
            </button>
            {item.goalTitle && (
              <span className="flex-none max-w-[120px] truncate text-meta text-muted">
                {item.goalTitle}
              </span>
            )}
            {/* An unestimated block on the grid is drawn at the default slot
                length with a dashed border, so it looks scheduled while
                contributing nothing to `plannedMin`. Saying which rows those
                are explains why the day looks fuller than the number claims. */}
            {item.placed && (
              <span className="flex-none text-eyebrow font-mono uppercase tracking-[.08em] text-muted">
                on grid
              </span>
            )}
            <EstimateControl
              minutes={undefined}
              label={item.title}
              onChange={(minutes) => {
                if (item.kind === 'task') actions.setTaskEstimate(item.id, minutes);
                else actions.setNodeEstimate(item.id, minutes);
              }}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
