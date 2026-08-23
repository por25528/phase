// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Goal, Life } from '../../db/types';

/**
 * The bay lens must not move under the cursor.
 *
 * `bayFace` is derived from what a bay HOLDS, and `handleDragOver` changes
 * what a bay holds LIVE — so the two together would re-cut every surviving
 * title, and re-hang every life tag, in the middle of a drag. This is the same
 * question `columnTracks({ dragging })` already answered for the column
 * widths; the test dispatches dnd-kit's handlers directly, because a synthetic
 * pointer drag in jsdom never reaches them.
 */

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: never[]; lives: Life[] }> => ({
    goals: [], habits: [], tasks: [], sessions: [], lives: [],
  })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async () => []),
  loadAllDayBlocks: vi.fn(async () => true),
  loadSidebarPanels: vi.fn(async () => []),
  saveScale: vi.fn(async () => {}),
  savePlanReview: vi.fn(async () => {}),
  saveAvailability: vi.fn(async () => {}),
  saveAllDayBlocks: vi.fn(async () => {}),
  saveSidebarPanels: vi.fn(async () => {}),
  loadPlanMode: vi.fn(async () => 'week' as const),
  savePlanMode: vi.fn(async () => {}),
  loadGoalsMode: vi.fn(async (): Promise<'board' | 'timeline'> => 'board'),
  saveGoalsMode: vi.fn(async () => {}),
  persist: vi.fn(async () => {}),
  exportState: vi.fn(),
  importStateFromFile: vi.fn(),
  isSlotMigrationDone: vi.fn(async () => true),
  saveSlotMigrationSnapshot: vi.fn(async () => {}),
  loadSlotMigrationSnapshot: vi.fn(async () => null),
  markSlotMigrationDone: vi.fn(async () => {}),
  isCheckpointMigrationDone: vi.fn(async () => true),
  saveCheckpointMigrationSnapshot: vi.fn(async () => {}),
  loadCheckpointMigrationSnapshot: vi.fn(async () => null),
  markCheckpointMigrationDone: vi.fn(async () => {}),
  loadActiveFocusSession: vi.fn(async () => null),
  saveActiveFocusSession: vi.fn(async () => {}),
  loadAssistantAccelerator: vi.fn(async () => 'Command+Space'),
  saveAssistantAccelerator: vi.fn(async () => {}),
  loadStoredTimeLevel: vi.fn(async () => null),
  saveStoredTimeLevel: vi.fn(async () => {}),
  loadStoredFocusLevel: vi.fn(async () => null),
  saveStoredFocusLevel: vi.fn(async () => {}),
}));
vi.mock('../../db/db', () => dbMocks);
vi.mock('../../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

/**
 * The handlers `Goals` hands to `DndContext`, captured on the way past.
 *
 * The REAL context still renders the tree — `Column` and `BoardCard` call
 * `useDroppable`/`useSortable` and would throw without it — so this only
 * copies the props out; it changes nothing about what is drawn.
 */
const dnd = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    DndContext: (props: Record<string, unknown>) => {
      dnd.props = props;
      return createElement(actual.DndContext, props as never);
    },
  };
});

beforeAll(() => {
  // As in Goals.board.test.tsx: `matches: true` also selects the wide
  // four-column board, which is the one a drag can cross.
  Element.prototype.scrollIntoView = () => {};
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => cleanup());

const CU: Life = { id: 'cu', title: 'CU', order: 0 };

/*
 * Two cards in Now, one life between them and one shared head. The bay
 * therefore hides BOTH: no `CU` tag, and each title cut back to what makes it
 * different. Take either card out and the survivor is alone — `FULL_FACE` —
 * so the live reading would restore the head and the tag at once.
 */
const BAY_OF_TWO: Goal[] = [
  { id: 'a', title: 'Midterm — Data Structures', nodes: [], column: 0, lifeId: 'cu' },
  { id: 'b', title: 'Midterm — Data Science', nodes: [], column: 0, lifeId: 'cu' },
];

async function mountBoard(goals: Goal[], lives: Life[]) {
  vi.resetModules();
  dnd.props = null;
  dbMocks.loadState.mockResolvedValueOnce({
    goals: structuredClone(goals), habits: [], tasks: [], sessions: [], lives: structuredClone(lives),
  });
  const store = await import('../../state/store');
  await store.initStore();
  const { Goals } = await import('../Goals');
  const Host = () => { store.useAppStore(); return createElement(Goals); };
  await act(async () => { render(createElement(Host)); });
  return store;
}

function cardText(id: string): string {
  const el = document.getElementById(`goal-card-${id}`);
  expect(el).toBeTruthy();
  return el!.textContent ?? '';
}

function fire(name: string, payload: unknown) {
  const handler = dnd.props?.[name] as ((e: unknown) => void) | undefined;
  expect(handler).toBeTypeOf('function');
  act(() => { handler!(payload); });
}

describe('the bay lens while something is in the air', () => {
  it('holds the face it had at drag start when dragOver empties the bay', async () => {
    await mountBoard(BAY_OF_TWO, [CU]);

    // At rest the bay is doing its job: the shared head is gone from both
    // titles and neither card repeats the life.
    expect(cardText('b')).toContain('Science');
    expect(cardText('b')).not.toContain('Midterm');
    expect(cardText('b')).not.toContain('CU');

    const atStart = cardText('b');

    fire('onDragStart', { active: { id: 'a' } });
    expect(cardText('b')).toBe(atStart);

    // `a` crosses into Next. The source bay now holds one card, which read
    // live would be `FULL_FACE` — the whole point of the freeze.
    fire('onDragOver', { active: { id: 'a' }, over: { id: 'col-1' } });
    expect(cardText('b')).toBe(atStart);
    expect(cardText('b')).not.toContain('Midterm');
    expect(cardText('b')).not.toContain('CU');
  });

  it('settles once, on drop', async () => {
    await mountBoard(BAY_OF_TWO, [CU]);

    fire('onDragStart', { active: { id: 'a' } });
    fire('onDragOver', { active: { id: 'a' }, over: { id: 'col-1' } });
    await act(async () => { (dnd.props!.onDragEnd as (e: unknown) => void)({ active: { id: 'a' }, over: { id: 'col-1' } }); });

    // Alone in Now, `b` states itself in full again — head and life tag both.
    expect(cardText('b')).toContain('Midterm — Data Science');
    expect(cardText('b')).toContain('CU');
  });

  it('settles on cancel too, rather than holding a face nothing produced', async () => {
    await mountBoard(BAY_OF_TWO, [CU]);
    const atStart = cardText('b');

    fire('onDragStart', { active: { id: 'a' } });
    fire('onDragOver', { active: { id: 'a' }, over: { id: 'col-1' } });
    await act(async () => { (dnd.props!.onDragCancel as () => void)(); });

    // Nothing moved, so the face is the one it started with — restored by a
    // fresh computation, not by the frozen copy still being in hand.
    expect(cardText('b')).toBe(atStart);
  });
});
