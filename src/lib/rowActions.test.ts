import { describe, expect, it } from 'vitest';
import { rowActionGroups, rowActions, type RowActionContext } from './rowActions';

const ctx = (over: Partial<RowActionContext> = {}): RowActionContext => ({
  isContainer: false,
  isDone: false,
  isMilestone: false,
  canIndent: true,
  canOutdent: true,
  ...over,
});

const ids = (c: RowActionContext) => rowActions(c).map((a) => a.id);

describe('rowActions', () => {
  it('offers Open on a container only', () => {
    expect(ids(ctx({ isContainer: true }))).toContain('open');
    expect(ids(ctx({ isContainer: false }))).not.toContain('open');
  });

  it('keeps scheduling and estimating off containers', () => {
    // The store agrees: a container has no `estimateMin` and no `blocks`, and
    // is scheduled through its tasks.
    const container = ids(ctx({ isContainer: true }));
    expect(container).not.toContain('schedule');
    expect(container).not.toContain('estimate');
    expect(container).not.toContain('milestone');
  });

  it('offers scheduling and estimating on a leaf', () => {
    const leaf = ids(ctx());
    expect(leaf).toContain('schedule');
    expect(leaf).toContain('estimate');
  });

  it('keeps the repair verbs on a done leaf', () => {
    // A mis-ticked checkbox must stay fixable from the row it was mis-ticked
    // on. Removing these would make an accident permanent.
    const done = ids(ctx({ isDone: true }));
    expect(done).toContain('schedule');
    expect(done).toContain('estimate');
    expect(done).toContain('delete');
  });

  it('names the milestone verb by what pressing it would do', () => {
    const off = rowActions(ctx({ isMilestone: false })).find((a) => a.id === 'milestone');
    const on = rowActions(ctx({ isMilestone: true })).find((a) => a.id === 'milestone');
    expect(off?.label).toBe('Make a milestone');
    expect(on?.label).toBe('Not a milestone');
  });

  it('drops Indent for a first child and Outdent at the root', () => {
    expect(ids(ctx({ canIndent: false }))).not.toContain('indent');
    expect(ids(ctx({ canOutdent: false }))).not.toContain('outdent');
    const both = ids(ctx({ canIndent: false, canOutdent: false }));
    expect(both).not.toContain('indent');
    expect(both).not.toContain('outdent');
  });

  it('always ends on Delete, marked destructive', () => {
    for (const c of [ctx(), ctx({ isContainer: true }), ctx({ canIndent: false })]) {
      const actions = rowActions(c);
      expect(actions.at(-1)?.id).toBe('delete');
      expect(actions.at(-1)?.tone).toBe('danger');
    }
  });

  it('does not offer a verb the store cannot perform', () => {
    // Duplicate and Move-to-goal have no action behind them. A menu item that
    // needs a new undoable mutation first is a feature, not a menu change.
    const every = [...ids(ctx()), ...ids(ctx({ isContainer: true }))];
    expect(every).not.toContain('duplicate');
    expect(every).not.toContain('move');
  });

  it('teaches the keyboard route beside the verb', () => {
    const byId = new Map(rowActions(ctx()).map((a) => [a.id, a.hint]));
    expect(byId.get('estimate')).toBe('E');
    expect(byId.get('schedule')).toBe('⇧S');
    expect(byId.get('rename')).toBe('↵');
    expect(byId.get('indent')).toBe('⌘]');
    expect(byId.get('outdent')).toBe('⌘[');
  });

  it('never offers the same verb twice', () => {
    for (const c of [ctx(), ctx({ isContainer: true }), ctx({ isDone: true })]) {
      const list = ids(c);
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe('rowActionGroups', () => {
  it('splits the list into contiguous runs', () => {
    const groups = rowActionGroups(ctx());
    expect(groups.flat().map((a) => a.id)).toEqual(ids(ctx()));
    expect(groups.length).toBeGreaterThan(1);
  });

  it('gives every run one group number', () => {
    for (const group of rowActionGroups(ctx({ isContainer: true }))) {
      expect(new Set(group.map((a) => a.group)).size).toBe(1);
    }
  });

  it('isolates Delete in its own run', () => {
    const last = rowActionGroups(ctx()).at(-1);
    expect(last?.map((a) => a.id)).toEqual(['delete']);
  });
});
