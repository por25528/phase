import type { ReactNode } from 'react';
import { useAppStore } from '../state/store';
import { SegmentedControl } from './SegmentedControl';
import { labelCls } from './dialogStyles';
import type { ShelfPrefs } from '../lib/shelfPrefs';

/**
 * The Cmd+Space shelf's settings group.
 *
 * Not desktop-gated the way the pill's group is, and that asymmetry is
 * deliberate: the shelf also renders as an in-app panel in the browser build,
 * so density and the two section switches are real there. The width and the
 * placement are the desktop half, and the copy below says out loud that they
 * land on the next summon — a panel that resized under the cursor while it was
 * open would read as a glitch, so the control genuinely does nothing until you
 * summon it again, and a control that looks inert is one people press four
 * times.
 *
 * It reads and writes the STORE rather than Dexie directly, unlike
 * `OverlaySettings`: the shelf's content half rides the assistant relay, whose
 * model is built from store state. `App` watches the field and pushes the
 * geometry half to main.
 */

function Choice({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 px-2 py-2 text-ui">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

function SectionSwitch({ checked, label, onToggle }: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded-field px-2 py-2 text-left text-ui hover:bg-hover"
    >
      <span className="text-ink">{label}</span>
      <span
        aria-hidden="true"
        className={
          'ml-3 shrink-0 h-[18px] w-[32px] rounded-field border p-[2px] '
          + (checked ? 'border-ink bg-ink' : 'border-check bg-panel')
        }
      >
        <span
          className={
            'block h-[12px] w-[12px] rounded-field bg-panel transition-transform duration-150 '
            + (checked ? 'translate-x-[12px]' : 'translate-x-0')
          }
        />
      </span>
    </button>
  );
}

export function ShelfSettings() {
  const { shelfPrefs, actions } = useAppStore();

  // One writer for the whole row, so a change can never save half of it.
  const change = (patch: Partial<ShelfPrefs>) => {
    actions.setShelfPrefs({ ...shelfPrefs, ...patch });
  };

  return (
    <div>
      <Choice label="Width">
        <SegmentedControl
          name="shelf-width"
          label="Shelf width"
          value={shelfPrefs.width}
          onChange={(width) => change({ width })}
          options={[
            { value: 'narrow', label: 'Narrow' },
            { value: 'default', label: 'Default' },
            { value: 'wide', label: 'Wide' },
          ]}
        />
      </Choice>

      <Choice label="Density">
        <SegmentedControl
          name="shelf-density"
          label="Shelf density"
          value={shelfPrefs.density}
          onChange={(density) => change({ density })}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
        />
      </Choice>

      <Choice label="Position">
        <SegmentedControl
          name="shelf-position"
          label="Shelf position"
          value={shelfPrefs.position}
          onChange={(position) => change({ position })}
          options={[
            { value: 'center', label: 'Centre' },
            { value: 'top-center', label: 'Top' },
          ]}
        />
      </Choice>

      {/* The work band takes no switch: a shelf that cannot control a running
          session is broken, not customized. Both of these are lists. */}
      <SectionSwitch
        checked={shelfPrefs.sections.alternatives}
        label="Show other options"
        onToggle={() => change({
          sections: { ...shelfPrefs.sections, alternatives: !shelfPrefs.sections.alternatives },
        })}
      />
      <SectionSwitch
        checked={shelfPrefs.sections.dials}
        label="Show the time and focus dials"
        onToggle={() => change({
          sections: { ...shelfPrefs.sections, dials: !shelfPrefs.sections.dials },
        })}
      />

      <p className="mt-[10px] px-2 text-meta text-muted leading-[1.5]">
        A new width or place takes effect the next time you summon it — a panel
        that resized while it was open would read as a glitch.
      </p>
    </div>
  );
}
