// The OS-registration half of the assistant shortcut, dependency-injected so
// the ordering rules below are unit-testable without Electron.
//
// The one rule that matters: REGISTER THE NEW CHORD FIRST, unregister the old
// one only after success. The other order has a failure mode where the new
// chord conflicts and the old one is already gone — no shortcut at all, from
// an edit that should have been refusable. A conflict is reported as a state
// (`registered: false, conflict: true`) with the still-active chord named
// explicitly; it never throws and it never silently substitutes a fallback.

// Structural validation only — the renderer already validated vocabulary, but
// the main process trusts nothing that crossed IPC.
const ACCELERATOR_RE = /^[A-Za-z0-9+,./;'[\]\\`=-]{3,64}$/;

function usable(requested) {
  return typeof requested === 'string'
    && ACCELERATOR_RE.test(requested)
    && requested.includes('+')
    && !requested.endsWith('+');
}

function createAssistantShortcut(deps) {
  const { register, unregister, onOpen } = deps;
  let active = null;

  return {
    /**
     * Try to make `requested` the live chord. Returns the full status —
     * requested, active, registered, conflict — and leaves the previous chord
     * registered whenever the new one cannot be.
     */
    setAccelerator(requested) {
      if (!usable(requested)) {
        return { requested: typeof requested === 'string' ? requested : null, active, registered: false, conflict: false };
      }
      if (requested === active) {
        return { requested, active, registered: true, conflict: false };
      }
      let ok = false;
      try {
        ok = register(requested, onOpen) !== false;
      } catch {
        ok = false;
      }
      if (!ok) {
        return { requested, active, registered: false, conflict: true };
      }
      if (active !== null) {
        try {
          unregister(active);
        } catch {
          // The old chord failing to unregister must not undo the new one.
        }
      }
      active = requested;
      return { requested, active, registered: true, conflict: false };
    },

    dispose() {
      if (active === null) return;
      try {
        unregister(active);
      } catch {
        // Nothing to recover: the process is on its way out.
      }
      active = null;
    },

    active() {
      return active;
    },
  };
}

module.exports = { createAssistantShortcut };
