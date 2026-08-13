import { useEffect, useMemo, useRef, useState } from 'react';
import { shellBridge } from '../../lib/shellBridge';

/**
 * The "Launch Phase at login" row in Settings.
 *
 * It renders only on desktop: the browser has no OS login item, so in the plain
 * web build it returns null and the row simply is not there. On desktop the
 * row owns its whole read/write lifecycle — enabled, loading, saving, error —
 * and never guesses. The read shows a quiet skeleton line while it is pending,
 * the switch keeps the OLD value until the shell reports the applied one, and a
 * refusal preserves the old value with a one-line warning rather than silently
 * pretending the toggle took.
 *
 * The skeleton is presentational: the live `status` role belongs to the Good
 * luck send-off and the app's notices, and a placeholder announces nothing.
 */
export function LaunchAtLoginSettings() {
  const bridge = useMemo(() => shellBridge(), []);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  // One guard shared by the async read and the async write: a promise that
  // settles after the row unmounts must not setState on a dead component.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!bridge.available) return;
    void bridge.getLaunchAtLogin().then((value) => {
      if (!mountedRef.current) return;
      // A null read means the shell refused to report; the default (off) is the
      // only honest thing left, and the row must never stay stuck on its skeleton.
      if (value !== null) setEnabled(value);
      setLoading(false);
    });
    return () => {
      mountedRef.current = false;
    };
  }, [bridge]);

  if (!bridge.available) return null;

  if (loading) {
    // One quiet bar where the row will land — a skeleton, never a spinner or a
    // blank flash, and never taller than the control it is replacing.
    return (
      <div aria-hidden="true" data-testid="launch-skeleton" className="h-[42px] rounded-field bg-fill" />
    );
  }

  const toggle = () => {
    setSaving(true);
    setError(false);
    void bridge.setLaunchAtLogin(!enabled).then((value) => {
      if (!mountedRef.current) return;
      if (value === null) {
        // The OS refused: keep the old value and say so, in words.
        setError(true);
      } else {
        setEnabled(value);
      }
      setSaving(false);
    });
  };

  return (
    <div className="flex flex-col gap-[4px]">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Launch Phase at login"
        disabled={saving}
        onClick={toggle}
        className="flex w-full items-center justify-between rounded-field px-2 py-2 text-left text-ui hover:bg-hover disabled:opacity-50"
      >
        <span>
          <span className="block text-ink">Launch Phase at login</span>
          <span className="block text-meta text-muted">Keep the assistant ready after you sign in.</span>
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
      {error && (
        <p role="alert" className="text-meta text-warn">
          Phase couldn't change this setting.
        </p>
      )}
    </div>
  );
}
