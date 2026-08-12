# Goal Board Whole-Card Drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every visible point on a goal Board task card start a drag after pointer movement while preserving click-to-open behavior.

**Architecture:** Collapse the task card's wrapper, dedicated drag button, and content button into one native full-card button. Attach the existing dnd-kit draggable ref, attributes, and listeners to that button, while retaining the grip as a decorative child and leaving the board's drag/drop state flow unchanged.

**Tech Stack:** React 19, TypeScript, dnd-kit, Vitest, Testing Library, Tailwind CSS

---

## File map

- `src/views/project/BoardTab.tsx` — change the task card's interaction surface; no board state or drop behavior changes.
- `src/views/project/BoardTab.test.tsx` — prove one full-card button owns both drag semantics and click-to-open.

### Task 1: Make the task card the drag activator

**Files:**
- Modify: `src/views/project/BoardTab.test.tsx:115-123`
- Modify: `src/views/project/BoardTab.tsx:226-258`

- [ ] **Step 1: Write the failing interaction test**

Replace the existing click-to-open test with a regression test that checks the same card surface for both responsibilities:

```tsx
  it('uses the whole card surface for both dragging and opening', async () => {
    const { store } = await mount(BIG);
    const card = screen.getByText('Auth').closest('button')!;

    expect(card.getAttribute('aria-roledescription')).toBe('draggable');
    expect(card.tabIndex).toBe(0);
    expect(screen.queryByRole('button', { name: 'Drag "Auth"' })).toBeNull();

    fireEvent.click(card);
    expect(store.getState().openStepId).toBe('Auth');
  });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- src/views/project/BoardTab.test.tsx
```

Expected: FAIL in `uses the whole card surface for both dragging and opening` because the content button has no `aria-roledescription="draggable"` and a separate `Drag "Auth"` button still exists.

- [ ] **Step 3: Implement the minimal whole-card activator**

Replace the `Card` return value with one button. Keep the current transform and opacity behavior, attach the draggable ref/metadata/listeners to that button, and make the grip decorative:

```tsx
function Card({ card, onOpen }: { card: BoardCard; onOpen: (nodeId: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.node.id });
  return (
    <button
      type="button"
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 1 } : undefined}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card.node.id)}
      className={`group relative w-full text-left px-[9px] py-[8px] bg-panel border border-line rounded-[6px] cursor-grab active:cursor-grabbing hover:bg-hover ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <span
        aria-hidden="true"
        className="absolute top-[4px] right-[4px] w-[24px] h-[24px] grid place-items-center text-faint"
      >
        <IconGrip size={12} />
      </span>
      <CardBody node={card.node} areaPath={card.areaPath} />
    </button>
  );
}
```

The board's `PointerSensor` retains its four-pixel activation constraint, so an unmoved click reaches `onClick` while a pointer drag activates dnd-kit.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- src/views/project/BoardTab.test.tsx
```

Expected: all tests in `BoardTab.test.tsx` PASS with no warnings.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected: the complete Vitest suite passes; TypeScript and Vite production build complete successfully.

- [ ] **Step 6: Commit the implementation**

```bash
git add src/views/project/BoardTab.tsx src/views/project/BoardTab.test.tsx
git commit -m "feat(board): drag tasks from the whole card"
```
