import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { compareVersions, shouldCheck, createUpdateCheck } =
  nativeRequire('./updateCheck.cjs') as typeof import('./updateCheck.cjs');

const DAY = 24 * 60 * 60 * 1000;

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.1.0', '0.1.1')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
  it('tolerates a leading v and refuses garbage', () => {
    expect(compareVersions('v0.2.0', '0.1.0')).toBe(1);
    expect(compareVersions('not-a-version', '0.1.0')).toBe(0);
    expect(compareVersions('0.1.0', '')).toBe(0);
  });
});

describe('shouldCheck', () => {
  it('checks when no stamp exists', () => {
    expect(shouldCheck(null, 1000)).toBe(true);
  });
  it('holds inside 24 hours', () => {
    expect(shouldCheck(1000, 1000 + DAY - 1)).toBe(false);
  });
  it('checks again at 24 hours', () => {
    expect(shouldCheck(1000, 1000 + DAY)).toBe(true);
  });
  it('checks when the clock went backwards', () => {
    expect(shouldCheck(5000, 1000)).toBe(true);
  });
});

interface FakeDeps {
  stored: import('./updateCheck.cjs').UpdateCheckState | null;
  deps: import('./updateCheck.cjs').UpdateCheckDeps;
  fetchLatest: ReturnType<typeof vi.fn>;
  logError: ReturnType<typeof vi.fn>;
}

function fakeDeps(overrides: Partial<import('./updateCheck.cjs').UpdateCheckDeps> = {}): FakeDeps {
  const box: FakeDeps = {
    stored: null,
    fetchLatest: vi.fn(async () => ({
      tag_name: 'v0.2.0',
      html_url: 'https://github.com/por25528/phase/releases/tag/v0.2.0',
    })),
    logError: vi.fn(),
    deps: undefined as unknown as import('./updateCheck.cjs').UpdateCheckDeps,
  };
  box.deps = {
    currentVersion: '0.1.0',
    fetchLatest: box.fetchLatest,
    readState: () => box.stored,
    writeState: (s) => { box.stored = s; },
    now: () => 1_000_000,
    logError: box.logError,
    ...overrides,
  };
  return box;
}

describe('createUpdateCheck', () => {
  it('reports a newer release and stamps the check', async () => {
    const box = fakeDeps();
    const result = await createUpdateCheck(box.deps).check();
    expect(result).toEqual({
      version: '0.2.0',
      url: 'https://github.com/por25528/phase/releases/tag/v0.2.0',
    });
    expect(box.stored).toEqual({
      checkedAt: 1_000_000,
      version: '0.2.0',
      url: 'https://github.com/por25528/phase/releases/tag/v0.2.0',
    });
  });

  it('reports null when up to date, and still stamps', async () => {
    const box = fakeDeps();
    box.fetchLatest.mockResolvedValue({ tag_name: 'v0.1.0', html_url: 'https://x.test/r' });
    expect(await createUpdateCheck(box.deps).check()).toBeNull();
    expect(box.stored?.checkedAt).toBe(1_000_000);
  });

  it('answers from the stamp inside 24h without fetching', async () => {
    const box = fakeDeps();
    box.stored = { checkedAt: 999_000, version: '0.3.0', url: 'https://x.test/r3' };
    const result = await createUpdateCheck(box.deps).check();
    expect(result).toEqual({ version: '0.3.0', url: 'https://x.test/r3' });
    expect(box.fetchLatest).not.toHaveBeenCalled();
  });

  it('swallows a fetch failure, logs it, keeps the cached answer', async () => {
    // The stamp is a day stale, so the throttle lets the (failing) fetch run.
    const box = fakeDeps({ now: () => 1_000_000 + DAY });
    box.stored = { checkedAt: 1_000_000, version: '0.3.0', url: 'https://x.test/r3' };
    box.fetchLatest.mockRejectedValue(new Error('offline'));
    const result = await createUpdateCheck(box.deps).check();
    expect(result).toEqual({ version: '0.3.0', url: 'https://x.test/r3' });
    expect(box.logError).toHaveBeenCalled();
  });

  it('reports null on a malformed release body', async () => {
    const box = fakeDeps();
    box.fetchLatest.mockResolvedValue({ message: 'API rate limit exceeded' });
    expect(await createUpdateCheck(box.deps).check()).toBeNull();
  });

  it('survives a corrupt stamp file', async () => {
    const box = fakeDeps({ readState: () => { throw new Error('bad json'); } });
    const result = await createUpdateCheck(box.deps).check();
    expect(result).toEqual({
      version: '0.2.0',
      url: 'https://github.com/por25528/phase/releases/tag/v0.2.0',
    });
    expect(box.logError).toHaveBeenCalled();
  });
});

// The preload cannot require this module (sandboxed), so the channel name is
// written out by hand there. This pin stops the two from drifting — same
// pattern as calendarIpc.test.ts.
describe('preload contract', () => {
  it('preload.cjs invokes the channel main registers', () => {
    const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');
    expect(preload).toContain("ipcRenderer.invoke('phase-updates:check')");
  });
});
