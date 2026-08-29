import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const nativeRequire = createRequire(import.meta.url);
const {
  signingMode,
  notaryMethod,
  requiredReleaseSecrets,
  missingReleaseSecrets,
  assertReleaseCredentials,
  macConfig,
  buildConfig,
} = nativeRequire('./releaseConfig.cjs') as typeof import('./releaseConfig.cjs');

/** A complete, plausible-looking release environment. Values are fake. */
const API_KEY_ENV = {
  PHASE_RELEASE_SIGNING: '1',
  CSC_LINK: 'base64-of-a-p12',
  CSC_KEY_PASSWORD: 'p12-passphrase',
  APPLE_API_KEY: '/tmp/AuthKey_ABC123.p8',
  APPLE_API_KEY_ID: 'ABC123',
  APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
};

const APPLE_ID_ENV = {
  PHASE_RELEASE_SIGNING: '1',
  PHASE_NOTARY_METHOD: 'apple-id',
  CSC_LINK: 'base64-of-a-p12',
  CSC_KEY_PASSWORD: 'p12-passphrase',
  APPLE_ID: 'releases@example.com',
  APPLE_APP_SPECIFIC_PASSWORD: 'abcd-efgh-ijkl-mnop',
  APPLE_TEAM_ID: 'TEAMID1234',
};

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

describe('requiredReleaseSecrets', () => {
  it('requires nothing in the ad-hoc developer path', () => {
    expect(requiredReleaseSecrets({})).toEqual([]);
  });
  it('requires the signing pair plus the API-key trio by default', () => {
    expect(requiredReleaseSecrets({ PHASE_RELEASE_SIGNING: '1' })).toEqual([
      'CSC_LINK',
      'CSC_KEY_PASSWORD',
      'APPLE_API_KEY',
      'APPLE_API_KEY_ID',
      'APPLE_API_ISSUER',
    ]);
  });
  it('requires the signing pair plus the Apple ID trio when chosen', () => {
    expect(requiredReleaseSecrets({ PHASE_RELEASE_SIGNING: '1', PHASE_NOTARY_METHOD: 'apple-id' })).toEqual([
      'CSC_LINK',
      'CSC_KEY_PASSWORD',
      'APPLE_ID',
      'APPLE_APP_SPECIFIC_PASSWORD',
      'APPLE_TEAM_ID',
    ]);
  });
});

describe('missingReleaseSecrets', () => {
  it('is empty when every required secret is present', () => {
    expect(missingReleaseSecrets(API_KEY_ENV)).toEqual([]);
    expect(missingReleaseSecrets(APPLE_ID_ENV)).toEqual([]);
  });
  it('counts a blank or whitespace-only secret as missing', () => {
    expect(missingReleaseSecrets({ ...API_KEY_ENV, CSC_KEY_PASSWORD: '' })).toEqual(['CSC_KEY_PASSWORD']);
    expect(missingReleaseSecrets({ ...API_KEY_ENV, APPLE_API_ISSUER: '   ' })).toEqual(['APPLE_API_ISSUER']);
  });
  it('lists every missing name, in the documented order', () => {
    expect(missingReleaseSecrets({ PHASE_RELEASE_SIGNING: '1' })).toEqual([
      'CSC_LINK',
      'CSC_KEY_PASSWORD',
      'APPLE_API_KEY',
      'APPLE_API_KEY_ID',
      'APPLE_API_ISSUER',
    ]);
  });
});

describe('assertReleaseCredentials', () => {
  it('passes silently in the ad-hoc developer path', () => {
    expect(() => assertReleaseCredentials({})).not.toThrow();
  });
  it('passes silently when the chosen method is fully configured', () => {
    expect(() => assertReleaseCredentials(API_KEY_ENV)).not.toThrow();
    expect(() => assertReleaseCredentials(APPLE_ID_ENV)).not.toThrow();
  });
  it('fails naming the missing secrets', () => {
    expect(() => assertReleaseCredentials({ PHASE_RELEASE_SIGNING: '1', CSC_LINK: 'x' }))
      .toThrow(/CSC_KEY_PASSWORD/);
  });
  it('never puts a secret value in the failure message', () => {
    let message = '';
    try {
      assertReleaseCredentials({ ...API_KEY_ENV, APPLE_API_KEY_ID: '' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('APPLE_API_KEY_ID');
    for (const value of Object.values(API_KEY_ENV)) {
      if (value === '1') continue; // the mode flag is not a secret
      expect(message).not.toContain(value);
    }
  });
  it('refuses a mixed environment, because electron-builder would silently prefer the Apple ID', () => {
    expect(() => assertReleaseCredentials({ ...API_KEY_ENV, APPLE_ID: 'releases@example.com' }))
      .toThrow(/APPLE_ID/);
  });
  it('refuses API-key variables while the Apple ID method is chosen', () => {
    expect(() => assertReleaseCredentials({ ...APPLE_ID_ENV, APPLE_API_KEY_ID: 'ABC123' }))
      .toThrow(/APPLE_API_KEY_ID/);
  });
});

describe('macConfig', () => {
  it('hardens the runtime and points at the repo-owned entitlements in both modes', () => {
    for (const env of [{}, API_KEY_ENV]) {
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
    const mac = macConfig(API_KEY_ENV);
    expect(mac.identity).toBeUndefined();
    expect(mac.notarize).toBe(true);
    expect(mac.gatekeeperAssess).toBe(false);
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
});
