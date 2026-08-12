import type { GoalNode } from '../db/types';
import { useAppStore } from '../state/store';
import { Popover, PopoverItem, PopoverSeparator } from './Popover';
import { IconDots } from './Icons';
import { rowActionGroups, type RowActionId } from '../lib/rowActions';

/**
 * A task row's `⋯` menu.
 *
 * The verbs and their conditions live in `lib/rowActions.ts`; this only binds
 * them to the store. That split is the same one `commands.ts` and `App.tsx`
 * already use, and it is what lets "does a container offer Schedule?" be a
 * unit test instead of a mounted tree.
 *
 * The trigger is a `.quiet-control`, so it is invisible at rest on a
 * hover-capable pointer and always visible on a coarse one — the class carries
 * that gate, which is why a hand-rolled `opacity-0 group-hover:` would be
 * wrong here even though it looks identical on a laptop.
 */
export function RowActions({
  node,
  isFirstSibling,
  depth,
  onRename,
  onEstimate,
  onSchedule,
}: {
  node: GoalNode;
  isFirstSibling: boolean;
  depth: number;
  /** Row-local UI, not store state — the title swaps itself for an input. */
  onRename: () => void;
  /** Bumps the row's estimate control open. */
  onEstimate: () => void;
  /** Opens the row's own schedule popover. */
  onSchedule: () => void;
}) {
  const { actions } = useAppStore();
  const isContainer = Boolean(node.children && node.children.length > 0);

  const groups = rowActionGroups({
    isContainer,
    isDone: node.status === 'done',
    isMilestone: node.checkpoint === true,
    // Nothing above to nest under, and nothing above the root to rise to.
    canIndent: !isFirstSibling,
    canOutdent: depth > 0,
  });

  function run(id: RowActionId): void {
    switch (id) {
      case 'open': actions.openArea(node.id); return;
      case 'add-task': actions.addChild(node.id); return;
      case 'rename': onRename(); return;
      case 'schedule': onSchedule(); return;
      case 'estimate': onEstimate(); return;
      case 'milestone': actions.toggleCheckpoint(node.id); return;
      case 'indent': actions.indentNode(node.id); return;
      case 'outdent': actions.outdentNode(node.id); return;
      case 'delete': actions.removeNode(node.id); return;
    }
  }

  return (
    <Popover
      label={`Actions for "${node.title}"`}
      role="menu"
      align="end"
      panelWidth={196}
      triggerClassName="quiet-control text-faint flex-shrink-0 rounded-[4px] hover:text-ink hover:bg-hover"
      trigger={<IconDots size={13} />}
    >
      {(close) =>
        groups.map((group, i) => (
          <div key={group[0].id}>
            {i > 0 && <PopoverSeparator />}
            {group.map((action) => (
              <PopoverItem
                key={action.id}
                close={close}
                hint={action.hint}
                tone={action.tone}
                onSelect={() => run(action.id)}
              >
                {action.label}
              </PopoverItem>
            ))}
          </div>
        ))
      }
    </Popover>
  );
}
