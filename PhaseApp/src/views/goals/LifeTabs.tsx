import { Tabs } from '../../components/Tabs';
import type { LifeScope, LifeTab } from '../../lib/lifeScope';

/**
 * Which life the board is showing.
 *
 * Renders NOTHING when no life has been named. A lone `All` tab is chrome that
 * explains nothing to someone who has never made a life, and the route in is
 * the header's ⋯ → Manage lives.
 *
 * `max-w-[180px] truncate` on the tab itself, in `Tabs`: a life named
 * "Undergraduate Research Assistantship" must not blow out the strip. `title`
 * carries the whole name for the pointer.
 */
export function LifeTabs({
  tabs,
  scope,
  onChange,
}: {
  tabs: LifeTab[];
  scope: LifeScope;
  onChange: (scope: LifeScope) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <Tabs
      label="Show life"
      value={scope}
      items={tabs.map((t) => ({ value: t.scope, label: t.label }))}
      onChange={onChange}
      idPrefix="life-tab"
      controls="goalsBoard"
    />
  );
}
