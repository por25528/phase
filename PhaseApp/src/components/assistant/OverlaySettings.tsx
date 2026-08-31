import { useEffect, useMemo, useState } from 'react';
import { shellBridge } from '../../lib/shellBridge';
import { loadShowOverlay, saveShowOverlay } from '../../db/db';

/**
 * The "Show floating timer" row in Settings.
 *
 * Desktop-only, exactly as LaunchAtLoginSettings is: the browser has no
 * always-on-top window, so in the web build the row simply is not there.
 * Unlike the login item, the value is OURS (Dexie), so the switch flips
 * immediately and the write is fire-and-forget — there is no OS to refuse.
 */
export function OverlaySettings() {
  const bridge = useMemo(() => shellBridge(), []);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void loadShowOverlay().then((value) => {
      if (cancelled) return;
      setEnabled(value);
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

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    void saveShowOverlay(next);
    bridge.setOverlayEnabled(next);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Show floating timer"
      onClick={toggle}
      className="flex w-full items-center justify-between rounded-field px-2 py-2 text-left text-ui hover:bg-hover"
    >
      <span>
        <span className="block text-ink">Show floating timer</span>
        <span className="block text-meta text-muted">A small pill over other apps while a session runs.</span>
      </span>
      <span
        aria-hidden="true"
        className={
          'h-[18px] w-[32px] rounded-field border p-[2px] '
          + (enabled ? 'border-ink bg-ink' : 'border-check bg-panel')
        }
      >
        <span
          className={
            'block h-[12px] w-[12px] rounded-field bg-panel transition-transform duration-150 '
            + (enabled ? 'translate-x-[12px]' : 'translate-x-0')
          }
        />
      </span>
    </button>
  );
}
