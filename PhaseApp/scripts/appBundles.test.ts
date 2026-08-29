import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { findAppBundles, findDiskImages } =
  nativeRequire('./appBundles.cjs') as typeof import('./appBundles.cjs');

const made: string[] = [];
function releaseDir(layout: Record<string, 'dir' | 'file'>) {
  const root = mkdtempSync(path.join(tmpdir(), 'phase-release-'));
  made.push(root);
  for (const [relative, kind] of Object.entries(layout)) {
    const full = path.join(root, relative);
    if (kind === 'dir') {
      mkdirSync(full, { recursive: true });
    } else {
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, '');
    }
  }
  return root;
}

afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

describe('findAppBundles', () => {
  it('finds the bundle on an Intel-only build', () => {
    const root = releaseDir({ 'mac/Phase.app': 'dir' });
    expect(findAppBundles(root)).toEqual([path.join(root, 'mac/Phase.app')]);
  });

  it('finds the bundle on an Apple Silicon-only build', () => {
    const root = releaseDir({ 'mac-arm64/Phase.app': 'dir' });
    expect(findAppBundles(root)).toEqual([path.join(root, 'mac-arm64/Phase.app')]);
  });

  it('finds both when electron-builder packaged both architectures', () => {
    const root = releaseDir({ 'mac/Phase.app': 'dir', 'mac-arm64/Phase.app': 'dir' });
    expect(findAppBundles(root)).toEqual([
      path.join(root, 'mac-arm64/Phase.app'),
      path.join(root, 'mac/Phase.app'),
    ]);
  });

  it('ignores the disk images and the build metadata beside them', () => {
    const root = releaseDir({
      'mac-arm64/Phase.app': 'dir',
      'Phase-0.1.0-arm64.dmg': 'file',
      'Phase-0.1.0-arm64.dmg.blockmap': 'file',
      'builder-debug.yml': 'file',
    });
    expect(findAppBundles(root)).toEqual([path.join(root, 'mac-arm64/Phase.app')]);
  });

  it('never descends into a bundle, so the Electron helpers are not mistaken for apps', () => {
    const root = releaseDir({
      'mac-arm64/Phase.app/Contents/Frameworks/Phase Helper (Renderer).app': 'dir',
      'mac-arm64/Phase.app/Contents/Frameworks/Phase Helper (GPU).app': 'dir',
    });
    expect(findAppBundles(root)).toEqual([path.join(root, 'mac-arm64/Phase.app')]);
  });

  it('names the directory it searched when a build produced nothing', () => {
    const root = releaseDir({ 'mac-arm64': 'dir' });
    expect(() => findAppBundles(root)).toThrow(new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    expect(() => findAppBundles(root)).toThrow(/npm run build:mac/);
  });

  it('says the build never ran rather than throwing an fs error', () => {
    const root = path.join(tmpdir(), 'phase-release-that-does-not-exist');
    expect(() => findAppBundles(root)).toThrow(/npm run build:mac/);
  });
});

describe('findDiskImages', () => {
  it('finds the images beside the bundles, sorted', () => {
    const root = releaseDir({
      'mac/Phase.app': 'dir',
      'Phase-0.1.0.dmg': 'file',
      'Phase-0.1.0-arm64.dmg': 'file',
    });
    expect(findDiskImages(root)).toEqual([
      path.join(root, 'Phase-0.1.0-arm64.dmg'),
      path.join(root, 'Phase-0.1.0.dmg'),
    ]);
  });

  it('ignores the block maps, which share the .dmg prefix', () => {
    const root = releaseDir({
      'Phase-0.1.0-arm64.dmg': 'file',
      'Phase-0.1.0-arm64.dmg.blockmap': 'file',
    });
    expect(findDiskImages(root)).toEqual([path.join(root, 'Phase-0.1.0-arm64.dmg')]);
  });

  it('looks only beside the bundles, never inside them', () => {
    const root = releaseDir({ 'mac-arm64/somehow-nested.dmg': 'file' });
    expect(() => findDiskImages(root)).toThrow(/npm run build:mac/);
  });

  it('names the directory it searched when a build produced none', () => {
    const root = releaseDir({ 'mac-arm64/Phase.app': 'dir' });
    expect(() => findDiskImages(root)).toThrow(new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});
