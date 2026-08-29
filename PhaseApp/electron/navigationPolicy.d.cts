// Main-process module: loaded by `main.cjs`, never by the renderer.

/** Where the app's own document lives in this run. Exactly one is in play. */
export interface NavigationTargets {
  /** Set only by `npm run app:dev`. Its ORIGIN is the whitelist. */
  devServerUrl?: string | null;
  /** Absolute path of the packaged `dist/index.html`. */
  appEntryFile?: string | null;
}

export interface NavigationPolicyDeps extends NavigationTargets {
  /** `shell.openExternal`. May reject; the policy swallows that. */
  openExternal(url: string): unknown;
}

/** `internal` loads in place, `external` goes to the browser, `block` goes nowhere. */
export type NavigationDecision = 'internal' | 'external' | 'block';

/** Blocks anything unparseable, non-string, or outside the two entries. */
export declare function navigationDecision(
  url: string,
  where: NavigationTargets,
): NavigationDecision;

/** Guards `will-navigate`, `will-frame-navigate` and `window.open` together. */
export declare function applyNavigationPolicy(
  contents: Electron.WebContents,
  deps: NavigationPolicyDeps,
): void;
