// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AvailabilityWindow, Goal, GoalNode } from '../db/types';
import { cssBlock } from '../lib/contrast';

const dbMocks = vi.hoisted(() => ({
  loadState: vi.fn(async (): Promise<{ goals: Goal[]; habits: never[]; tasks: never[]; sessions: never[] }> => ({ goals: [], habits: [], tasks: [], sessions: [] })),
  loadScale: vi.fn(async () => 13),
  loadPlanReview: vi.fn(async () => null),
  loadAvailability: vi.fn(async (): Promise<AvailabilityWindow[]> => [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, startMin: 540, endMin: 1080 }))),
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
vi.mock('../db/db', () => dbMocks);
vi.mock('../lib/tabLock', () => ({ acquireTabLock: vi.fn(async () => true) }));

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

async function renderTree(nodes: GoalNode[]): Promise<void> {
  vi.resetModules();
  const goal: Goal = { id: 'g', title: 'Systems', column: 0, nodes: structuredClone(nodes) };
  dbMocks.loadState.mockResolvedValueOnce({ goals: [goal], habits: [], tasks: [], sessions: [] });
  const store = await import('../state/store');
  await store.initStore();
  store.actions.openProject('g');
  const { GoalTree } = await import('./GoalTree');
  const TreeHost = () => {
    const { goals } = store.useAppStore();
    return createElement(GoalTree, { nodes: goals[0].nodes });
  };
  render(createElement(TreeHost));
}

const row = (title: string) => screen.getByText(title).closest('[data-row]') as HTMLElement;

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('a leaf with metadata', () => {
  it('renders its schedule on the second line, not in a right-edge cell', async () => {
    await renderTree([{ id: 'a', title: 'Ship it', plannedWeek: '2026-08-10' }]);
    const meta = within(row('Ship it')).getByTestId('row-meta-below');
    expect(within(meta).getByRole('button', { name: /Schedule|Scheduled/ })).toBeTruthy();
  });

  it('puts the estimate on that same second line', async () => {
    await renderTree([{ id: 'a', title: 'Ship it', estimateMin: 45 }]);
    const meta = within(row('Ship it')).getByTestId('row-meta-below');
    expect(within(meta).getByText(/45m/)).toBeTruthy();
  });
});

describe('a leaf with nothing to say', () => {
  // The reflow guarantee. jsdom has no layout, so we assert the STRUCTURE that
  // produces it: there is no second-line element, so nothing can appear below
  // the title and push the list down.
  it('renders NO second line at all', async () => {
    await renderTree([{ id: 'a', title: 'Bare task' }]);
    expect(within(row('Bare task')).queryByTestId('row-meta-below')).toBeNull();
  });

  it('carries its schedule control inline, on the line that already exists', async () => {
    await renderTree([{ id: 'a', title: 'Bare task' }]);
    const inline = within(row('Bare task')).getByTestId('row-meta-inline');
    expect(within(inline).getByRole('button', { name: /Schedule/ })).toBeTruthy();
  });

  // The whole point of one component in two positions: hovering a bare row must
  // reveal the SAME controls a populated row shows, not a reduced set.
  //
  // Asserted as "both kinds of control are present in both placements", NOT as
  // string equality of their labels. The labels SHOULD differ — an unset
  // control says `Schedule "X"` / `Set estimate for "X"` while a set one says
  // `Scheduled This week. Change it` / `Estimate for "X": 45m. Change it`,
  // because each names its own state. A test demanding they match would be
  // asserting a bug.
  it('offers the same two controls in both placements', async () => {
    await renderTree([{ id: 'a', title: 'Bare task' }, { id: 'b', title: 'Full task', estimateMin: 45 }]);
    const bare = within(row('Bare task')).getByTestId('row-meta-inline');
    const full = within(row('Full task')).getByTestId('row-meta-below');

    expect(within(bare).getByRole('button', { name: /^Schedule "/ })).toBeTruthy();
    expect(within(bare).getByRole('button', { name: /^Set estimate for "/ })).toBeTruthy();

    expect(within(full).getByRole('button', { name: /^Schedule "/ })).toBeTruthy();
    expect(within(full).getByRole('button', { name: /^Estimate for ".*": 45m/ })).toBeTruthy();

    // Neither placement holds a control the other lacks.
    expect(within(bare).getAllByRole('button')).toHaveLength(within(full).getAllByRole('button').length);
  });
});

describe('a container', () => {
  it('keeps its percentage on line 1 and has no second line', async () => {
    await renderTree([{ id: 'p', title: 'Parent', children: [{ id: 'c', title: 'Child' }] }]);
    const parent = row('Parent');
    expect(within(parent).getByText('0%')).toBeTruthy();
    expect(within(parent).queryByTestId('row-meta-below')).toBeNull();
  });
});

// `LeafMeta` used to render at two different JSX positions depending on
// `metaPlacement` — inline under column 2's flex row, or in a second `<div>`
// below it. The instant a bare leaf gained its first estimate or schedule,
// `metaPlacement` flipped `inline` → `below` and `LeafMeta` unmounted from one
// parent and remounted under another, destroying its subtree's state —
// including whatever had just received focus inside it. A stable `key`
// cannot fix this: keys only disambiguate siblings under a single parent, and
// here the parent itself changed. The fix renders `LeafMeta` at one position
// always and repositions it with CSS (`flex-wrap` + `order-last`), so the
// element — and its focus — never moves in the DOM.
describe('a bare leaf gaining metadata', () => {
  it('keeps focus on the estimate control after setting an estimate', async () => {
    await renderTree([{ id: 'a', title: 'Bare task' }]);
    const inline = within(row('Bare task')).getByTestId('row-meta-inline');
    const badge = within(inline).getByRole('button', { name: /^Set estimate for "/ });
    fireEvent.click(badge);
    const preset = screen.getByRole('button', { name: /^Set estimate for ".*" to 30m$/ });
    fireEvent.click(preset);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('keeps focus on the schedule trigger after setting a schedule', async () => {
    await renderTree([{ id: 'a', title: 'Bare task' }]);
    const inline = within(row('Bare task')).getByTestId('row-meta-inline');
    const scheduleBtn = within(inline).getByRole('button', { name: /^Schedule "/ });
    fireEvent.click(scheduleBtn);
    const tomorrow = screen.getByRole('menuitem', { name: 'Tomorrow' });
    fireEvent.click(tomorrow);
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('adding a task', () => {
  it('spells the verb the same way everywhere', async () => {
    await renderTree([{ id: 'p', title: 'Parent', children: [{ id: 'c', title: 'Child' }] }]);
    // The nested input, inside the expanded container.
    expect(screen.getByPlaceholderText('+ Add task')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/add item/i)).toBeNull();
  });

  // This has to be a SOURCE-level assertion, not a DOM one: jsdom's
  // `HTMLElement.focus()` does not consult computed style — a real browser
  // refuses focus on a `display: none` element, jsdom happily grants it. A
  // test that called `.focus()` on the input and checked `document.activeElement`
  // would pass whether the CSS hid it with `opacity: 0` (keyboard-reachable) or
  // `display: none` (stranded) — it cannot discriminate the regression it
  // claims to guard, in this environment. So it reads `index.css` instead,
  // the same approach `designScale.test.ts` and `contrast.test.ts` use for
  // stylesheet-level guarantees.
  it('gates the nested input with opacity, never display or visibility', () => {
    // `import.meta.url` is not a resolvable `file://` URL under the jsdom
    // environment this file runs in (unlike the plain-node test files that
    // already do this), so the path is built from the repo root instead.
    const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');

    // At rest, `.subtree-reveal` must stay in flow and in the a11y tree.
    const base = cssBlock(css, '.subtree-reveal');
    expect(base).toMatch(/\bopacity\s*:\s*1\b/);
    expect(base).not.toMatch(/\bdisplay\s*:\s*none\b/);
    expect(base).not.toMatch(/\bvisibility\s*:\s*hidden\b/);

    // The hover-gated rule inside `@media (hover: hover)` is what actually
    // hides the input on an unhovered subtree — it must do so with opacity,
    // never `display: none` or `visibility: hidden`, either of which would
    // remove it from the keyboard/focus tree.
    const hidden = cssBlock(css, '.subtree:not(:hover) .subtree-reveal:not(:focus-within)');
    expect(hidden).toMatch(/\bopacity\s*:\s*0\b/);
    expect(hidden).not.toMatch(/\bdisplay\s*:\s*none\b/);
    expect(hidden).not.toMatch(/\bvisibility\s*:\s*hidden\b/);
  });

  it('gates the nested input on subtree hover, not row hover', async () => {
    await renderTree([{ id: 'p', title: 'Parent', children: [{ id: 'c', title: 'Child' }] }]);
    const input = screen.getByPlaceholderText('+ Add task');
    const wrap = input.closest('.subtree-reveal');
    expect(wrap).not.toBeNull();
    expect(wrap!.closest('.subtree')).not.toBeNull();
    // Never the row's own gate — that would reveal on the wrong hover.
    expect(input.closest('.quiet-control')).toBeNull();
  });
});
