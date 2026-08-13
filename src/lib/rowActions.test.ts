import { describe, expect, it } from 'vitest';
import { rowActionGroups, rowActions, taskPageActions, taskPageActionGroups, type RowActionContext } from './rowActions';

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

describe('taskPageActions', () => {
  const leaf = { canIndent: true, canOutdent: true };

  it('offers rename, breakdown, indent, outdent and delete', () => {
    expect(taskPageActions(leaf).map((a) => a.id)).toEqual([
      'rename', 'breakdown', 'indent', 'outdent', 'delete',
    ]);
  });

  /**
   * The row's menu must NOT grow it. `ProposalPanel` is leaf-only and lives on
   * the page, so a tree row offering the verb would open a surface the row has
   * nowhere to put.
   */
  it('keeps breakdown off the tree row, where the panel cannot open', () => {
    const ctx: RowActionContext = {
      isContainer: false, isDone: false, isMilestone: false,
      canIndent: true, canOutdent: true,
    };
    expect(rowActions(ctx).map((a) => a.id)).not.toContain('breakdown');
  });

  it('omits the verbs the page already shows as chips', () => {
    const ids = taskPageActions(leaf).map((a) => a.id);
    expect(ids).not.toContain('schedule');
    expect(ids).not.toContain('estimate');
    expect(ids).not.toContain('milestone');
  });

  it('omits add-task: converting a task into a group would eject the page', () => {
    expect(taskPageActions(leaf).map((a) => a.id)).not.toContain('add-task');
  });

  it('drops indent for a first sibling and outdent at the root', () => {
    const stuck = { ...leaf, canIndent: false, canOutdent: false };
    expect(taskPageActions(stuck).map((a) => a.id)).toEqual(['rename', 'breakdown', 'delete']);
  });

  it('groups rename, breakdown, the move verbs and delete apart', () => {
    expect(taskPageActionGroups(leaf).map((g) => g.map((a) => a.id))).toEqual([
      ['rename'], ['breakdown'], ['indent', 'outdent'], ['delete'],
    ]);
  });
});
