import { useEffect, useState } from 'react';
import type { PhaseUpdateBridge, UpdateInfo } from '../lib/updateBridge';
import { IconX } from './Icons';

// Dismissal is per-version: dismissing 0.2.0 must not silence 0.3.0. The key
// stores exactly one version string, so any DIFFERENT version shows again.
const DISMISSED_KEY = 'phase-update-dismissed';

/**
 * try/catch rather than a `typeof` guard, for the reason `theme.ts` spells out
 * on the same two calls: storage can be present-but-unusable. Private mode
 * throws SecurityError, and some runtimes expose a partial `localStorage` whose
 * methods aren't callable. A notice about an update is the last thing in the
 * app that should be able to take the window down, so both directions fail
 * soft: an unreadable store shows the banner, an unwritable one just forgets
 * the dismissal.
 */
function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    /* storage unavailable — the dismissal just won't survive a restart */
  }
}

/**
 * A quiet corner notice that a newer release exists. Pull-only: asks the
 * bridge once on mount (the main process throttles real network checks to one
 * a day). The link is a plain http anchor — main.cjs's window-open handler
 * routes those to the user's browser.
 *
 * Dressed as a floating overlay in the app's own vocabulary rather than in
 * Tailwind's defaults: `bg-panel border-line-2 rounded-card shadow-today` is
 * exactly what `Popover` paints at its `overlay` elevation, and the metrics
 * (`bottom-[20px]`, `px-[16px] py-[9px]`, `text-body`) are the undo toast's, a
 * few lines away in `App.tsx`. It sits bottom-RIGHT where the toast sits
 * bottom-centre, so the two never overlap, and `z-50` keeps it under the
 * toast's `z-[60]` on the one axis where they could.
 */
export function UpdateBanner({ bridge }: { bridge: PhaseUpdateBridge }) {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    if (!bridge.available) return;
    let cancelled = false;
    void bridge
      .check()
      .then((info) => {
        if (cancelled || !info) return;
        if (readDismissed() === info.version) return;
        setUpdate(info);
      })
      .catch(() => {
        // The main process already swallows and logs failures; a rejection
        // here would only mean the bridge itself broke. Stay silent.
      });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  if (!update) return null;
  return (
    <div
      role="status"
      className="fixed bottom-[20px] right-[20px] z-50 flex items-center gap-[12px] rounded-card border border-line-2 bg-panel px-[16px] py-[9px] text-body text-ink shadow-today"
    >
      <span>Phase {update.version} is available.</span>
      <a
        href={update.url}
        target="_blank"
        rel="noreferrer"
        className="font-semibold underline underline-offset-2 hover:text-ink-hover"
      >
        Download
      </a>
      <button
        type="button"
        aria-label="Dismiss update notice"
        className="flex-none text-muted w-[24px] h-[24px] inline-flex items-center justify-center rounded-[6px] hover:bg-hover hover:text-ink"
        onClick={() => {
          writeDismissed(update.version);
          setUpdate(null);
        }}
      >
        <IconX size={15} />
      </button>
    </div>
  );
}
