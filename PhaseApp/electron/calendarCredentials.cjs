// Project-managed OAuth client credentials — the pair Phase ships with, so a
// user does not have to create a Google Cloud project before they can plan a
// week.
//
// NOTHING IS HARDCODED HERE, and nothing may ever be. The pair arrives either
// in a file the build writes into the bundle (git-ignored) or in two
// environment variables during `npm run app:dev`. A checkout with neither
// resolves to `null`, and the app then falls back to the user's own OAuth
// client, entered through Settings' advanced disclosure.
//
// A desktop OAuth client's "secret" is not confidential — a desktop app cannot
// keep one, which is why PKCE, not the secret, is what protects the flow. That
// is why shipping one is safe at all; it is still kept out of the repository
// so it is rotatable without a code change.

/** Written into the bundle at build time, beside this module. Git-ignored. */
const CREDENTIALS_FILE = 'calendar-credentials.json';
const CLIENT_ID_ENV = 'PHASE_GOOGLE_CLIENT_ID';
const CLIENT_SECRET_ENV = 'PHASE_GOOGLE_CLIENT_SECRET';

/** A credential is present only if it is a non-empty string after trimming. */
function cleanValue(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

/** Both or neither: half a pair cannot authenticate, so it is not a pair. */
function pairOf(clientId, clientSecret) {
  const id = cleanValue(clientId);
  const secret = cleanValue(clientSecret);
  if (!id || !secret) return null;
  return { clientId: id, clientSecret: secret };
}

function fromFile(readCredentialsFile) {
  let raw;
  try {
    raw = readCredentialsFile();
  } catch {
    // An unreadable file is the same as an absent one. A permissions error
    // here must not stop the main process from finishing its boot.
    return null;
  }
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return pairOf(parsed.clientId, parsed.clientSecret);
}

/**
 * The credentials this build manages, or `null` when it manages none.
 *
 * The packaged file wins over the environment: the file is what the build
 * shipped, and a released app must not have its OAuth client swapped by
 * whatever happened to be exported in the shell that launched it. The
 * environment exists for `npm run app:dev`, where there is no packaged file.
 */
function resolveManagedCredentials(deps) {
  const { env, readCredentialsFile } = deps;
  return fromFile(readCredentialsFile)
    ?? pairOf(env ? env[CLIENT_ID_ENV] : undefined, env ? env[CLIENT_SECRET_ENV] : undefined);
}

module.exports = {
  CREDENTIALS_FILE,
  CLIENT_ID_ENV,
  CLIENT_SECRET_ENV,
  resolveManagedCredentials,
};
