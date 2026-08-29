import { describe, it, expect } from 'vitest';
import {
  resolveManagedCredentials,
  CREDENTIALS_FILE,
  CLIENT_ID_ENV,
  CLIENT_SECRET_ENV,
  type ManagedCredentialsDeps,
} from './calendarCredentials.cjs';

function deps(over: Partial<ManagedCredentialsDeps> = {}): ManagedCredentialsDeps {
  return {
    env: {},
    readCredentialsFile: () => null,
    ...over,
  };
}

describe('resolveManagedCredentials', () => {
  it('has nothing when the build shipped no credentials', () => {
    expect(resolveManagedCredentials(deps())).toBeNull();
  });

  it('reads the pair the build baked into the bundle', () => {
    const file = JSON.stringify({ clientId: 'built-in.apps.googleusercontent.com', clientSecret: 'built-in-secret' });
    expect(resolveManagedCredentials(deps({ readCredentialsFile: () => file }))).toEqual({
      clientId: 'built-in.apps.googleusercontent.com',
      clientSecret: 'built-in-secret',
    });
  });

  it('reads the pair from the environment when there is no file', () => {
    expect(resolveManagedCredentials(deps({
      env: { [CLIENT_ID_ENV]: 'env-id', [CLIENT_SECRET_ENV]: 'env-secret' },
    }))).toEqual({ clientId: 'env-id', clientSecret: 'env-secret' });
  });

  // The file is the packaged artefact; the environment is the developer's
  // override during `npm run app:dev`. A shipped build must not have its
  // credentials swapped by whatever happened to be exported in the shell that
  // launched it.
  it('prefers the packaged file over the environment', () => {
    const file = JSON.stringify({ clientId: 'file-id', clientSecret: 'file-secret' });
    expect(resolveManagedCredentials(deps({
      readCredentialsFile: () => file,
      env: { [CLIENT_ID_ENV]: 'env-id', [CLIENT_SECRET_ENV]: 'env-secret' },
    }))).toEqual({ clientId: 'file-id', clientSecret: 'file-secret' });
  });

  // The discriminating test. Half a pair cannot authenticate, and reporting it
  // as present would make the UI hide the credentials form behind "Connect"
  // and then fail at consent with nothing the user can act on.
  it('refuses half a pair rather than reporting a broken configuration', () => {
    expect(resolveManagedCredentials(deps({ env: { [CLIENT_ID_ENV]: 'env-id' } }))).toBeNull();
    expect(resolveManagedCredentials(deps({ env: { [CLIENT_SECRET_ENV]: 'env-secret' } }))).toBeNull();
    expect(resolveManagedCredentials(deps({
      readCredentialsFile: () => JSON.stringify({ clientId: 'file-id' }),
    }))).toBeNull();
  });

  it('trims surrounding whitespace, which a copied credential carries', () => {
    expect(resolveManagedCredentials(deps({
      env: { [CLIENT_ID_ENV]: '  env-id\n', [CLIENT_SECRET_ENV]: ' env-secret ' },
    }))).toEqual({ clientId: 'env-id', clientSecret: 'env-secret' });
  });

  it('treats an all-whitespace value as absent', () => {
    expect(resolveManagedCredentials(deps({
      env: { [CLIENT_ID_ENV]: '   ', [CLIENT_SECRET_ENV]: 'env-secret' },
    }))).toBeNull();
  });

  // A malformed file must not take the whole main process down at boot: the
  // planner has to open even when the calendar wiring cannot.
  it('survives an unparseable file', () => {
    expect(resolveManagedCredentials(deps({ readCredentialsFile: () => '{ not json' }))).toBeNull();
  });

  it('falls back to the environment when the file is malformed', () => {
    expect(resolveManagedCredentials(deps({
      readCredentialsFile: () => '{ not json',
      env: { [CLIENT_ID_ENV]: 'env-id', [CLIENT_SECRET_ENV]: 'env-secret' },
    }))).toEqual({ clientId: 'env-id', clientSecret: 'env-secret' });
  });

  it('survives a reader that throws', () => {
    expect(resolveManagedCredentials(deps({
      readCredentialsFile: () => { throw new Error('EACCES'); },
    }))).toBeNull();
  });

  it('ignores a file whose JSON is not an object', () => {
    expect(resolveManagedCredentials(deps({ readCredentialsFile: () => '"a string"' }))).toBeNull();
    expect(resolveManagedCredentials(deps({ readCredentialsFile: () => 'null' }))).toBeNull();
  });

  it('names the file and the two variables it looks for', () => {
    expect(CREDENTIALS_FILE).toBe('calendar-credentials.json');
    expect(CLIENT_ID_ENV).toBe('PHASE_GOOGLE_CLIENT_ID');
    expect(CLIENT_SECRET_ENV).toBe('PHASE_GOOGLE_CLIENT_SECRET');
  });
});
