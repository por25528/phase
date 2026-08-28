/**
 * The renderer-side wrapper around the preload bridge for the release update
 * check — the sibling of shellBridge.ts with the same rules. In the plain
 * browser the preload does not exist, so the factory returns an inert stub:
 * check() answers null forever and `available` says which world this is. One
 * fixed verb; nothing here accepts a channel name.
 */

export interface UpdateInfo {
  /** Bare semver of the newer release, no leading v. */
  version: string;
  /** The GitHub release page to send the user to. */
  url: string;
}

export interface PhaseUpdateBridge {
  /** False in the plain browser: check() answers null and nothing ever fires. */
  available: boolean;
  /** The newer release, or null when up to date, unknown, or errored. */
  check(): Promise<UpdateInfo | null>;
}

interface UpdatePreload {
  check(): Promise<UpdateInfo | null>;
}

function preloadOf<T>(name: string): T | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as Record<string, T | undefined>)[name];
}

export function updateBridge(): PhaseUpdateBridge {
  const preload = preloadOf<UpdatePreload>('phaseUpdates');
  if (!preload) {
    return { available: false, check: async () => null };
  }
  return { available: true, check: () => preload.check() };
}
