/** Where electron-builder writes packaged apps, relative to PhaseApp. */
export declare const DEFAULT_RELEASE_DIR: 'release';

/**
 * App bundles exactly one level under `releaseDir`, sorted.
 *
 * Never recursive: the Electron helper bundles live inside the app bundle, and
 * verifying those as products would be meaningless.
 *
 * Throws — naming the directory and the command that fills it — when the build
 * produced none, rather than returning an empty list a caller could ignore.
 */
export declare function findAppBundles(releaseDir?: string): string[];

/**
 * Disk images directly inside `releaseDir`, sorted. Matches `.dmg` exactly, so
 * the `.dmg.blockmap` electron-builder writes beside each one is never returned.
 *
 * Throws — naming the directory — when the build produced none.
 */
export declare function findDiskImages(releaseDir?: string): string[];
