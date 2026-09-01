import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { shellBridge } from '../../lib/shellBridge';
import { loadPillPrefs, savePillPrefs } from '../../db/db';
import { DEFAULT_PILL_PREFS, type PillPrefs } from '../../lib/pillPrefs';
import { SegmentedControl } from '../SegmentedControl';
import { labelCls } from '../dialogStyles';

/**
 * The floating timer's settings group.
 *
 * Desktop-only, exactly as LaunchAtLoginSettings is: the browser has no
 * always-on-top window, so in the web build this whole group simply is not
 * there — the same reason `BackupsSettings` owns its own heading. It began as
 * one switch and kept the filename: git history reads better than a rename
 * plus a rewrite in the same commit.
 *
 * Unlike the login item, the row is OURS (Dexie), so every control moves
 * immediately and the write is fire-and-forget — there is no OS to refuse.
 * Every change does BOTH halves: `savePillPrefs` is what survives a relaunch,
 * and `bridge.setPillPrefs` is what the pill on screen actually obeys. Neither
 * is redundant, because main cannot read Dexie and Dexie cannot move a window.
 */

/** The switch the group is built out of — the row this component used to BE. */
function PrefSwitch({ checked, label, hint, disabled = false, onToggle }: {
  checked: boolean;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className="flex w-full items-center justify-between rounded-field px-2 py-2 text-left text-ui hover:bg-hover disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span>
        <span className="block text-ink">{label}</span>
        {hint && <span className="block text-meta text-muted">{hint}</span>}
      </span>
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

function Choice({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 px-2 py-2 text-ui">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

export function OverlaySettings() {
  const bridge = useMemo(() => shellBridge(), []);
  const [prefs, setPrefs] = useState<PillPrefs>(DEFAULT_PILL_PREFS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void loadPillPrefs().then((value) => {
      if (cancelled) return;
      setPrefs(value);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  if (!bridge.available) return null;

  if (loading) {
    return (
      <div aria-hidden="true" data-testid="overlay-skeleton" className="h-[42px] rounded-field bg-fill" />
    );
  }

  // One writer for all nine settings, so no control can save without pushing
  // or push without saving.
  const change = (patch: Partial<PillPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    void savePillPrefs(next);
    bridge.setPillPrefs(next);
  };

  return (
    <div>
      <PrefSwitch
        checked={prefs.show}
        label="Show floating timer"
        hint="A small pill over other apps while a session runs."
        onToggle={() => change({ show: !prefs.show })}
      />

      <Choice label="Size">
        <SegmentedControl
          name="pill-size"
          label="Pill size"
          value={prefs.size}
          onChange={(size) => change({ size })}
          options={[
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
            { value: 'large', label: 'Large' },
          ]}
        />
      </Choice>

      <Choice label="Theme">
        <SegmentedControl
          name="pill-theme"
          label="Pill theme"
          value={prefs.theme}
          onChange={(theme) => change({ theme })}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Choice>

      {/* The one content choice, and it only means something on a pomodoro:
          a calm session has no countdown to choose against. */}
      <Choice label="While a pomodoro runs">
        <SegmentedControl
          name="pill-content"
          label="While a pomodoro runs"
          value={prefs.content}
          onChange={(content) => change({ content })}
          options={[
            { value: 'countdown', label: 'Time left' },
            { value: 'elapsed', label: 'Time worked' },
          ]}
        />
      </Choice>

      <Choice label="Corner">
        <SegmentedControl
          name="pill-corner"
          label="Pill corner"
          value={prefs.corner}
          onChange={(corner) => change({ corner })}
          options={[
            { value: 'top-left', label: 'Top left' },
            { value: 'top-right', label: 'Top right' },
            { value: 'bottom-left', label: 'Bottom left' },
            { value: 'bottom-right', label: 'Bottom right' },
          ]}
        />
      </Choice>

      <label className="flex items-center justify-between gap-3 px-2 py-2 text-ui">
        <span className={labelCls}>Opacity</span>
        <span className="flex items-center gap-2">
          <input
            type="range"
            min="50"
            max="100"
            aria-label="Opacity"
            value={String(Math.round(prefs.opacity * 100))}
            onChange={(event) => change({ opacity: Number(event.target.value) / 100 })}
            className="w-[140px]"
          />
          <span className="w-[36px] shrink-0 text-right text-meta tabular-nums text-muted">
            {Math.round(prefs.opacity * 100)}%
          </span>
        </span>
      </label>

      {/* The not-both-off rule, enforced in the UI as well as in the parser:
          the parser forces the title back on, and a switch that could be
          pressed into a state the row silently undoes is worse than one that
          cannot be pressed at all. The LAST one on is the disabled one. */}
      <PrefSwitch
        checked={prefs.showTitle}
        label="Show the task title"
        disabled={prefs.showTitle && !prefs.showGlyph}
        onToggle={() => change({ showTitle: !prefs.showTitle })}
      />
      <PrefSwitch
        checked={prefs.showGlyph}
        label="Show the play glyph"
        disabled={prefs.showGlyph && !prefs.showTitle}
        onToggle={() => change({ showGlyph: !prefs.showGlyph })}
      />
      <PrefSwitch
        checked={prefs.clickThrough}
        label="Click through the pill"
        hint="The pill ignores the mouse — clicking through to Today is off while this is on."
        onToggle={() => change({ clickThrough: !prefs.clickThrough })}
      />
    </div>
  );
}
