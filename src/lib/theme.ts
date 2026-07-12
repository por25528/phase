// Theme resolution + application. The pure core (`resolveTheme`) is unit-tested;
// the read/write/apply helpers are thin side effects over localStorage + the DOM
// and keep all browser-API access *inside* functions so this module imports
// cleanly under the node test environment.

export type Theme = 'system' | 'light' | 'dark';

/** localStorage key for the per-device theme preference. */
export const THEME_KEY = 'phase-theme';

// Browser/OS chrome color per effective theme — mirrors the `bg` token so the
// title bar / status bar matches the app surface. Kept in sync with the inline
// no-FOUC script in index.html.
const THEME_COLOR: Record<'light' | 'dark', string> = {
  light: '#FAF9F7',
  dark: '#000000',
};

/**
 * Pure: map a stored preference + the OS's dark preference to the theme that
 * should actually render. Forced light/dark ignore the system; `system` follows.
 */
export function resolveTheme(pref: Theme, systemPrefersDark: boolean): 'light' | 'dark' {
  if (pref === 'light' || pref === 'dark') return pref;
  return systemPrefersDark ? 'dark' : 'light';
}

/**
 * Read the stored preference, defaulting to `system` when absent or invalid.
 * try/catch (not a typeof guard) because storage can be present-but-unusable:
 * private mode throws SecurityError, and some non-DOM runtimes expose a partial
 * `localStorage` whose methods aren't callable.
 */
export function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Persist the preference; a no-op when storage is unavailable. */
export function writeStoredTheme(pref: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* storage unavailable — theme just won't persist */
  }
}

/** Does the OS currently prefer dark? False in non-DOM contexts. */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Apply the effective theme to the document: toggle the `.dark` class (which
 * flips the CSS-variable palette), set `color-scheme` so native form controls /
 * scrollbars match, and update the `theme-color` meta for browser/OS chrome.
 */
export function applyTheme(effective: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', effective === 'dark');
  root.style.colorScheme = effective;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[effective]);
}
