import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const {
  signingMode,
  notaryMethod,
  requiredReleaseSecrets,
  requiredBuilderVars,
  missingReleaseSecrets,
  missingBuilderVars,
  assertReleaseSecrets,
  assertBuilderEnv,
  macConfig,
  buildConfig,
} = nativeRequire('./releaseConfig.cjs') as typeof import('./releaseConfig.cjs');

/** Values are fake throughout; only their presence is ever meaningful. */
const CERT = { CSC_LINK: 'base64-of-a-p12', CSC_KEY_PASSWORD: 'p12-passphrase' };

/** What the workflow's PREFLIGHT sees: repository secrets, before any file. */
const API_KEY_SECRETS = {
  PHASE_RELEASE_SIGNING: '1',
  ...CERT,
  APPLE_API_KEY_P8_BASE64: 'base64-of-the-p8',
  APPLE_API_KEY_ID: 'ABC123',
  APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
};

/** What ELECTRON-BUILDER sees: the key as a path, never as base64. */
const API_KEY_BUILDER = {
  PHASE_RELEASE_SIGNING: '1',
  ...CERT,
  APPLE_API_KEY: '/runner/temp/apple-api-key.p8',
  APPLE_API_KEY_ID: 'ABC123',
  APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
};

/** The Apple ID method needs no file, so both views of it are identical. */
const APPLE_ID_ENV = {
  PHASE_RELEASE_SIGNING: '1',
  PHASE_NOTARY_METHOD: 'apple-id',
  ...CERT,
  APPLE_ID: 'releases@example.com',
  APPLE_APP_SPECIFIC_PASSWORD: 'abcd-efgh-ijkl-mnop',
  APPLE_TEAM_ID: 'TEAMID1234',
};

/** electron-builder is handed a real path; the file's existence is checked. */
const present = { fileExists: () => true };
const absent = { fileExists: () => false };

describe('signingMode', () => {
  it('is ad-hoc when the release flag is absent — the developer default', () => {
    expect(signingMode({})).toBe('adhoc');
  });
  it('stays ad-hoc for empty and falsey flag values', () => {
    expect(signingMode({ PHASE_RELEASE_SIGNING: '' })).toBe('adhoc');
    expect(signingMode({ PHASE_RELEASE_SIGNING: '0' })).toBe('adhoc');
    expect(signingMode({ PHASE_RELEASE_SIGNING: 'false' })).toBe('adhoc');
  });
  it('is developer-id only when the flag is explicitly on', () => {
    expect(signingMode({ PHASE_RELEASE_SIGNING: '1' })).toBe('developer-id');
    expect(signingMode({ PHASE_RELEASE_SIGNING: 'true' })).toBe('developer-id');
  });
});

describe('notaryMethod', () => {
  it('defaults to the App Store Connect API key', () => {
    expect(notaryMethod({})).toBe('api-key');
  });
  it('honours an explicit Apple ID choice', () => {
    expect(notaryMethod({ PHASE_NOTARY_METHOD: 'apple-id' })).toBe('apple-id');
  });
  it('refuses an unknown method and names the valid ones', () => {
    expect(() => notaryMethod({ PHASE_NOTARY_METHOD: 'keychain' }))
      .toThrow(/api-key.*apple-id|apple-id.*api-key/s);
  });
});

describe('the two contracts are not the same contract', () => {
  it('the preflight asks for the base64 SECRET', () => {
    expect(requiredReleaseSecrets({ PHASE_RELEASE_SIGNING: '1' })).toEqual([
      'CSC_LINK',
      'CSC_KEY_PASSWORD',
      'APPLE_API_KEY_P8_BASE64',
      'APPLE_API_KEY_ID',
      'APPLE_API_ISSUER',
    ]);
  });
  it('electron-builder asks for the key PATH, and never for the base64', () => {
    expect(requiredBuilderVars({ PHASE_RELEASE_SIGNING: '1' })).toEqual([
      'CSC_LINK',
      'CSC_KEY_PASSWORD',
      'APPLE_API_KEY',
      'APPLE_API_KEY_ID',
      'APPLE_API_ISSUER',
    ]);
    expect(requiredBuilderVars({ PHASE_RELEASE_SIGNING: '1' }))
      .not.toContain('APPLE_API_KEY_P8_BASE64');
  });
  it('the Apple ID method needs no file, so both views agree', () => {
    const expected = [
      'CSC_LINK',
      'CSC_KEY_PASSWORD',
      'APPLE_ID',
      'APPLE_APP_SPECIFIC_PASSWORD',
      'APPLE_TEAM_ID',
    ];
    expect(requiredReleaseSecrets(APPLE_ID_ENV)).toEqual(expected);
    expect(requiredBuilderVars(APPLE_ID_ENV)).toEqual(expected);
  });
  it('requires nothing at all in the ad-hoc developer path', () => {
    expect(requiredReleaseSecrets({})).toEqual([]);
    expect(requiredBuilderVars({})).toEqual([]);
  });
});

describe('missing values', () => {
  it('is empty when the right set for the right stage is complete', () => {
    expect(missingReleaseSecrets(API_KEY_SECRETS)).toEqual([]);
    expect(missingBuilderVars(API_KEY_BUILDER)).toEqual([]);
    expect(missingReleaseSecrets(APPLE_ID_ENV)).toEqual([]);
    expect(missingBuilderVars(APPLE_ID_ENV)).toEqual([]);
  });
  it('does not accept the base64 secret in place of the key path', () => {
    expect(missingBuilderVars(API_KEY_SECRETS)).toEqual(['APPLE_API_KEY']);
  });
  it('counts a blank or whitespace-only value as missing', () => {
    expect(missingReleaseSecrets({ ...API_KEY_SECRETS, CSC_KEY_PASSWORD: '' }))
      .toEqual(['CSC_KEY_PASSWORD']);
    expect(missingReleaseSecrets({ ...API_KEY_SECRETS, APPLE_API_ISSUER: '   ' }))
      .toEqual(['APPLE_API_ISSUER']);
  });
});

describe('assertReleaseSecrets', () => {
  it('passes silently in the ad-hoc developer path', () => {
    expect(() => assertReleaseSecrets({})).not.toThrow();
  });
  it('passes silently when the chosen method is fully configured', () => {
    expect(() => assertReleaseSecrets(API_KEY_SECRETS)).not.toThrow();
    expect(() => assertReleaseSecrets(APPLE_ID_ENV)).not.toThrow();
  });
  it('fails naming the missing secrets', () => {
    expect(() => assertReleaseSecrets({ PHASE_RELEASE_SIGNING: '1', CSC_LINK: 'x' }))
      .toThrow(/CSC_KEY_PASSWORD/);
  });
  it('never puts a secret value in the failure message', () => {
    let message = '';
    try {
      assertReleaseSecrets({ ...API_KEY_SECRETS, APPLE_API_KEY_ID: '' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('APPLE_API_KEY_ID');
    for (const value of Object.values(API_KEY_SECRETS)) {
      if (value === '1') continue; // the mode flag is not a secret
      expect(message).not.toContain(value);
    }
  });
  it('refuses a mixed environment, because electron-builder would silently prefer the Apple ID', () => {
    expect(() => assertReleaseSecrets({ ...API_KEY_SECRETS, APPLE_ID: 'releases@example.com' }))
      .toThrow(/APPLE_ID/);
  });
  it('refuses API-key variables while the Apple ID method is chosen, base64 or path', () => {
    expect(() => assertReleaseSecrets({ ...APPLE_ID_ENV, APPLE_API_KEY_P8_BASE64: 'x' }))
      .toThrow(/APPLE_API_KEY_P8_BASE64/);
    expect(() => assertReleaseSecrets({ ...APPLE_ID_ENV, APPLE_API_KEY: '/tmp/k.p8' }))
      .toThrow(/APPLE_API_KEY/);
  });
});

describe('assertBuilderEnv', () => {
  it('passes when the key file the path names is really there', () => {
    expect(() => assertBuilderEnv(API_KEY_BUILDER, present)).not.toThrow();
  });
  it('fails when the key was never materialised, naming the variable and the path', () => {
    expect(() => assertBuilderEnv(API_KEY_BUILDER, absent))
      .toThrow(/APPLE_API_KEY.*\/runner\/temp\/apple-api-key\.p8/s);
  });
  it('does not look for a file the Apple ID method never creates', () => {
    expect(() => assertBuilderEnv(APPLE_ID_ENV, absent)).not.toThrow();
  });
  it('fails when the base64 secret was passed where the path belongs', () => {
    expect(() => assertBuilderEnv(API_KEY_SECRETS, present)).toThrow(/APPLE_API_KEY\b/);
  });
});

describe('macConfig', () => {
  it('hardens the runtime and points at the repo-owned entitlements in both modes', () => {
    for (const env of [{}, API_KEY_BUILDER]) {
      const mac = macConfig(env);
      expect(mac.hardenedRuntime).toBe(true);
      expect(mac.entitlements).toBe('build/entitlements.mac.plist');
      expect(mac.entitlementsInherit).toBe('build/entitlements.mac.inherit.plist');
    }
  });
  it('pins ad-hoc identity and disables notarization for a developer build', () => {
    const mac = macConfig({});
    expect(mac.identity).toBe('-');
    expect(mac.notarize).toBe(false);
  });
  it('leaves identity to the imported certificate and turns notarization on for a release', () => {
    const mac = macConfig(API_KEY_BUILDER);
    expect(mac.identity).toBeUndefined();
    expect(mac.notarize).toBe(true);
  });
  it('sets no option that only restates an electron-builder default', () => {
    // `gatekeeperAssess` already defaults to false; writing it changed nothing
    // and the comment beside it claimed a reason that was never operative.
    expect(macConfig({})).not.toHaveProperty('gatekeeperAssess');
    expect(macConfig(API_KEY_BUILDER)).not.toHaveProperty('gatekeeperAssess');
  });
});

describe('buildConfig', () => {
  it('keeps the packaging invariants the app depends on', () => {
    const config = buildConfig({});
    expect(config.appId).toBe('com.secoandhood.phase');
    expect(config.productName).toBe('Phase');
    expect(config.directories.output).toBe('release');
    expect(config.directories.buildResources).toBe('build');
    expect(config.files).toEqual(['dist/**/*', 'electron/**/*']);
    expect(config.mac.target).toEqual([{ target: 'dmg', arch: ['arm64', 'x64'] }]);
    expect(config.mac.icon).toBe('build/icon.icns');
    expect(config.mac.category).toBe('public.app-category.productivity');
  });
  it('refuses to produce a release config with credentials missing', () => {
    expect(() => buildConfig({ PHASE_RELEASE_SIGNING: '1' })).toThrow(/CSC_LINK/);
  });
  it('refuses a release whose key file the materialise step never wrote', () => {
    expect(() => buildConfig(API_KEY_BUILDER, absent)).toThrow(/APPLE_API_KEY/);
  });
});
