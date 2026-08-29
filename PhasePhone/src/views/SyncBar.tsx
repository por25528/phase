import type { PhoneStore } from '../state/phoneStore';

/**
 * The state of the sync, on every screen, in one line — or nothing.
 *
 * It lives in the shell rather than on Today because the facts it carries are
 * not Today's. A capture made on the Capture screen is the one most likely to
 * be sitting unsent, and a write that failed is worth knowing about wherever
 * you were standing when it failed; a strip that only Today could draw would
 * report both to the wrong screen or to no screen.
 *
 * A HEALTHY sync draws nothing. That is the same rule `asOfLabel` holds and
 * for the same reason: a permanent green "synced" cell would be present on
 * every screen of every session and would therefore be read by nobody, which
 * is exactly the state in which the one session it mattered goes unnoticed.
 *
 * The division of labour with Today's header: the header says WHEN the
 * canonical file was written, this says WHAT is still outstanding. Those are
 * different questions and only one of them belongs to a particular day.
 */
export function SyncBar({ store }: { store: PhoneStore }) {
  const state = store.usePhoneStore();

  // Order is severity, and it is not a display preference: a failed write is
  // work that is GONE, a failed read is work that may have moved, and a
  // pending count is work in flight and fine. Reporting the mildest of the
  // three while a worse one held would be the one arrangement that misleads.
  const line = (() => {
    if (state.error?.kind === 'write') {
      return {
        tone: 'warn' as const,
        text: 'That change didn’t save. Try it again.',
        detail: state.error.message,
        retry: false,
      };
    }
    if (state.error?.kind === 'read') {
      return {
        tone: 'warn' as const,
        // Stale, not wrong — the distinction the whole projection rests on.
        text: 'Can’t reach iCloud. This is the last file your Mac wrote.',
        detail: state.error.message,
        retry: true,
      };
    }
    if (state.status === 'loading') {
      return { tone: 'quiet' as const, text: 'Looking for your Mac’s file…', detail: null, retry: false };
    }
    if (state.pendingCount > 0) {
      return {
        tone: 'quiet' as const,
        text: `${state.pendingCount} change${state.pendingCount === 1 ? '' : 's'} waiting for your Mac`,
        detail: null,
        retry: false,
      };
    }
    return null;
  })();

  if (!line) return null;

  return (
    <div
      role="status"
      // Named, because Capture draws a `status` of its own and a test — or a
      // screen reader user moving by landmark — has to be able to tell the
      // confirmation of one capture from the state of the whole sync.
      aria-label="Sync"
      className={`flex-none flex items-start gap-[12px] px-[18px] py-[10px] border-t border-line ${
        line.tone === 'warn' ? 'bg-warn-tint' : 'bg-panel'
      }`}
    >
      <span className="flex-1 min-w-0">
        <span className={`block text-meta ${line.tone === 'warn' ? 'text-warn' : 'text-muted'}`}>
          {line.text}
        </span>
        {/* The bridge's own words. Unreadable prose to most people most of the
            time — and the only thing that identifies which of a dozen iCloud
            failures this is when somebody is standing in front of a device
            trying to find out. */}
        {line.detail && <span className="mt-[2px] block text-micro text-muted">{line.detail}</span>}
      </span>
      {line.retry && (
        <button
          type="button"
          className="flex-none -my-[6px] -mr-[6px] h-[36px] px-[10px] text-meta text-ink font-semibold active:opacity-60"
          onClick={() => void store.refresh()}
        >
          Try again
        </button>
      )}
    </div>
  );
}
