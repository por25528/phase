// Guards the parts of the release path that are files rather than functions:
// the entitlements the hardened runtime is signed with, the workflow that
// drives signing, notarization, verification and cleanup, and the install copy
// a user actually reads.
//
// These are the failures that only show up in a user's Console or on a
// Gatekeeper prompt weeks after the tag, so they are worth pinning here.

import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const { NOTARY_SOURCE_SECRETS, NOTARY_BUILDER_VARS, SIGNING_SECRETS } =
  nativeRequire('./releaseConfig.cjs') as typeof import('./releaseConfig.cjs');

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.dirname(scriptsDir);
const repoRoot = path.dirname(appDir);

const read = (relativeToApp: string) => readFileSync(path.join(appDir, relativeToApp), 'utf8');
const readRepo = (relativeToRoot: string) => readFileSync(path.join(repoRoot, relativeToRoot), 'utf8');
const workflow = readRepo('.github/workflows/release.yml');

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
    const names = new Set([
      ...SIGNING_SECRETS,
      ...NOTARY_SOURCE_SECRETS['api-key'],
      ...NOTARY_SOURCE_SECRETS['apple-id'],
      ...NOTARY_BUILDER_VARS['api-key'],
      ...NOTARY_BUILDER_VARS['apple-id'],
    ]);
    for (const name of names) {
      expect(workflow, `${name} is never exported`).toContain(`${name}:`);
    }
  });

  it('takes every credential from secrets, never from a literal', () => {
    for (const line of workflow.split('\n')) {
      const assignment = /^\s*(CSC_LINK|CSC_KEY_PASSWORD|APPLE_API_KEY_P8_BASE64|APPLE_API_KEY_ID|APPLE_API_ISSUER|APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|APPLE_TEAM_ID):\s*(.+)$/.exec(line);
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
    expect(workflow).toMatch(/runner\.temp/);
    expect(workflow).toMatch(/\$RUNNER_TEMP/);
    // The workspace is what gets packed and uploaded; a key there could ship.
    expect(workflow).not.toMatch(/APPLE_API_KEY:.*PhaseApp\//);
  });

  it('reads `runner` only where GitHub actually provides it', () => {
    // Workflow-level `env` may use github, secrets, inputs and vars — and NOT
    // runner. `${{ runner.temp }}` there silently resolves to nothing, which
    // would have put the key at /apple-api-key.p8.
    const beforeJobs = workflow.slice(0, indexOf('\njobs:'));
    expect(beforeJobs, '`runner` is not available to a workflow-level env key')
      .not.toContain('runner.');
    for (const line of workflow.split('\n')) {
      if (!line.includes('runner.')) continue;
      // Step keys are indented far deeper than a job-level `env:` entry.
      expect(line.search(/\S/), `runner. used outside a step: ${line.trim()}`)
        .toBeGreaterThanOrEqual(10);
    }
  });

  it('deletes the materialised key even when the build fails', () => {
    const cleanup = /- name: [^\n]*\n(?:[^\n]*\n)*?\s*if: always\(\)/.test(workflow);
    expect(cleanup, 'no `if: always()` cleanup step').toBe(true);
    expect(workflow).toMatch(/rm -f "\$RUNNER_TEMP\/\$PHASE_API_KEY_NAME"/);
  });

  it('fails on missing credentials before it spends an install, a suite or a build', () => {
    const preflight = indexOf('check-release-credentials.cjs');
    expect(preflight).toBeLessThan(indexOf('run: npm ci'));
    expect(preflight).toBeLessThan(indexOf('npx electron-builder'));
  });

  it('verifies the artifacts before it publishes them', () => {
    expect(indexOf('verify-build.cjs release')).toBeLessThan(indexOf('action-gh-release'));
  });

  it('no longer accepts an ad-hoc signature as a releasable one', () => {
    expect(workflow).not.toContain('Signature=adhoc');
  });

  describe('the App Store Connect key has two names, and they are not swapped', () => {
    /** Text of one step, from its `- name:` to the next step at that indent. */
    const step = (name: string) => {
      const start = workflow.indexOf(`- name: ${name}`);
      expect(start, `no step named ${name}`).toBeGreaterThan(-1);
      const rest = workflow.slice(start + 1);
      const end = rest.indexOf('\n      - ');
      return rest.slice(0, end === -1 ? undefined : end);
    };

    it('gives the preflight the base64 secret and no path', () => {
      const preflight = step('Preflight — release credentials');
      expect(preflight).toContain('APPLE_API_KEY_P8_BASE64:');
      expect(preflight).not.toMatch(/^\s*APPLE_API_KEY:/m);
    });

    it('gives electron-builder the path and never the base64', () => {
      const build = step('Build, sign and notarize');
      expect(build).toMatch(/^\s*APPLE_API_KEY: .*runner\.temp/m);
      expect(build).not.toContain('APPLE_API_KEY_P8_BASE64');
    });

    it('gives notarytool the path and never the base64', () => {
      const notarize = step('Notarize and staple the disk images');
      expect(notarize).toMatch(/^\s*APPLE_API_KEY: .*runner\.temp/m);
      expect(notarize).not.toContain('APPLE_API_KEY_P8_BASE64');
    });

    it('decodes the secret through the validating writer, not a shell pipeline', () => {
      const materialise = step('Materialise the App Store Connect key');
      expect(materialise).toContain('write-apple-api-key.cjs');
      expect(materialise, 'base64 --decode accepts a corrupted secret silently')
        .not.toContain('base64 --decode');
    });
  });
});

/**
 * The end-user install path must never tell anyone to override Gatekeeper. The
 * published DMG is notarized and opens by double-clicking; copy that says
 * otherwise is either wrong or describes a build that should not be published.
 *
 * The developer build IS the exception, and it is documented — in the developer
 * docs, which is why the ban is scoped rather than repo-wide.
 */
const BYPASS_COPY = [
  'Open Anyway',
  'Privacy & Security',
  'Privacy and Security',
  'com.apple.quarantine',
  'xattr',
  'right-click',
  'Control-click',
];

/** The README, split into its `## ` sections, keyed by heading. */
function readmeSections() {
  const readme = readRepo('README.md');
  const sections: Record<string, string> = {};
  let heading = '';
  for (const line of readme.split('\n')) {
    const match = /^## (.+)$/.exec(line);
    if (match) {
      heading = match[1];
      sections[heading] = '';
    } else if (heading) {
      sections[heading] += `${line}\n`;
    }
  }
  return sections;
}

describe('install copy', () => {
  it('the release notes tell nobody to bypass Gatekeeper', () => {
    const notes = readRepo('.github/release-notes.md');
    for (const phrase of BYPASS_COPY) {
      expect(notes, `bypass copy is back in the release notes: ${phrase}`).not.toContain(phrase);
    }
  });

  it("the README's download section tells nobody to bypass Gatekeeper", () => {
    const download = readmeSections()['Download'];
    expect(download, 'the README has no ## Download section').toBeTruthy();
    for (const phrase of BYPASS_COPY) {
      expect(download, `bypass copy is back in the download section: ${phrase}`)
        .not.toContain(phrase);
    }
  });

  it('the release notes say the build is notarized, so no override is expected', () => {
    expect(readRepo('.github/release-notes.md')).toMatch(/notariz/i);
  });

  it('the developer build documents its exception, rather than leaving it folklore', () => {
    const doc = readRepo('docs/macos-signing.md');
    expect(doc).toContain('Opening your own ad-hoc build');
    // The exception is only honest if the actual steps are there to follow.
    expect(doc).toContain('Open Anyway');
    expect(doc).toContain('com.apple.quarantine');
  });

  it('the README sends developers to that section instead of repeating it', () => {
    const development = readmeSections()['Development'];
    expect(development).toContain('ad-hoc');
    expect(development).toContain('macos-signing.md#opening-your-own-ad-hoc-build');
  });
});

describe('release scripts', () => {
  it.each([
    'scripts/check-release-credentials.cjs',
    'scripts/write-apple-api-key.cjs',
    'scripts/verify-build.cjs',
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

/**
 * The shell scripts' refusal paths, run for real. None of these need a build
 * artifact, so they run in CI before anything is packaged.
 *
 * `/bin/bash` deliberately, not `bash`: a macOS runner's /bin/bash is 3.2, and
 * 3.2 is where `"${empty[@]}"` under `set -u` is an unbound-variable error.
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
    expect(r.stderr).toContain('mode must be dev, release or dmg');
  });
  it('exits 1 when the app bundle is not there', () => {
    const r = runScript(script, ['release', '/nope.app']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no such app bundle');
  });
  it('exits 1 when the disk image is not there', () => {
    const r = runScript(script, ['dmg', '/nope.dmg']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no such disk image');
  });
  it('takes one app per app mode, so no caller has to guess what it consumes', () => {
    const r = runScript(script, ['dev', appDir, 'an-extra.dmg']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage:');
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

const runNode = (script: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, [path.join(appDir, script), ...args], {
    cwd: appDir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

describe('check-release-credentials.cjs', () => {
  const script = 'scripts/check-release-credentials.cjs';

  /** A release env with one hole in it, so the failure message can be read. */
  const holed = {
    PHASE_RELEASE_SIGNING: '1',
    PHASE_NOTARY_METHOD: 'api-key',
    CSC_LINK: 'base64-of-a-p12',
    CSC_KEY_PASSWORD: 'p12-passphrase',
    APPLE_API_KEY_P8_BASE64: 'base64-of-the-p8',
    APPLE_API_KEY_ID: '',
    APPLE_API_ISSUER: 'an-issuer-uuid',
    APPLE_ID: '',
    APPLE_APP_SPECIFIC_PASSWORD: '',
    APPLE_TEAM_ID: '',
  };

  it('passes without credentials when release signing is off', () => {
    expect(runNode(script, [], { PHASE_RELEASE_SIGNING: '' }).status).toBe(0);
  });
  it('fails naming the missing secret', () => {
    const r = runNode(script, [], holed);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('APPLE_API_KEY_ID');
  });
  it('rejects a key secret that is not really a key, before anything is built', () => {
    const r = runNode(script, [], {
      ...holed,
      APPLE_API_KEY_ID: 'ABC123',
      APPLE_API_KEY_P8_BASE64: Buffer.from('not a key at all').toString('base64'),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('BEGIN PRIVATE KEY');
  });
  it('rejects a key truncated on a base64 boundary, which every other check passes', () => {
    const { privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const full = Buffer.from(privateKey as unknown as string, 'utf8').toString('base64');
    const truncated = full.slice(0, Math.floor((full.length * 2) / 3 / 4) * 4);
    const r = runNode(script, [], {
      ...holed,
      APPLE_API_KEY_ID: 'ABC123',
      APPLE_API_KEY_P8_BASE64: truncated,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('END PRIVATE KEY');
    expect(r.stderr).not.toContain(truncated.slice(0, 32));
  });

  it('leaks no secret value on either stream, even the ones it found', () => {
    const r = runNode(script, [], holed);
    const output = r.stdout + r.stderr;
    for (const value of ['base64-of-a-p12', 'p12-passphrase', 'an-issuer-uuid', 'base64-of-the-p8']) {
      expect(output, 'the value of a secret reached the log').not.toContain(value);
    }
  });
});

describe('write-apple-api-key.cjs', () => {
  const script = 'scripts/write-apple-api-key.cjs';

  it('refuses to run without a destination, rather than inventing one', () => {
    const r = runNode(script, []);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage:');
  });
  it('fails on a malformed secret and says which variable is wrong', () => {
    const r = runNode(script, ['/tmp/phase-should-not-exist.p8'], {
      APPLE_API_KEY_P8_BASE64: 'not base64 !!!',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('APPLE_API_KEY_P8_BASE64');
    expect(r.stderr).not.toContain('not base64 !!!');
  });
});

describe('verify-build.cjs', () => {
  const script = 'scripts/verify-build.cjs';

  it('refuses an unknown mode', () => {
    const r = runNode(script, ['bogus']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage:');
  });
  it('fails, rather than passing quietly, when the build produced nothing', () => {
    const r = runNode(script, ['dev'], { PHASE_RELEASE_DIR: '/tmp/phase-no-such-release-dir' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('npm run build:mac');
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

  it('never names an architecture directory, which exists on only some Macs', () => {
    const pkg = JSON.parse(read('package.json'));
    for (const command of Object.values(pkg.scripts as Record<string, string>)) {
      expect(command, 'a hard-coded arch path verifies nothing on the other architecture')
        .not.toMatch(/mac-arm64|release\/mac\b/);
    }
    expect(pkg.scripts['verify:mac']).toContain('verify-build.cjs');
  });
});
