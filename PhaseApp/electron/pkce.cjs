// PKCE for the installed-app OAuth flow (RFC 7636).
//
// The verifier never leaves this process; only its SHA-256 challenge is sent
// to Google. That is what makes an intercepted authorization code useless to
// anyone who did not generate the verifier.

const crypto = require('node:crypto');

const VERIFIER_BYTES = 32; // 43 base64url chars — the RFC 7636 minimum
const STATE_BYTES = 16;

function base64url(bytes) {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createPkce(randomBytes = crypto.randomBytes) {
  const verifier = base64url(randomBytes(VERIFIER_BYTES));
  // S256, never "plain": a plain challenge is the verifier itself, which
  // gives an interceptor everything they need.
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(STATE_BYTES));
  return { verifier, challenge, state };
}

module.exports = { base64url, createPkce, VERIFIER_BYTES, STATE_BYTES };
