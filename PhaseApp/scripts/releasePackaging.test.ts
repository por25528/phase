// Guards the parts of the release path that are files rather than functions:
// the entitlements the hardened runtime is signed with, and the workflow that
// drives signing, notarization, verification and cleanup.
//
// These are the failures that only show up in a user's Console or on a
// Gatekeeper prompt weeks after the tag, so they are worth pinning here.

import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { NOTARY_SECRETS, SIGNING_SECRETS } =
  nativeRequire('./releaseConfig.cjs') as typeof import('./releaseConfig.cjs');

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.dirname(scriptsDir);
const repoRoot = path.dirname(appDir);

const read = (relativeToApp: string) => readFileSync(path.join(appDir, relativeToApp), 'utf8');
const workflow = readFileSync(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8');

/** Every hardened-runtime exception an Electron app needs to launch at all. */
const REQUIRED_ENTITLEMENTS = [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.allow-dyld-environment-variables',
  'com.apple.security.cs.disable-library-validation',
];

describe.each([
  ['build/entitlements.mac.plist', 'the app'],
  ['build/entitlements.mac.inherit.plist', 'the helper processes'],
])('%s', (file, _subject) => {
  const plist = () => read(file);

  it('is a well-formed plist dictionary', () => {
    expect(plist()).toContain('<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"');
    expect(plist()).toContain('<plist version="1.0">');
    expect(plist().trimEnd().endsWith('</plist>')).toBe(true);
  });

  it('grants every hardened-runtime exception Electron needs', () => {
    for (const key of REQUIRED_ENTITLEMENTS) {
      expect(plist()).toContain(`<key>${key}</key>`);
    }
  });

  it('claims no App Sandbox, which Developer ID distribution does not use', () => {
    expect(plist()).not.toContain('<key>com.apple.security.app-sandbox</key>');
  });
});

describe('release workflow', () => {
  const indexOf = (needle: string) => {
    const at = workflow.indexOf(needle);
    expect(at, `expected the workflow to contain ${JSON.stringify(needle)}`).toBeGreaterThan(-1);
    return at;
  };

  it('turns release signing on for the packaging step', () => {
    expect(workflow).toContain("PHASE_RELEASE_SIGNING: '1'");
  });

  it('pins the Apple-account seam explicitly rather than leaving it implicit', () => {
    expect(workflow).toMatch(/PHASE_NOTARY_METHOD:\s*(api-key|apple-id)/);
  });

  it('wires every secret both notarization methods can need', () => {
    for (const name of [...SIGNING_SECRETS, ...NOTARY_SECRETS['api-key'], ...NOTARY_SECRETS['apple-id']]) {
      expect(workflow, `${name} is never exported`).toContain(`${name}:`);
    }
  });

  it('takes every credential from secrets, never from a literal', () => {
    for (const line of workflow.split('\n')) {
      const assignment = /^\s*(CSC_LINK|CSC_KEY_PASSWORD|APPLE_API_KEY_ID|APPLE_API_ISSUER|APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|APPLE_TEAM_ID):\s*(.+)$/.exec(line);
      if (!assignment) continue;
      expect(assignment[2], `${assignment[1]} is not read from secrets`).toContain('secrets.');
    }
  });

  it('never echoes, prints or cats a secret', () => {
    for (const line of workflow.split('\n')) {
      if (!/\bsecrets\./.test(line)) continue;
      expect(line, 'a secret reaches a printing command').not.toMatch(/\b(echo|printf|cat|tee)\b/);
    }
  });

  it('keeps the App Store Connect key outside the workspace, in the runner temp', () => {
    expect(workflow).toMatch(/runner\.temp|RUNNER_TEMP/);
  });

  it('deletes the materialised key even when the build fails', () => {
    const cleanup = /- name: [^\n]*\n(?:[^\n]*\n)*?\s*if: always\(\)/.test(workflow);
    expect(cleanup, 'no `if: always()` cleanup step').toBe(true);
    expect(workflow).toMatch(/rm -f/);
  });

  it('fails on missing credentials before it spends an install, a suite or a build', () => {
    const preflight = indexOf('check-release-credentials.cjs');
    expect(preflight).toBeLessThan(indexOf('run: npm ci'));
    expect(preflight).toBeLessThan(indexOf('npx electron-builder'));
  });

  it('verifies the artifacts before it publishes them', () => {
    expect(indexOf('verify-macos-artifacts.sh')).toBeLessThan(indexOf('action-gh-release'));
  });

  it('no longer accepts an ad-hoc signature as a releasable one', () => {
    expect(workflow).not.toContain('Signature=adhoc');
  });
});

describe('release scripts', () => {
  it.each([
    'scripts/check-release-credentials.cjs',
    'scripts/verify-macos-artifacts.sh',
    'scripts/notarize-dmg.sh',
  ])('%s is present and executable', (file) => {
    const mode = statSync(path.join(appDir, file)).mode;
    expect(mode & 0o111, `${file} is not executable`).toBeGreaterThan(0);
  });

  it('the shell scripts abort on the first error rather than limping on', () => {
    for (const file of ['scripts/verify-macos-artifacts.sh', 'scripts/notarize-dmg.sh']) {
      expect(read(file), file).toContain('set -euo pipefail');
    }
  });

  it('the notarize script never turns on shell tracing, which would print the credentials', () => {
    expect(read('scripts/notarize-dmg.sh')).not.toMatch(/^\s*set -[a-z]*x/m);
  });
});

describe('packaging config', () => {
  it('lives in electron-builder.cjs, not a static package.json block', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.build, 'a static `build` block would shadow the env-driven config').toBeUndefined();
    expect(read('electron-builder.cjs')).toContain('releaseConfig.cjs');
  });

  it('keeps `npm run build:mac` as the ad-hoc developer path', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['build:mac']).not.toContain('PHASE_RELEASE_SIGNING');
  });
});

/**
 * The shell scripts' refusal paths, run for real. None of these need a build
 * artifact, so they run in CI before anything is packaged.
 *
 * `/bin/bash` deliberately, not `bash`: a macOS runner's /bin/bash is 3.2, and
 * 3.2 is where `"${empty[@]}"` under `set -u` is an unbound-variable error —
 * the reason the verifier iterates positional parameters instead of an array.
 */
function runScript(file: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync('/bin/bash', [path.join(appDir, file), ...args], {
    cwd: appDir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('verify-macos-artifacts.sh', () => {
  const script = 'scripts/verify-macos-artifacts.sh';

  it('parses under bash 3.2', () => {
    expect(spawnSync('/bin/bash', ['-n', path.join(appDir, script)]).status).toBe(0);
  });
  it('prints usage and exits 2 with no arguments', () => {
    const r = runScript(script, []);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage:');
  });
  it('refuses an unknown mode before it touches codesign', () => {
    const r = runScript(script, ['bogus', appDir]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('mode must be release or dev');
  });
  it('exits 1 when the app bundle is not there', () => {
    const r = runScript(script, ['release', '/nope.app']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no such app bundle');
  });
  it('reads the disk images as positional parameters, never an array', () => {
    // `for dmg in "${dmgs[@]}"` is the bash 3.2 unbound-variable trap: the
    // workflow verifies the x64 app with no images at all.
    expect(read(script)).toContain('for dmg in "$@"');
  });
});

describe('notarize-dmg.sh', () => {
  const script = 'scripts/notarize-dmg.sh';

  it('parses under bash 3.2', () => {
    expect(spawnSync('/bin/bash', ['-n', path.join(appDir, script)]).status).toBe(0);
  });
  it('prints usage and exits 2 with no disk image', () => {
    const r = runScript(script, []);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage:');
  });
  it('refuses a notarization method it does not implement', () => {
    const r = runScript(script, ['anything.dmg'], { PHASE_NOTARY_METHOD: 'keychain' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('api-key or apple-id');
  });
  it('names the missing credential rather than calling notarytool without one', () => {
    const r = runScript(script, ['anything.dmg'], {
      PHASE_NOTARY_METHOD: 'api-key',
      APPLE_API_KEY: '',
      APPLE_API_KEY_ID: '',
      APPLE_API_ISSUER: '',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('APPLE_API_KEY');
  });
});

describe('check-release-credentials.cjs', () => {
  const run = (env: NodeJS.ProcessEnv) =>
    spawnSync(process.execPath, [path.join(appDir, 'scripts/check-release-credentials.cjs')], {
      cwd: appDir,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });

  /** A release env with one hole in it, so the failure message can be read. */
  const holed = {
    PHASE_RELEASE_SIGNING: '1',
    PHASE_NOTARY_METHOD: 'api-key',
    CSC_LINK: 'base64-of-a-p12',
    CSC_KEY_PASSWORD: 'p12-passphrase',
    APPLE_API_KEY: '/tmp/AuthKey.p8',
    APPLE_API_KEY_ID: '',
    APPLE_API_ISSUER: 'an-issuer-uuid',
    APPLE_ID: '',
    APPLE_APP_SPECIFIC_PASSWORD: '',
    APPLE_TEAM_ID: '',
  };

  it('passes without credentials when release signing is off', () => {
    const r = run({ PHASE_RELEASE_SIGNING: '' });
    expect(r.status).toBe(0);
  });
  it('fails naming the missing secret', () => {
    const r = run(holed);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('APPLE_API_KEY_ID');
  });
  it('leaks no secret value on either stream, even the ones it found', () => {
    const r = run(holed);
    const output = r.stdout + r.stderr;
    for (const value of ['base64-of-a-p12', 'p12-passphrase', 'an-issuer-uuid']) {
      expect(output, `the value of a secret reached the log`).not.toContain(value);
    }
  });
});
