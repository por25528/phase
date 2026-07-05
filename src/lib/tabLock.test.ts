import { describe, it, expect } from 'vitest';
import { acquireTabLock } from './tabLock';

function stubLocks(granted: boolean): LockManager {
  const request = ((_name: string, _opts: unknown, cb: (lock: Lock | null) => unknown) => {
    void cb(granted ? ({ name: 'phase-tab', mode: 'exclusive' } as Lock) : null);
    return new Promise<void>(() => {}); // like the real API: pending while the lock is held
  }) as LockManager['request'];
  return { request, query: async () => ({ held: [], pending: [] }) } as LockManager;
}

describe('acquireTabLock', () => {
  it('resolves true when the lock is granted (first tab)', async () => {
    await expect(acquireTabLock(stubLocks(true))).resolves.toBe(true);
  });
  it('resolves false when another tab already holds it', async () => {
    await expect(acquireTabLock(stubLocks(false))).resolves.toBe(false);
  });
  it('resolves true when Web Locks is unavailable', async () => {
    await expect(acquireTabLock(undefined)).resolves.toBe(true);
  });
});
