import type { GoalNode } from '../db/types';
import { useAppStore } from '../state/store';
import { Popover, PopoverItem, PopoverSeparator } from './Popover';
import { PropertyOption } from './PropertyRow';
import { IconDots } from './Icons';
import { DEMANDS, DEMAND_WORD, type Demand } from '../lib/demand';
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
    isParked: node.status === 'parked',
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
      case 'park': actions.toggleParked(node.id); return;
      case 'indent': actions.indentNode(node.id); return;
      case 'outdent': actions.outdentNode(node.id); return;
      case 'delete': actions.removeNode(node.id); return;
    }
  }

  function demandPanel(closeNested: () => void, closeOuter: () => void) {
    // Both close: the submenu AND the menu it opened from — the other verbs
    // each close the whole menu when they commit, and a verb that left its menu
    // standing after a write would be the only one that did.
    const choose = (next: Demand | null) => {
      closeNested();
      closeOuter();
      actions.setNodeDemand(node.id, next);
    };
    return (
      <>
        {DEMANDS.map((d) => (
          <PropertyOption
            key={d}
            close={closeNested}
            current={node.demand === d}
            onSelect={() => choose(d)}
          >
            {DEMAND_WORD[d]}
          </PropertyOption>
        ))}
        <PropertyOption
          close={closeNested}
          current={node.demand === undefined}
          onSelect={() => choose(null)}
        >
          Not set
        </PropertyOption>
      </>
    );
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
            {group.map((action) =>
              action.id === 'demand' ? (
                <Popover
                  key={action.id}
                  label="Focus needed…"
                  role="menu"
                  align="end"
                  panelWidth={160}
                  triggerClassName="w-full text-left px-[12px] py-[6px] text-ui flex items-center gap-[9px] text-ink-soft hover:bg-hover hover:text-ink"
                  trigger={<span className="flex-1 min-w-0 truncate">{action.label}</span>}
                >
                  {(closeNested) => demandPanel(closeNested, close)}
                </Popover>
              ) : (
                <PopoverItem
                  key={action.id}
                  close={close}
                  hint={action.hint}
                  tone={action.tone}
                  onSelect={() => run(action.id)}
                >
                  {action.label}
                </PopoverItem>
              ),
            )}
          </div>
        ))
      }
    </Popover>
  );
}
