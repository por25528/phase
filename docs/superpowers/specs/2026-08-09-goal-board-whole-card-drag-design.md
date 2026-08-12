# Goal Board Whole-Card Drag — Design

**Status:** approved design, ready for implementation planning  
**Date:** 2026-08-09  
**Scope:** The task cards on a goal workspace's Board tab.

## Summary

Make the whole visible task card a drag activator. A normal click anywhere on
the card continues to open the task inspector; pressing and moving beyond the
existing four-pixel threshold starts a drag. The grip remains as a visual cue,
but is no longer the only draggable target.

## Interaction design

- The card is one full-size button carrying dnd-kit's drag attributes and
  listeners.
- A click invokes the existing `openStep` path.
- A pointer movement of at least four pixels invokes the existing drag flow.
- Dropping over a different status column invokes the existing `setNodeStatus`
  path. Dropping in the current column or outside a column remains a no-op.
- The grip icon is decorative and remains visible in the card's top-right
  corner so drag capability is discoverable.

## Architecture

Change only the `Card` component in `src/views/project/BoardTab.tsx`. Move the
dnd-kit attributes and listeners from the small grip button to the existing
full-card button, then render the grip as a non-interactive, accessibility-hidden
element inside that button. The surrounding `DndContext`, sensors, columns,
drag overlay, and persistence flow do not change.

Using one interactive element avoids nested button semantics and lets dnd-kit's
activation constraint distinguish clicks from drags without custom pointer
state.

## Accessibility

The full card remains a native button with the task content as its accessible
name. It receives dnd-kit's draggable metadata and keyboard listeners. The grip
is `aria-hidden` because it duplicates the card's drag semantics.

## Testing

Add a focused component regression test that identifies the content button as
the drag activator and confirms clicking that same surface still opens the task
inspector. Existing board tests continue to cover rendering, filtering, and
opening cards. Run the focused Board tab test suite, then the full test and build
checks.

## Non-goals

- Reordering tasks within a status column.
- Changing status values, persistence, the drag overlay, or drop behavior.
- Redesigning the card's content, columns, or visual styling.
