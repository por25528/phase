// Deliberately imports nothing from `electron`: main.cjs stays the only
// composition root. The checker sees the network, the clock, and the stamp
// file only through injected shapes.

/** A newer release the renderer should mention. */
export interface UpdateInfo {
  /** Bare semver, no leading v. */
  version: string;
  /** The GitHub release page to send the user to. */
  url: string;
}

/** What the stamp file remembers between launches. */
export interface UpdateCheckState {
  checkedAt: number;
  version: string | null;
  url: string | null;
}

export interface UpdateCheckDeps {
  currentVersion: string;
  /** GET releases/latest; may reject or resolve any JSON shape. */
  fetchLatest(): Promise<unknown>;
  /** Last stamp, or null when none. May throw on a corrupt file. */
  readState(): UpdateCheckState | null;
  writeState(state: UpdateCheckState): void;
  now(): number;
  logError(...args: unknown[]): void;
}

export interface UpdateCheck {
  /** Resolves the newer release, or null. Never rejects. */
  check(): Promise<UpdateInfo | null>;
}

export declare function compareVersions(a: string, b: string): number;
export declare function shouldCheck(checkedAt: number | null, now: number): boolean;
export declare function createUpdateCheck(deps: UpdateCheckDeps): UpdateCheck;
