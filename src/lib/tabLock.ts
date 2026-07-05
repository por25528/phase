// Phase assumes a single writer: every save rewrites every table from this
// tab's in-memory state, so two tabs silently clobber each other. The first
// tab holds a session-long exclusive Web Lock; later tabs fail the
// ifAvailable request and get a warning banner instead of live sync.

export function acquireTabLock(
  locks: LockManager | undefined = typeof navigator !== 'undefined' ? navigator.locks : undefined,
): Promise<boolean> {
  if (!locks) return Promise.resolve(true); // no Web Locks (very old browser / node) — don't block usage
  return new Promise((resolve) => {
    void locks.request('phase-tab', { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      // Returning a never-resolving promise keeps the lock for the tab's lifetime.
      return lock ? new Promise<void>(() => {}) : undefined;
    });
  });
}
