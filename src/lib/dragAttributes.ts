/**
 * dnd-kit's `attributes`, stripped of the parts that only make sense on a bare
 * drag handle.
 *
 * `useDraggable`/`useSortable` return
 * `{ role: 'button', tabIndex: 0, 'aria-pressed', 'aria-roledescription':
 * 'draggable', 'aria-describedby' }`, which is right for a dedicated handle —
 * the pattern `GoalTree` uses — and wrong for a container. Three surfaces here
 * spread it onto an element that then holds real `<button>`s: the board card
 * (five to seven of them), a grid block (complete, unschedule, resize) and a
 * backlog row (estimate, complete, delete).
 *
 * Interactive content nested inside `role="button"` is invalid, and the
 * practical result is that the container's accessible name absorbs every child
 * label — a block announced roughly "pset 9am Complete pset Unschedule pset,
 * draggable, button" — while `aria-pressed` on something that is not a toggle
 * made every card read as a permanently-unpressed toggle button.
 *
 * The role is REPLACED with `group`, not removed. Deleting it outright leaves a
 * plain `div`, whose implicit role is `generic` — and `aria-label` is
 * *prohibited* on `generic` (ARIA 1.2 §5.2.8.4), so browsers drop it. That
 * turns "a button announcing all its children's labels" into "a focusable
 * element announcing nothing at all", which is strictly worse. `group` is the
 * role for a named container of related controls: it permits an accessible
 * name and imposes no requirements on its children.
 *
 * `tabIndex` and `aria-describedby` are kept — these elements are focusable,
 * each supplies its own Enter/Space handler, and the description points at
 * dnd-kit's live-region drag instructions. Callers must still give the element
 * its own `aria-label`; a `group` with no name is no better than a `div`.
 *
 * `EventBlock` already worked around the nesting problem for busy blocks by not
 * spreading `attributes` at all, and its comment explains why; this generalises
 * that fix instead of leaving it as a one-off.
 */
export function containerDragAttributes<T extends object>(
  attributes: T,
  options: { keyboardDraggable?: boolean } = {},
): Omit<T, 'role' | 'aria-pressed' | 'aria-roledescription' | 'aria-describedby'>
  & { role: 'group'; 'aria-describedby'?: string } {
  const {
    role,
    'aria-pressed': ariaPressed,
    'aria-roledescription': roleDescription,
    'aria-describedby': describedBy,
    ...rest
  } = attributes as T & {
    role?: unknown;
    'aria-pressed'?: unknown;
    'aria-roledescription'?: unknown;
    'aria-describedby'?: string;
  };
  void role;
  void ariaPressed;
  void roleDescription;
  // `aria-describedby` points at dnd-kit's live instructions: "To pick up a
  // draggable item, press the space bar. While dragging, use the arrow keys…".
  // True wherever the KeyboardSensor can actually fire — but a container that
  // supplies its own `onKeyDown` AFTER `{...listeners}` overrides the sensor's
  // activator, so the description becomes three false statements read out right
  // after the element's own name. Opt in only where the sensor really works.
  return options.keyboardDraggable
    ? { ...rest, 'aria-describedby': describedBy, role: 'group' }
    : { ...rest, role: 'group' };
}
