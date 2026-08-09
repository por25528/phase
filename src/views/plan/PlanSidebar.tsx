import type { ReactNode, Ref } from 'react';
import type { SidebarPanel } from '../../db/db';
import { useAppStore } from '../../state/store';
import { IconChevronRight } from '../../components/Icons';

/**
 * One collapsible sidebar panel.
 *
 * `count` stays visible while collapsed on purpose: the whole point of folding
 * these rather than deleting them is that the user can still see how many
 * habits are outstanding without giving them screen space.
 */
export function SidebarSection({
  panel, title, count, children,
}: {
  panel: SidebarPanel;
  title: string;
  count?: string;
  children: ReactNode;
}) {
  const { sidebarPanels, actions } = useAppStore();
  const open = sidebarPanels.includes(panel);

  function toggle() {
    actions.setSidebarPanels(
      open ? sidebarPanels.filter((p) => p !== panel) : [...sidebarPanels, panel],
    );
  }

  return (
    <div className="border-t border-line-soft">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-[8px] w-full text-left px-[4px] py-[8px] rounded-field hover:bg-hover transition-colors"
      >
        <span
          aria-hidden="true"
          className={`text-faint inline-flex flex-none transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        >
          <IconChevronRight size={11} />
        </span>
        <span className="font-mono text-tiny tracking-[.13em] uppercase text-muted font-semibold flex-1">
          {title}
        </span>
        {count && <span className="font-mono text-eyebrow text-muted tabular-nums flex-none">{count}</span>}
      </button>
      {open && <div className="pb-[10px] px-[2px]">{children}</div>}
    </div>
  );
}

/**
 * The Plan view's sidebar: a rail exactly as tall as the calendar beside it,
 * scrolling internally so it can never lengthen the page.
 *
 * The outer div is a stretched grid column — the grid's row is sized by the
 * calendar. The inner aside is absolutely positioned, so it contributes no
 * height of its own and cannot push the row taller no matter how much backlog
 * it holds. That is the entire bounding mechanism; there is no measurement.
 *
 * `right-[18px]` rather than `inset-0` plus padding out here: an absolutely
 * positioned element lays out against its ancestor's PADDING BOX, so padding
 * on the wrapper would be ignored and the rows would run into the divider.
 * The inset carries the gutter instead, which also keeps the scrollbar clear
 * of the rule.
 */
export function PlanSidebar({ children, railRef }: { children: ReactNode; railRef?: Ref<HTMLDivElement> }) {
  return (
    <div className="min-w-0 md:relative md:border-r md:border-line">
      <aside className="flex flex-col min-h-0 md:absolute md:inset-y-0 md:left-0 md:right-[18px]">
        <div ref={railRef} className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </aside>
    </div>
  );
}
