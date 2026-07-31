import { describe, expect, it } from 'vitest';
import { containerDragAttributes } from './dragAttributes';

// The exact shape dnd-kit returns from useDraggable/useSortable.
const DND_ATTRIBUTES = {
  role: 'button',
  tabIndex: 0,
  'aria-disabled': false,
  'aria-pressed': undefined,
  'aria-roledescription': 'draggable',
  'aria-describedby': 'DndDescribedBy-0',
} as const;

describe('containerDragAttributes', () => {
  it('drops the handle-only semantics that break a container', () => {
    const out = containerDragAttributes(DND_ATTRIBUTES);
    expect('aria-pressed' in out).toBe(false);
    expect('aria-roledescription' in out).toBe(false);
  });

  /**
   * Removing the role outright leaves a plain `div`, whose implicit role is
   * `generic` — and `aria-label` is PROHIBITED on `generic`, so browsers drop
   * it. That turns "a button announcing all its children's labels" into "a
   * focusable element announcing nothing at all". `group` permits a name and
   * imposes nothing on its children.
   */
  it('substitutes a role that can still carry an accessible name', () => {
    expect(containerDragAttributes(DND_ATTRIBUTES).role).toBe('group');
  });

  it('keeps focusability', () => {
    const out = containerDragAttributes(DND_ATTRIBUTES);
    expect(out.tabIndex).toBe(0);
    expect(out['aria-disabled']).toBe(false);
  });

  /**
   * dnd-kit's `aria-describedby` target reads "To pick up a draggable item,
   * press the space bar. While dragging, use the arrow keys…". True wherever
   * the KeyboardSensor can fire — and false on a container that spreads its own
   * `onKeyDown` after `{...listeners}`, which overrides the sensor's activator.
   * The board card does exactly that (Enter and Space open the project, Alt+
   * arrows move it), so it was announcing three instructions that all did
   * something else.
   */
  it('drops the drag instructions unless the keyboard sensor really works', () => {
    expect(containerDragAttributes(DND_ATTRIBUTES)['aria-describedby']).toBeUndefined();
    expect(containerDragAttributes(DND_ATTRIBUTES, { keyboardDraggable: true })['aria-describedby'])
      .toBe('DndDescribedBy-0');
  });

  it('does not mutate what it was handed', () => {
    const input = { ...DND_ATTRIBUTES };
    containerDragAttributes(input);
    expect(input.role).toBe('button');
    expect(input['aria-roledescription']).toBe('draggable');
  });
});
