// The App Store Connect key, from a repository secret to the file notarytool
// reads — and nothing in between.
//
// The secret and the file are two different things and are deliberately given
// two different names: `APPLE_API_KEY_P8_BASE64` is the base64 of the `.p8`,
// and `APPLE_API_KEY` is a PATH, because that is what @electron/notarize and
// `xcrun notarytool --key` expect. Overloading one name for both is how a build
// ends up handing notarytool a base64 blob as though it were a filename and
// getting an error that names neither.
//
// Every failure here names the VARIABLE. None of them ever includes the input,
// the decoded bytes, or any slice of either: a message is a log line, and a log
// line is forever.

const fs = require('node:fs');
const path = require('node:path');

/** The repository secret: base64 of the AuthKey_XXXXXXXX.p8 file. */
const API_KEY_BASE64_ENV = 'APPLE_API_KEY_P8_BASE64';
/** What electron-builder and notarytool read: a path to the decoded file. */
const API_KEY_PATH_ENV = 'APPLE_API_KEY';

/** What a PKCS#8 key says on its first line. Apple issues nothing else. */
const PKCS8_HEADER = '-----BEGIN PRIVATE KEY-----';

const BASE64_ALPHABET = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decode the secret, or throw naming what is wrong with it.
 *
 * Node's base64 decoder silently drops anything it does not recognise, so a
 * truncated or corrupted secret would decode to plausible-looking garbage and
 * only fail hours later inside notarytool. This validates strictly instead:
 * the alphabet, the length, a round-trip, and then the header of what came out.
 */
function decodeApiKey(base64) {
  if (typeof base64 !== 'string' || base64.trim() === '') {
    throw new Error(`${API_KEY_BASE64_ENV} is not set, or is blank.`);
  }

  // `base64 -i file` wraps at 64 columns, and a pasted secret carries newlines.
  const normalized = base64.replace(/\s+/g, '');

  if (!BASE64_ALPHABET.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error(
      `${API_KEY_BASE64_ENV} is not valid base64. Regenerate it with ` +
        `\`base64 -i AuthKey_XXXXXXXX.p8\` and paste the whole output.`,
    );
  }

  const decoded = Buffer.from(normalized, 'base64');
  // The round trip is the real check: Node accepts stray characters by ignoring
  // them, so only re-encoding proves nothing was dropped.
  if (decoded.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) {
    throw new Error(
      `${API_KEY_BASE64_ENV} is not valid base64 — some of it was discarded on ` +
        `decode, so the secret is truncated or corrupted.`,
    );
  }

  if (!decoded.toString('utf8').includes(PKCS8_HEADER)) {
    throw new Error(
      `${API_KEY_BASE64_ENV} decodes to something that is not an App Store ` +
        `Connect key: no ${PKCS8_HEADER} header. It should be the base64 of the ` +
        `AuthKey_XXXXXXXX.p8 file, not the key id, the issuer, or a certificate.`,
    );
  }

  return decoded;
}

/**
 * Validate, then write the key where notarytool can read it — and only there.
 *
 * Validation happens first and the write is atomic-ish by consequence: a
 * malformed secret leaves no file behind for a later step to half-use.
 * Mode 0600 because the runner is shared with nothing, but the file is a
 * credential all the same.
 */
function writeApiKey(base64, destPath) {
  const decoded = decodeApiKey(base64);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, decoded, { mode: 0o600 });
  // writeFileSync honours `mode` only when it creates the file; a leftover from
  // an earlier run would keep its old permissions.
  fs.chmodSync(destPath, 0o600);
  return destPath;
}

module.exports = { API_KEY_BASE64_ENV, API_KEY_PATH_ENV, PKCS8_HEADER, decodeApiKey, writeApiKey };
