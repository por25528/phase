# Google Calendar producer — the Electron side (2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Phase able to connect to Google Calendar and fetch real `BusyBlock[]`, entirely inside the Electron main process, callable from the renderer over a five-channel IPC surface.

**Architecture:** Every module that touches the network, the filesystem, the clock or the OS takes its dependencies as **injected adapters**, so the whole producer is exercised offline with no mock server and no network. `main.cjs` supplies the real adapters (`node:https` via global `fetch`, `node:http`, `node:fs`, `electron`'s `safeStorage` and `shell`). Plan 1's `busyBlocks.cjs` does all the arithmetic; nothing here computes a minute.

**Tech Stack:** Electron 43 (Node 26 in main), CommonJS main-process modules, Node built-ins only — `node:crypto`, `node:http`, `node:fs`, global `fetch`. **No new npm dependency.** Vitest for tests.

## Global Constraints

Every task's requirements implicitly include this section.

- **Spec:** `docs/superpowers/specs/2026-08-04-google-calendar-producer-design.md`. Where this plan and the spec disagree, stop and ask.
- **Both `npm test` and `npx tsc -b` must be green before every commit.** No commit may leave the build broken, even transiently.
- **Baseline entering this plan: 1509 tests across 77 files.** Report the actual count each task; do not assume the plan's arithmetic is right.
- `src/views/goals/BoardCard.keyboard.test.tsx` is a **known pre-existing flake** under parallel load — re-run it alone before investigating. Not caused by this plan.
- **No test may touch the network, the real filesystem, the real clock, or the `electron` module.** Every dependency is injected. A test that would need a mock HTTP server is a test written wrong.
- **No new npm dependency.** Node built-ins only.
- **Nothing in `src/` changes in this plan.** The renderer wiring is plan 3. If you find yourself editing a file under `src/`, stop and report.
- `electron/*.cjs` are **CommonJS**: `module.exports = { ... }`, `require(...)`. Each gets a hand-written `.d.cts` so its `.ts` test is typechecked — `allowJs` is off deliberately, and the declaration doubles as the module's contract across the process seam.
- **No token, refresh token, client secret, or raw Google JSON may cross IPC.** `status()` returns an account id for provenance, never a credential.
- **The renderer never supplies a URL.** `fetch` takes calendar ids and a date range; main builds every URL itself and validates every argument.
- **Handlers register before the window loads.**
- Commit messages: imperative mood, no trailing period on the subject, ending with the `Co-Authored-By: Claude <noreply@anthropic.com>` trailer.

## What plan 1 already provides

`electron/busyBlocks.cjs` exports, with types in `electron/busyBlocks.d.cts`:

```ts
shouldSkipEvent(event: GoogleEvent): boolean
expandToLocalDays(event: GoogleEvent, timeZone: string, bounds?: ExpansionBounds): BusyBlock[]
normalizeEvents(events: GoogleEvent[], options: NormalizeOptions): BusyBlock[]
// NormalizeOptions = { rangeStart, rangeEnd, timeZone }; rangeEnd EXCLUSIVE
// BusyBlock = { date, startMin, endMin, title, allDay }
```

`normalizeEvents` throws `RangeError` on a malformed event and aborts the whole batch — deliberately, so incomplete data is never presented as free time. **This plan must let that throw reach `fetch()`'s failure path, not swallow it.**

`src/lib/calendarRange.ts` computes the range, but it lives in `src/` and is plan 3's caller. This plan takes `rangeStart`/`rangeEnd` as given.

## The one arithmetic decision in this plan

`normalizeEvents` clips by **local date**; Google's `events.list` takes **instants** (`timeMin`/`timeMax`). Converting a local date to an instant needs zone-offset arithmetic, and getting it wrong silently drops boundary-day events — a partial fetch the all-or-nothing rule cannot catch, because every page *succeeded*.

So this plan does not do that arithmetic. It queries a **one-day margin on each side at UTC midnight** and lets `normalizeEvents` clip exactly:

```
timeMin = <rangeStart − 1 day>T00:00:00Z
timeMax = <rangeEnd + 1 day>T00:00:00Z
```

The largest real UTC offset is ±14h < 24h, so UTC midnight of `rangeStart − 1` is provably before local midnight of `rangeStart` in every zone, and likewise at the end. The margin costs one extra day of events and removes an entire class of bug.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `electron/secrets.cjs` + `.d.cts` + `.test.ts` | encrypted key/value store over `safeStorage` | 1 |
| `electron/pkce.cjs` + `.d.cts` + `.test.ts` | PKCE verifier/challenge/state | 2 |
| `electron/oauth.cjs` + `.d.cts` + `.test.ts` | consent URL, code exchange, loopback listener, refresh, revoke | 3–5 |
| `electron/googleClient.cjs` + `.d.cts` + `.test.ts` | `calendarList.list`, `events.list` fan-out + pagination | 6 |
| `electron/calendarIpc.cjs` + `.d.cts` + `.test.ts` | the five handlers; wires everything | 7 |
| `electron/preload.cjs` | `contextBridge` → `window.phaseCalendar` | 8 |
| `electron/main.cjs` | supply real adapters; register handlers before load | 8 |
| `docs/google-calendar-setup.md` | the Cloud console walkthrough | 8 |

---

### Task 1: The encrypted secret store

Everything sensitive — the user's OAuth client id and secret, and later the refresh token — lands here. One module, one responsibility: encrypted key/value persistence. `oauth.cjs` and `calendarIpc.cjs` both use it rather than each inventing storage.

**A spec correction this task makes.** Spec §4's module table names
`electron/credentials.cjs`, "store/read the user's OAuth client id + secret".
That module would own half a job: the refresh token needs exactly the same
encrypted storage, and two modules writing two encrypted files would be a
second thing to get wrong for no gain. This task builds `electron/secrets.cjs`
— encrypted key/value persistence — and both the client credentials and the
token live in it under separate keys. Amend §4's row accordingly as part of
this task; the table is the map a later reader navigates by.

**Files:**
- Create: `electron/secrets.cjs`, `electron/secrets.d.cts`
- Modify: `docs/superpowers/specs/2026-08-04-google-calendar-producer-design.md` (§4)
- Test: `electron/secrets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  createSecretStore(deps: SecretStoreDeps): SecretStore
  interface SecretStoreDeps {
    readFile(): Buffer | null;          // null when absent
    writeFile(bytes: Buffer): void;
    removeFile(): void;
    encrypt(plain: string): Buffer;
    decrypt(bytes: Buffer): string;
    isEncryptionAvailable(): boolean;
  }
  interface SecretStore {
    available(): boolean;
    get(key: string): unknown;          // undefined when absent
    set(key: string, value: unknown): void;
    remove(key: string): void;
    reset(): void;                      // delete the whole store
  }
  class CorruptSecretStoreError extends Error {}
  ```

- [ ] **Step 1: Write the failing test**

Create `electron/secrets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createSecretStore, CorruptSecretStoreError, type SecretStoreDeps } from './secrets.cjs';

/**
 * A fake `safeStorage` + file. `encrypt` reverses the string so a test can
 * tell "was this actually encrypted?" apart from "was it written in the
 * clear?" — a store that silently skipped encryption would otherwise pass
 * every round-trip assertion.
 */
function fakeDeps(overrides: Partial<SecretStoreDeps> = {}) {
  const state: { file: Buffer | null } = { file: null };
  const rev = (s: string) => [...s].reverse().join('');
  const deps: SecretStoreDeps = {
    readFile: () => state.file,
    writeFile: (bytes) => { state.file = bytes; },
    removeFile: () => { state.file = null; },
    encrypt: (plain) => Buffer.from(rev(plain), 'utf8'),
    decrypt: (bytes) => rev(bytes.toString('utf8')),
    isEncryptionAvailable: () => true,
    ...overrides,
  };
  return { deps, state };
}

describe('createSecretStore', () => {
  it('reports nothing before anything is written', () => {
    const { deps } = fakeDeps();
    expect(createSecretStore(deps).get('client')).toBeUndefined();
  });

  it('round-trips a structured value', () => {
    const { deps } = fakeDeps();
    const store = createSecretStore(deps);
    store.set('client', { clientId: 'abc.apps.googleusercontent.com', clientSecret: 's3cret' });
    expect(store.get('client')).toEqual({ clientId: 'abc.apps.googleusercontent.com', clientSecret: 's3cret' });
  });

  it('keeps separate keys separate', () => {
    const { deps } = fakeDeps();
    const store = createSecretStore(deps);
    store.set('client', { clientId: 'a' });
    store.set('token', { refreshToken: 'r' });
    expect(store.get('client')).toEqual({ clientId: 'a' });
    expect(store.get('token')).toEqual({ refreshToken: 'r' });
  });

  // The whole point of the module. Plaintext on disk would pass every
  // round-trip test above.
  it('never writes a secret in the clear', () => {
    const { deps, state } = fakeDeps();
    createSecretStore(deps).set('token', { refreshToken: 'SUPERSECRET' });
    expect(state.file).not.toBeNull();
    expect(state.file!.toString('utf8')).not.toContain('SUPERSECRET');
  });

  it('removes one key without disturbing the others', () => {
    const { deps } = fakeDeps();
    const store = createSecretStore(deps);
    store.set('client', { clientId: 'a' });
    store.set('token', { refreshToken: 'r' });
    store.remove('token');
    expect(store.get('token')).toBeUndefined();
    expect(store.get('client')).toEqual({ clientId: 'a' });
  });

  it('reset deletes the file outright', () => {
    const { deps, state } = fakeDeps();
    const store = createSecretStore(deps);
    store.set('client', { clientId: 'a' });
    store.reset();
    expect(state.file).toBeNull();
    expect(store.get('client')).toBeUndefined();
  });

  it('reports whether the OS can encrypt at all', () => {
    expect(createSecretStore(fakeDeps().deps).available()).toBe(true);
    expect(createSecretStore(fakeDeps({ isEncryptionAvailable: () => false }).deps).available()).toBe(false);
  });

  it('refuses to write when the OS cannot encrypt', () => {
    const { deps, state } = fakeDeps({ isEncryptionAvailable: () => false });
    expect(() => createSecretStore(deps).set('client', { clientId: 'a' })).toThrow(/encryption/i);
    expect(state.file).toBeNull();
  });

  // An undecryptable blob can never become readable — a Keychain reset, a
  // restore onto a different machine. Throwing a NAMED error lets the caller
  // offer a reset instead of the app failing at boot with a parse error.
  it('throws a typed error when the stored blob cannot be decrypted', () => {
    const { deps } = fakeDeps({ decrypt: () => { throw new Error('bad key'); } });
    deps.writeFile(Buffer.from('whatever'));
    expect(() => createSecretStore(deps).get('client')).toThrow(CorruptSecretStoreError);
  });

  it('throws the same typed error when the decrypted text is not JSON', () => {
    const { deps } = fakeDeps({ decrypt: () => 'not json at all' });
    deps.writeFile(Buffer.from('whatever'));
    expect(() => createSecretStore(deps).get('client')).toThrow(CorruptSecretStoreError);
  });

  // Recovery path: reset must work even when the store cannot be read.
  it('can reset a corrupt store', () => {
    const { deps, state } = fakeDeps({ decrypt: () => { throw new Error('bad key'); } });
    deps.writeFile(Buffer.from('whatever'));
    const store = createSecretStore(deps);
    store.reset();
    expect(state.file).toBeNull();
    expect(store.get('client')).toBeUndefined();
  });

  it('re-reads the file each time rather than caching a stale copy', () => {
    const { deps } = fakeDeps();
    const a = createSecretStore(deps);
    const b = createSecretStore(deps);
    a.set('client', { clientId: 'written-by-a' });
    expect(b.get('client')).toEqual({ clientId: 'written-by-a' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run --config vitest.config.ts electron/secrets.test.ts
```

Expected: FAIL — `Failed to resolve import "./secrets.cjs"`.

- [ ] **Step 3: Write the contract**

Create `electron/secrets.d.cts`:

```ts
/**
 * The contract for `secrets.cjs`. Hand-written because the module is CommonJS
 * with no build step; `allowJs` is off deliberately.
 */

/** Injected so the store is testable with no filesystem and no Electron. */
export interface SecretStoreDeps {
  /** The raw encrypted blob, or null when the file does not exist. */
  readFile(): Buffer | null;
  writeFile(bytes: Buffer): void;
  removeFile(): void;
  /** In production these are Electron's `safeStorage`. */
  encrypt(plain: string): Buffer;
  decrypt(bytes: Buffer): string;
  isEncryptionAvailable(): boolean;
}

export interface SecretStore {
  /** False when the OS keychain is unavailable — writes will throw. */
  available(): boolean;
  /** `undefined` when the key is absent. Throws `CorruptSecretStoreError`. */
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  /** Delete the whole store. Works even when it cannot be read. */
  reset(): void;
}

/**
 * The stored blob exists but cannot be decrypted or parsed.
 *
 * Named rather than generic because it is RECOVERABLE and the recovery is
 * specific: the caller resets the store and asks the user to reconnect. A
 * generic parse error at boot would look like a crash.
 */
export declare class CorruptSecretStoreError extends Error {}

export declare function createSecretStore(deps: SecretStoreDeps): SecretStore;
```

- [ ] **Step 4: Write the implementation**

Create `electron/secrets.cjs`:

```js
// Encrypted key/value persistence for the main process.
//
// One file holds one JSON object, encrypted as a whole. Every dependency is
// injected, so this is fully testable with no filesystem and no Electron; see
// secrets.test.ts. Contract in secrets.d.cts.

class CorruptSecretStoreError extends Error {
  constructor(cause) {
    super('The stored credentials could not be read. Reset and reconnect.');
    this.name = 'CorruptSecretStoreError';
    this.cause = cause;
  }
}

function createSecretStore(deps) {
  const { readFile, writeFile, removeFile, encrypt, decrypt, isEncryptionAvailable } = deps;

  // Read on every call rather than caching. The store is tiny, and a cache
  // would let two store instances — or a reset — leave a stale copy live.
  function readAll() {
    const raw = readFile();
    if (!raw) return {};
    let text;
    try {
      text = decrypt(raw);
    } catch (err) {
      throw new CorruptSecretStoreError(err);
    }
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      return parsed;
    } catch (err) {
      throw new CorruptSecretStoreError(err);
    }
  }

  function writeAll(all) {
    // Checked here rather than at construction: availability is an OS state
    // that can differ between app start and the moment of writing.
    if (!isEncryptionAvailable()) {
      throw new Error('OS encryption is unavailable, refusing to store a secret in the clear');
    }
    writeFile(encrypt(JSON.stringify(all)));
  }

  return {
    available: () => isEncryptionAvailable(),
    get(key) {
      return readAll()[key];
    },
    set(key, value) {
      const all = readAll();
      all[key] = value;
      writeAll(all);
    },
    remove(key) {
      const all = readAll();
      delete all[key];
      writeAll(all);
    },
    // Deliberately does NOT read first: reset is the recovery path for a store
    // that cannot be read at all.
    reset() {
      removeFile();
    },
  };
}

module.exports = { createSecretStore, CorruptSecretStoreError };
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run --config vitest.config.ts electron/secrets.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 6: Prove the encryption test discriminates**

Temporarily change `writeAll` to `writeFile(Buffer.from(JSON.stringify(all)))` — writing in the clear. Re-run. *"never writes a secret in the clear"* must FAIL. Restore and confirm all pass. Report the observed failure: a store that silently skipped encryption would pass every other test in the file.

- [ ] **Step 7: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
```

Expected: 1521 tests / 78 files (1509 + 12). Report the actual numbers.

```bash
git add electron/secrets.cjs electron/secrets.d.cts electron/secrets.test.ts
git commit -m "$(cat <<'EOF'
feat(calendar): add the encrypted secret store

One file, one encrypted JSON object, holding the user's OAuth client
credentials and later their refresh token. Every dependency is injected
so the module is exercised with no filesystem and no Electron.

An undecryptable blob throws a NAMED error rather than a parse failure,
because it is recoverable and the recovery is specific: reset the store
and reconnect. A Keychain reset or a restore onto another machine
produces exactly this, and a generic throw at boot would read as a
crash. reset() deliberately does not read first, so it works on a store
that cannot be read at all.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: PKCE

Small, pure, and the security foundation of the whole flow: the verifier never leaves main, and the challenge is what makes an intercepted authorization code useless.

**Files:**
- Create: `electron/pkce.cjs`, `electron/pkce.d.cts`
- Test: `electron/pkce.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  createPkce(randomBytes?: (n: number) => Buffer): Pkce
  interface Pkce { verifier: string; challenge: string; state: string }
  base64url(bytes: Buffer): string
  ```

- [ ] **Step 1: Write the failing test**

Create `electron/pkce.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createHash, randomBytes as realRandomBytes } from 'node:crypto';
import { createPkce, base64url } from './pkce.cjs';

describe('base64url', () => {
  it('uses the URL-safe alphabet and strips padding', () => {
    // 0xfb 0xff encodes to "+/8=" in standard base64.
    const encoded = base64url(Buffer.from([0xfb, 0xff, 0xfe]));
    expect(encoded).not.toMatch(/[+/=]/);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('round-trips through Node’s base64url decoder', () => {
    const bytes = Buffer.from([1, 2, 3, 250, 251, 255]);
    expect(Buffer.from(base64url(bytes), 'base64url')).toEqual(bytes);
  });
});

describe('createPkce', () => {
  it('derives the challenge as base64url(SHA-256(verifier))', () => {
    const { verifier, challenge } = createPkce();
    const expected = createHash('sha256').update(verifier).digest();
    expect(challenge).toBe(base64url(expected));
  });

  // S256 is what makes an intercepted code useless. A plain challenge — the
  // verifier echoed back — would pass a naive "challenge exists" assertion.
  it('does not send the verifier as the challenge', () => {
    const { verifier, challenge } = createPkce();
    expect(challenge).not.toBe(verifier);
  });

  it('produces a verifier in the RFC 7636 length range', () => {
    const { verifier } = createPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('produces URL-safe verifier, challenge and state', () => {
    const { verifier, challenge, state } = createPkce();
    for (const [name, value] of Object.entries({ verifier, challenge, state })) {
      expect(value, name).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('draws fresh randomness on every call', () => {
    const a = createPkce();
    const b = createPkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.state).not.toBe(b.state);
  });

  it('uses the injected randomness source', () => {
    const calls: number[] = [];
    const fake = (n: number) => { calls.push(n); return Buffer.alloc(n, 7); };
    const { verifier } = createPkce(fake);
    expect(calls.length).toBeGreaterThan(0);
    expect(verifier).toBe(base64url(Buffer.alloc(calls[0], 7)));
  });

  it('asks for at least 32 bytes of entropy for the verifier and 16 for the state', () => {
    const sizes: number[] = [];
    createPkce((n) => { sizes.push(n); return realRandomBytes(n); });
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(32);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run --config vitest.config.ts electron/pkce.test.ts
```

Expected: FAIL — cannot resolve `./pkce.cjs`.

- [ ] **Step 3: Write the contract**

Create `electron/pkce.d.cts`:

```ts
/** The contract for `pkce.cjs`. */

export interface Pkce {
  /** Never leaves the main process. Sent only to the token endpoint. */
  verifier: string;
  /** base64url(SHA-256(verifier)) — the S256 method. Sent to the consent URL. */
  challenge: string;
  /** CSRF guard; compared against the value the loopback listener receives. */
  state: string;
}

/** base64url per RFC 4648 §5: URL-safe alphabet, no padding. */
export declare function base64url(bytes: Buffer): string;

/**
 * A fresh PKCE triple.
 *
 * `randomBytes` is injectable for tests only; production uses
 * `node:crypto`'s CSPRNG and must never pass a substitute.
 */
export declare function createPkce(randomBytes?: (n: number) => Buffer): Pkce;
```

- [ ] **Step 4: Write the implementation**

Create `electron/pkce.cjs`:

```js
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
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run --config vitest.config.ts electron/pkce.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Prove the S256 test discriminates**

Temporarily set `const challenge = verifier;` — the "plain" method. Re-run. *"derives the challenge as base64url(SHA-256(verifier))"* and *"does not send the verifier as the challenge"* must both FAIL. Restore and confirm all pass. Report both observed failures.

- [ ] **Step 7: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
```

Expected: 1530 tests / 79 files (1521 + 9). Report the actual numbers.

```bash
git add electron/pkce.cjs electron/pkce.d.cts electron/pkce.test.ts
git commit -m "$(cat <<'EOF'
feat(calendar): generate the PKCE triple

The verifier never leaves the main process; only its SHA-256 challenge
reaches Google. That is what makes an intercepted authorization code
useless to whoever intercepted it, which matters here because a desktop
OAuth client's "secret" is not confidential and cannot carry that
weight on its own.

S256 only. The "plain" method sends the verifier as the challenge and
would satisfy a naive "a challenge exists" check while protecting
nothing, so a test pins the derivation rather than the presence.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The consent URL and the code exchange

The two halves of the authorization request that are pure string and HTTP work. The loopback listener that catches the redirect is Task 4; refresh and revoke are Task 5.

**Files:**
- Create: `electron/oauth.cjs`, `electron/oauth.d.cts`
- Test: `electron/oauth.test.ts`

**Interfaces:**
- Consumes: `createPkce`, `base64url` from `electron/pkce.cjs`.
- Produces:
  ```ts
  AUTH_ENDPOINT: string
  TOKEN_ENDPOINT: string
  REVOKE_ENDPOINT: string
  SCOPES: string[]
  authUrl(input: { clientId: string; redirectUri: string; challenge: string; state: string }): string
  createOAuth(deps: OAuthDeps): OAuth   // only `exchangeCode` exists after this task
  interface OAuthDeps { secrets; httpPost; createServer; openExternal; now; }
  ```
  `exchangeCode(input: { code: string; verifier: string; redirectUri: string }): Promise<{ refreshToken: string; accessToken: string; expiresAt: number }>`

- [ ] **Step 1: Write the failing test**

Create `electron/oauth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  authUrl, createOAuth, AUTH_ENDPOINT, TOKEN_ENDPOINT, SCOPES,
  type OAuthDeps,
} from './oauth.cjs';

const CLIENT = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'csecret' };

/** A secret store backed by a plain object — Task 1's module is not under test here. */
function fakeSecrets(seed: Record<string, unknown> = { client: CLIENT }) {
  const bag: Record<string, unknown> = { ...seed };
  return {
    available: () => true,
    get: (k: string) => bag[k],
    set: (k: string, v: unknown) => { bag[k] = v; },
    remove: (k: string) => { delete bag[k]; },
    reset: () => { for (const k of Object.keys(bag)) delete bag[k]; },
    _bag: bag,
  };
}

function deps(over: Partial<OAuthDeps> = {}): OAuthDeps & { _posts: Array<{ url: string; body: URLSearchParams }> } {
  const posts: Array<{ url: string; body: URLSearchParams }> = [];
  const base = {
    secrets: fakeSecrets(),
    httpPost: async (url: string, body: URLSearchParams) => {
      posts.push({ url, body });
      return { ok: true, status: 200, json: { refresh_token: 'REFRESH', access_token: 'ACCESS', expires_in: 3599 } };
    },
    createServer: () => { throw new Error('not used in this task'); },
    openExternal: async () => {},
    now: () => 1_000_000,
    ...over,
  } satisfies OAuthDeps;
  return Object.assign(base, { _posts: posts });
}

describe('authUrl', () => {
  const url = () => new URL(authUrl({
    clientId: CLIENT.clientId, redirectUri: 'http://127.0.0.1:51234/callback',
    challenge: 'CHALLENGE', state: 'STATE',
  }));

  it('points at Google’s consent endpoint', () => {
    expect(authUrl({ clientId: 'c', redirectUri: 'r', challenge: 'x', state: 's' }))
      .toContain(AUTH_ENDPOINT);
  });

  it('requests exactly the two read-only scopes, and no broader one', () => {
    const scope = url().searchParams.get('scope')!.split(' ');
    expect(scope.sort()).toEqual([...SCOPES].sort());
    expect(scope).toContain('https://www.googleapis.com/auth/calendar.events.readonly');
    expect(scope).toContain('https://www.googleapis.com/auth/calendar.calendarlist.readonly');
    // The broad scope grants write access we never want.
    expect(scope).not.toContain('https://www.googleapis.com/auth/calendar');
  });

  it('uses the S256 challenge method, never plain', () => {
    expect(url().searchParams.get('code_challenge_method')).toBe('S256');
    expect(url().searchParams.get('code_challenge')).toBe('CHALLENGE');
  });

  it('carries the state and the loopback redirect', () => {
    expect(url().searchParams.get('state')).toBe('STATE');
    expect(url().searchParams.get('redirect_uri')).toBe('http://127.0.0.1:51234/callback');
  });

  // Without these two Google returns no refresh token on a repeat consent,
  // and the connection silently dies an hour later.
  it('asks for offline access and forces the consent screen', () => {
    expect(url().searchParams.get('access_type')).toBe('offline');
    expect(url().searchParams.get('prompt')).toBe('consent');
  });

  it('requests an authorization code', () => {
    expect(url().searchParams.get('response_type')).toBe('code');
  });

  it('percent-encodes values rather than concatenating them raw', () => {
    const raw = authUrl({ clientId: 'a b&c', redirectUri: 'http://127.0.0.1:1/cb', challenge: 'x', state: 's' });
    expect(raw).not.toContain('a b&c');
    expect(new URL(raw).searchParams.get('client_id')).toBe('a b&c');
  });
});

describe('exchangeCode', () => {
  it('posts to the token endpoint with the verifier, not the challenge', async () => {
    const d = deps();
    await createOAuth(d).exchangeCode({ code: 'CODE', verifier: 'VERIFIER', redirectUri: 'http://127.0.0.1:1/cb' });
    expect(d._posts).toHaveLength(1);
    expect(d._posts[0].url).toBe(TOKEN_ENDPOINT);
    expect(d._posts[0].body.get('code_verifier')).toBe('VERIFIER');
    expect(d._posts[0].body.get('grant_type')).toBe('authorization_code');
    expect(d._posts[0].body.get('code')).toBe('CODE');
    expect(d._posts[0].body.get('redirect_uri')).toBe('http://127.0.0.1:1/cb');
  });

  it('sends the stored client credentials', async () => {
    const d = deps();
    await createOAuth(d).exchangeCode({ code: 'C', verifier: 'V', redirectUri: 'r' });
    expect(d._posts[0].body.get('client_id')).toBe(CLIENT.clientId);
    expect(d._posts[0].body.get('client_secret')).toBe(CLIENT.clientSecret);
  });

  it('returns the tokens with an absolute expiry derived from the injected clock', async () => {
    const d = deps({ now: () => 5_000_000 });
    const out = await createOAuth(d).exchangeCode({ code: 'C', verifier: 'V', redirectUri: 'r' });
    expect(out.refreshToken).toBe('REFRESH');
    expect(out.accessToken).toBe('ACCESS');
    expect(out.expiresAt).toBe(5_000_000 + 3599 * 1000);
  });

  it('fails when the client credentials are not configured', async () => {
    const d = deps({ secrets: fakeSecrets({}) });
    await expect(createOAuth(d).exchangeCode({ code: 'C', verifier: 'V', redirectUri: 'r' }))
      .rejects.toThrow(/not configured/i);
  });

  // Google returns a refresh token only when it feels like it. Treating its
  // absence as success would leave a connection that dies within the hour.
  it('fails when Google returns no refresh token', async () => {
    const d = deps({
      httpPost: async () => ({ ok: true, status: 200, json: { access_token: 'A', expires_in: 3599 } }),
    });
    await expect(createOAuth(d).exchangeCode({ code: 'C', verifier: 'V', redirectUri: 'r' }))
      .rejects.toThrow(/refresh token/i);
  });

  it('fails when Google returns no access token', async () => {
    const d = deps({
      httpPost: async () => ({ ok: true, status: 200, json: { refresh_token: 'R', expires_in: 3599 } }),
    });
    await expect(createOAuth(d).exchangeCode({ code: 'C', verifier: 'V', redirectUri: 'r' }))
      .rejects.toThrow(/incomplete token response/i);
  });

  it('fails when Google omits expires_in', async () => {
    const d = deps({
      httpPost: async () => ({ ok: true, status: 200, json: { refresh_token: 'R', access_token: 'A' } }),
    });
    await expect(createOAuth(d).exchangeCode({ code: 'C', verifier: 'V', redirectUri: 'r' }))
      .rejects.toThrow(/incomplete token response/i);
  });

  it.each([
    ['both fields', { error: 'invalid_grant', error_description: 'Bad code' }, 'invalid_grant — Bad code'],
    ['code only', { error: 'invalid_grant' }, 'invalid_grant'],
    ['description only', { error_description: 'Bad code' }, 'Bad code'],
    ['an empty code', { error: '', error_description: 'Bad code' }, 'Bad code'],
    ['nothing at all', {}, 'HTTP 503'],
  ])('reports %s', async (_label, json, expected) => {
    const d = deps({ httpPost: async () => ({ ok: false, status: 503, json }) });
    const rejection = createOAuth(d).exchangeCode({ code: 'C', verifier: 'V', redirectUri: 'r' });
    await expect(rejection).rejects.toThrow(expected);
    await expect(rejection).rejects.not.toThrow(CLIENT.clientSecret);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run --config vitest.config.ts electron/oauth.test.ts
```

Expected: FAIL — cannot resolve `./oauth.cjs`.

- [ ] **Step 3: Write the contract**

Create `electron/oauth.d.cts`:

```ts
/** The contract for `oauth.cjs`. */
import type { SecretStore } from './secrets.d.cts';

export interface HttpResponse {
  ok: boolean;
  status: number;
  json?: Record<string, unknown>;
}

/** A one-shot loopback HTTP listener. See Task 4. */
export interface LoopbackServer {
  /** Resolves with the port actually bound. */
  listen(): Promise<number>;
  close(): void;
  /** Called with the request path+query of every inbound request. */
  onRequest(handler: (url: string, respond: (status: number, body: string) => void) => void): void;
}

export interface OAuthDeps {
  secrets: SecretStore;
  httpPost(url: string, body: URLSearchParams): Promise<HttpResponse>;
  createServer(): LoopbackServer;
  openExternal(url: string): Promise<void>;
  /** Injected clock — the module never reads the real one. */
  now(): number;
}

export interface Tokens {
  refreshToken: string;
  accessToken: string;
  /** Absolute epoch-ms expiry, derived from `now()` + `expires_in`. */
  expiresAt: number;
}

export interface OAuth {
  exchangeCode(input: { code: string; verifier: string; redirectUri: string }): Promise<Tokens>;
}

export declare const AUTH_ENDPOINT: string;
export declare const TOKEN_ENDPOINT: string;
export declare const REVOKE_ENDPOINT: string;
/**
 * Exactly two read-only scopes. `events.readonly` alone does NOT authorize
 * `calendarList.list`, and the broader `calendar.readonly` grants more than
 * this feature needs.
 */
export declare const SCOPES: readonly string[];

export declare function authUrl(input: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string;

export declare function createOAuth(deps: OAuthDeps): OAuth;
```

- [ ] **Step 4: Write the implementation**

Create `electron/oauth.cjs`:

```js
// The installed-app OAuth flow, entirely in the main process.
//
// Every dependency is injected — HTTP, the loopback server, the browser
// opener, the clock — so the whole flow is exercised offline with no mock
// server. Contract in oauth.d.cts.

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

// `events.readonly` alone does not authorize calendarList.list, and the
// broader `calendar.readonly` grants more than this feature requires.
const SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
]);

function authUrl({ clientId, redirectUri, challenge, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    // Without offline+consent Google withholds the refresh token on a repeat
    // authorization, and the connection dies silently when the access token
    // expires an hour later.
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Google's `error` is what you triage from; `error_description` is what you read. Keep both. */
function tokenErrorDetail(res) {
  const code = res.json?.error;
  const description = res.json?.error_description;
  return [code, description].filter(Boolean).join(' — ') || `HTTP ${res.status}`;
}

function createOAuth(deps) {
  const { secrets, httpPost, now } = deps;

  function client() {
    const stored = secrets.get('client');
    if (!stored || !stored.clientId || !stored.clientSecret) {
      throw new Error('Google client credentials are not configured');
    }
    return stored;
  }

  async function postForTokens(body) {
    const res = await httpPost(TOKEN_ENDPOINT, body);
    if (!res.ok) {
      throw new Error(`Google token request failed: ${tokenErrorDetail(res)}`);
    }
    return res.json;
  }

  async function exchangeCode({ code, verifier, redirectUri }) {
    const { clientId, clientSecret } = client();
    const json = await postForTokens(new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }));
    // Google returns a refresh token only on the first consent, or when
    // prompt=consent forces one. Accepting its absence would leave a
    // connection that stops working within the hour with no way to renew.
    if (!json.refresh_token) {
      throw new Error('Google returned no refresh token; re-run consent with prompt=consent');
    }
    // A missing access token fails Task 5's truthy cache check; a NaN expiry
    // makes its time comparison false, so either malformed record refreshes
    // on every call instead of being reused.
    if (!json.access_token || !Number.isFinite(Number(json.expires_in))) {
      throw new Error('Google returned an incomplete token response');
    }
    return {
      refreshToken: json.refresh_token,
      accessToken: json.access_token,
      expiresAt: now() + Number(json.expires_in) * 1000,
    };
  }

  return { exchangeCode };
}

module.exports = { AUTH_ENDPOINT, TOKEN_ENDPOINT, REVOKE_ENDPOINT, SCOPES, authUrl, createOAuth };
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run --config vitest.config.ts electron/oauth.test.ts
```

Expected: PASS, 19 tests.

- [ ] **Step 6: Prove the scope and refresh-token tests discriminate**

Two mutations, each run and restored:

1. Add `'https://www.googleapis.com/auth/calendar'` to `SCOPES`. *"requests exactly the two read-only scopes"* must FAIL. This is the one that would silently grant write access to a user's calendar.
2. Change the refresh-token guard to `if (false)`. *"fails when Google returns no refresh token"* must FAIL.

Report both observed failures.

- [ ] **Step 7: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
```

Expected: 1549 tests / 80 files (1530 + 19). Report the actual numbers.

```bash
git add electron/oauth.cjs electron/oauth.d.cts electron/oauth.test.ts
git commit -m "$(cat <<'EOF'
feat(calendar): build the consent URL and exchange the code

Two read-only scopes and no broader one: events.readonly alone does not
authorize calendarList.list, and calendar.readonly would grant write
access this feature never wants. A test pins the exact set rather than
asserting the two are present, so an added scope fails the build.

access_type=offline with prompt=consent, because Google withholds the
refresh token on a repeat authorization otherwise and the connection
would die silently an hour later. Its absence in the response is an
error rather than a shrug, for the same reason.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The loopback listener

Google redirects the browser back to `127.0.0.1` on a random port. This is where that redirect is caught. Two requirements from the spec are security properties, not tidiness: **the flow times out**, and **the listener is shut down on every outcome** — success, error, state mismatch, timeout, and denial. A leaked listening socket is a defect.

**Files:**
- Modify: `electron/oauth.cjs`, `electron/oauth.d.cts`
- Test: `electron/oauth.test.ts`

**Interfaces:**
- Consumes: `OAuthDeps` from Task 3, plus a new `setTimer` member.
- Produces: `listenForCode(input: { state: string; timeoutMs?: number; onReady(redirectUri: string): void | Promise<void> }): Promise<string>` on the `OAuth` object, resolving with the authorization code. Also exports `CALLBACK_PATH` and `DEFAULT_TIMEOUT_MS`.
- `OAuthDeps` gains `setTimer(fn: () => void, ms: number): () => void` — returns a cancel function. Injected rather than using `setTimeout` so the timeout is testable without fake timers.

- [ ] **Step 1: Write the failing test**

Append to `electron/oauth.test.ts`, and extend the import at the top to add `CALLBACK_PATH` and `DEFAULT_TIMEOUT_MS`:

```ts
/**
 * A fake loopback server. `hit(path)` plays the role of the browser
 * arriving on the redirect; `closed` and `listening` let a test assert the
 * socket's lifecycle, which is the security property this task exists for.
 */
function fakeServer(port = 51234) {
  const s = {
    port,
    listening: false,
    closed: false,
    handler: null as null | ((url: string, respond: (status: number, body: string) => void) => void),
    responses: [] as Array<{ status: number; body: string }>,
    listen: async () => { s.listening = true; return port; },
    close: () => { s.listening = false; s.closed = true; },
    onRequest: (h: typeof s.handler) => { s.handler = h; },
    hit(url: string) {
      s.handler!(url, (status, body) => s.responses.push({ status, body }));
    },
  };
  return s;
}

function loopbackDeps(server: ReturnType<typeof fakeServer>, over: Partial<OAuthDeps> = {}) {
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  const d = deps({
    createServer: () => server,
    setTimer: (fn: () => void, ms: number) => {
      const entry = { fn, ms, cancelled: false };
      timers.push(entry);
      return () => { entry.cancelled = true; };
    },
    ...over,
  });
  return Object.assign(d, { _timers: timers });
}

describe('listenForCode', () => {
  it('reports the redirect URI with the bound port before opening the browser', async () => {
    const server = fakeServer(51999);
    const d = loopbackDeps(server);
    const seen: string[] = [];
    const pending = createOAuth(d).listenForCode({
      state: 'S', onReady: (uri) => { seen.push(uri); server.hit(`${CALLBACK_PATH}?code=C&state=S`); },
    });
    await expect(pending).resolves.toBe('C');
    expect(seen).toEqual([`http://127.0.0.1:51999${CALLBACK_PATH}`]);
  });

  it('resolves with the code and closes the socket', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    await expect(createOAuth(d).listenForCode({
      state: 'S', onReady: () => server.hit(`${CALLBACK_PATH}?code=CODE&state=S`),
    })).resolves.toBe('CODE');
    expect(server.closed).toBe(true);
    expect(server.listening).toBe(false);
  });

  it('shows the user something readable in the browser on success', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    await createOAuth(d).listenForCode({
      state: 'S', onReady: () => server.hit(`${CALLBACK_PATH}?code=C&state=S`),
    });
    expect(server.responses[0].status).toBe(200);
    expect(server.responses[0].body).toMatch(/Phase/i);
  });

  // The CSRF guard. Accepting a mismatched state would let any page that can
  // reach the loopback port inject an authorization code.
  it('rejects a state mismatch and still closes the socket', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    await expect(createOAuth(d).listenForCode({
      state: 'EXPECTED', onReady: () => server.hit(`${CALLBACK_PATH}?code=C&state=ATTACKER`),
    })).rejects.toThrow(/state/i);
    expect(server.closed).toBe(true);
    expect(server.responses[0].status).toBe(400);
  });

  it('404s any other path and keeps waiting for the real one', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    const pending = createOAuth(d).listenForCode({
      state: 'S',
      onReady: () => {
        server.hit('/');
        server.hit('/favicon.ico');
        server.hit(`${CALLBACK_PATH}/extra?code=C&state=S`);
        server.hit(`${CALLBACK_PATH}?code=REAL&state=S`);
      },
    });
    await expect(pending).resolves.toBe('REAL');
    expect(server.responses.slice(0, 3).map((r) => r.status)).toEqual([404, 404, 404]);
  });

  it('rejects when the user denies consent', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    await expect(createOAuth(d).listenForCode({
      state: 'S', onReady: () => server.hit(`${CALLBACK_PATH}?error=access_denied&state=S`),
    })).rejects.toThrow(/access_denied/);
    expect(server.closed).toBe(true);
  });

  it('rejects when the callback carries neither a code nor an error', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    await expect(createOAuth(d).listenForCode({
      state: 'S', onReady: () => server.hit(`${CALLBACK_PATH}?state=S`),
    })).rejects.toThrow(/no authorization code/i);
    expect(server.closed).toBe(true);
  });

  // Without this the socket stays open forever when the user closes the
  // consent tab and walks away.
  it('times out and closes the socket', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    const pending = createOAuth(d).listenForCode({ state: 'S', timeoutMs: 5000, onReady: () => {} });
    expect(d._timers[0].ms).toBe(5000);
    d._timers[0].fn();
    await expect(pending).rejects.toThrow(/timed out/i);
    expect(server.closed).toBe(true);
  });

  it('defaults the timeout rather than waiting forever', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    const pending = createOAuth(d).listenForCode({ state: 'S', onReady: () => {} });
    expect(d._timers[0].ms).toBe(DEFAULT_TIMEOUT_MS);
    d._timers[0].fn();
    await expect(pending).rejects.toThrow(/timed out/i);
  });

  it('cancels the timeout once the code arrives', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    await createOAuth(d).listenForCode({
      state: 'S', onReady: () => server.hit(`${CALLBACK_PATH}?code=C&state=S`),
    });
    expect(d._timers[0].cancelled).toBe(true);
  });

  it('closes the socket when onReady itself throws', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    await expect(createOAuth(d).listenForCode({
      state: 'S', onReady: () => { throw new Error('browser would not open'); },
    })).rejects.toThrow(/browser would not open/);
    expect(server.closed).toBe(true);
  });

  it('ignores a second callback after the first has settled', async () => {
    const server = fakeServer();
    const d = loopbackDeps(server);
    const pending = createOAuth(d).listenForCode({
      state: 'S',
      onReady: () => {
        server.hit(`${CALLBACK_PATH}?code=FIRST&state=S`);
        server.hit(`${CALLBACK_PATH}?code=SECOND&state=S`);
      },
    });
    await expect(pending).resolves.toBe('FIRST');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run --config vitest.config.ts electron/oauth.test.ts
```

Expected: FAIL — `listenForCode is not a function`, 12 failures, the 19 Task 3 tests still passing.

- [ ] **Step 3: Extend the contract**

In `electron/oauth.d.cts`, add `setTimer` to `OAuthDeps`:

```ts
  /**
   * Injected so the consent timeout is testable without fake timers.
   * Returns a cancel function.
   */
  setTimer(fn: () => void, ms: number): () => void;
```

and add to the `OAuth` interface plus the exports:

```ts
  /**
   * Start the one-shot loopback listener and resolve with the authorization
   * code.
   *
   * `onReady` is called once the port is bound, with the redirect URI the
   * caller must put in the consent URL — the port is chosen by the OS, so it
   * cannot be known before listening.
   *
   * The socket is closed on EVERY outcome: success, state mismatch, denial,
   * malformed callback, timeout, and an `onReady` that throws. A leaked
   * listening socket is a security defect.
   */
  listenForCode(input: {
    state: string;
    timeoutMs?: number;
    onReady(redirectUri: string): void | Promise<void>;
  }): Promise<string>;
```

```ts
/** The only path the listener accepts. Everything else 404s. */
export declare const CALLBACK_PATH: string;
export declare const DEFAULT_TIMEOUT_MS: number;
```

- [ ] **Step 4: Write the implementation**

In `electron/oauth.cjs`, add near the other constants:

```js
const CALLBACK_PATH = '/callback';
const DEFAULT_TIMEOUT_MS = 120_000;

const SUCCESS_PAGE = '<!doctype html><meta charset="utf-8"><title>Phase</title>'
  + '<body style="font:16px system-ui;padding:3rem"><p>Phase is connected. You can close this tab.</p>';
```

Add `createServer` and `setTimer` to the destructured deps, and add this method to the returned object:

```js
  function listenForCode({ state, timeoutMs = DEFAULT_TIMEOUT_MS, onReady }) {
    const server = createServer();
    return new Promise((resolve, reject) => {
      let settled = false;
      let cancelTimer = () => {};

      // Every exit runs through here, so there is exactly one place that can
      // forget to close the socket — and it does not.
      function settle(fn, value) {
        if (settled) return;
        settled = true;
        cancelTimer();
        server.close();
        fn(value);
      }

      server.onRequest((url, respond) => {
        // `url` is path + query. Only the exact path is accepted; a prefix
        // match would let /callback/anything through.
        const parsed = new URL(url, 'http://127.0.0.1');
        if (parsed.pathname !== CALLBACK_PATH) {
          respond(404, 'Not found');
          return;
        }
        const error = parsed.searchParams.get('error');
        if (error) {
          respond(400, 'Authorization failed. You can close this tab.');
          settle(reject, new Error(`Google authorization failed: ${error}`));
          return;
        }
        // Compared before the code is used at all: a mismatched state means
        // this response is not the one we asked for.
        if (parsed.searchParams.get('state') !== state) {
          respond(400, 'Authorization failed. You can close this tab.');
          settle(reject, new Error('Authorization state did not match; aborting'));
          return;
        }
        const code = parsed.searchParams.get('code');
        if (!code) {
          respond(400, 'Authorization failed. You can close this tab.');
          settle(reject, new Error('Callback carried no authorization code'));
          return;
        }
        respond(200, SUCCESS_PAGE);
        settle(resolve, code);
      });

      cancelTimer = setTimer(() => {
        settle(reject, new Error('Authorization timed out; no response from the browser'));
      }, timeoutMs);

      Promise.resolve()
        .then(() => server.listen())
        .then((port) => onReady(`http://127.0.0.1:${port}${CALLBACK_PATH}`))
        .catch((err) => settle(reject, err));
    });
  }
```

Return `listenForCode` alongside `exchangeCode`, and add `CALLBACK_PATH` / `DEFAULT_TIMEOUT_MS` to `module.exports`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run --config vitest.config.ts electron/oauth.test.ts
```

Expected: PASS, 31 tests.

- [ ] **Step 6: Prove the security tests discriminate**

Three mutations, each run and restored, reporting the observed failure:

1. Delete the state comparison (accept any state). *"rejects a state mismatch"* must FAIL.
2. Change the path check to `parsed.pathname.startsWith(CALLBACK_PATH)`. *"404s any other path and keeps waiting"* must FAIL — a prefix match accepts `/callback/extra`.
3. Remove `server.close()` from `settle`. Several lifecycle assertions must FAIL, including the timeout one. Name which.

Each of these is a real defect that ships silently: an accepted code from the wrong flow, an over-broad path match, and a socket left listening.

- [ ] **Step 7: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
```

Expected: 1561 tests / 80 files (1549 + 12). Report the actual numbers.

```bash
git add electron/oauth.cjs electron/oauth.d.cts electron/oauth.test.ts
git commit -m "$(cat <<'EOF'
feat(calendar): catch the consent redirect on a loopback socket

One exit path closes the socket, so there is exactly one place that
could forget to — success, state mismatch, denial, malformed callback,
timeout, and a browser that will not open all run through it. A leaked
listening socket is a security defect, not untidiness.

The path is matched exactly rather than by prefix, and the state is
compared before the code is read at all: a mismatch means this response
is not the one we asked for, so there is nothing to salvage from it.

The flow times out. Without that, closing the consent tab and walking
away leaves the port open indefinitely.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Refresh, revoke, and connect

The lifecycle around the tokens. Two error types matter downstream: spec §10 renders "not connected" and "refresh token expired or revoked" differently, so they cannot both be a bare `Error`.

**Files:**
- Modify: `electron/oauth.cjs`, `electron/oauth.d.cts`
- Test: `electron/oauth.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–4.
- Produces, on the `OAuth` object:
  ```ts
  connect(): Promise<void>              // full flow; stores the token
  disconnect(): Promise<void>           // revoke, then forget
  getAccessToken(): Promise<string>     // refreshing when stale
  isConnected(): boolean
  ```
  Plus exported `class NotConnectedError extends Error` and `class ReauthRequiredError extends Error`, and `REFRESH_SKEW_MS`.
- `OAuthDeps` gains `createPkce(): Pkce` (injected so `connect` is deterministic in tests).

- [ ] **Step 1: Write the failing test**

Append to `electron/oauth.test.ts`, extending the top import with `NotConnectedError`, `ReauthRequiredError`, `REFRESH_SKEW_MS`, `REVOKE_ENDPOINT`, `authUrl`:

```ts
const TOKEN = { refreshToken: 'R', accessToken: 'A', expiresAt: 2_000_000 };

describe('getAccessToken', () => {
  it('reuses a token that is still comfortably valid', async () => {
    const d = deps({ secrets: fakeSecrets({ client: CLIENT, token: TOKEN }), now: () => 1_000_000 });
    expect(await createOAuth(d).getAccessToken()).toBe('A');
    expect(d._posts).toHaveLength(0);
  });

  it('refreshes once the token has expired', async () => {
    const d = deps({
      secrets: fakeSecrets({ client: CLIENT, token: TOKEN }),
      now: () => 3_000_000,
      httpPost: async () => ({ ok: true, status: 200, json: { access_token: 'FRESH', expires_in: 3599 } }),
    });
    expect(await createOAuth(d).getAccessToken()).toBe('FRESH');
    expect(d._posts[0].body.get('grant_type')).toBe('refresh_token');
    expect(d._posts[0].body.get('refresh_token')).toBe('R');
  });

  // Without the skew, a token that expires mid-flight produces a 401 on a
  // request that had a valid token when it was chosen.
  it('refreshes early, inside the skew window', async () => {
    const d = deps({
      secrets: fakeSecrets({ client: CLIENT, token: TOKEN }),
      now: () => TOKEN.expiresAt - REFRESH_SKEW_MS + 1,
      httpPost: async () => ({ ok: true, status: 200, json: { access_token: 'FRESH', expires_in: 3599 } }),
    });
    expect(await createOAuth(d).getAccessToken()).toBe('FRESH');
  });

  // Google does not return the refresh token again on a refresh. Overwriting
  // the stored record wholesale would drop it and silently disconnect.
  it('keeps the refresh token across a refresh', async () => {
    const secrets = fakeSecrets({ client: CLIENT, token: TOKEN });
    const d = deps({
      secrets, now: () => 3_000_000,
      httpPost: async () => ({ ok: true, status: 200, json: { access_token: 'FRESH', expires_in: 3599 } }),
    });
    await createOAuth(d).getAccessToken();
    expect((secrets._bag.token as typeof TOKEN).refreshToken).toBe('R');
    expect((secrets._bag.token as typeof TOKEN).accessToken).toBe('FRESH');
    expect((secrets._bag.token as typeof TOKEN).expiresAt).toBe(3_000_000 + 3599 * 1000);
  });

  it('throws NotConnectedError when there is no stored token', async () => {
    const d = deps({ secrets: fakeSecrets({ client: CLIENT }) });
    await expect(createOAuth(d).getAccessToken()).rejects.toThrow(NotConnectedError);
  });

  // Distinct from NotConnectedError because spec §10 renders them
  // differently: one offers "Connect", the other keeps the cached blocks and
  // prompts to re-connect.
  it('throws ReauthRequiredError when the refresh token has been revoked', async () => {
    const d = deps({
      secrets: fakeSecrets({ client: CLIENT, token: TOKEN }), now: () => 3_000_000,
      httpPost: async () => ({ ok: false, status: 400, json: { error: 'invalid_grant' } }),
    });
    await expect(createOAuth(d).getAccessToken()).rejects.toThrow(ReauthRequiredError);
  });

  it('does not turn an ordinary network failure into a reauth prompt', async () => {
    const d = deps({
      secrets: fakeSecrets({ client: CLIENT, token: TOKEN }), now: () => 3_000_000,
      httpPost: async () => ({ ok: false, status: 503, json: { error: 'backendError' } }),
    });
    const err = await createOAuth(d).getAccessToken().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ReauthRequiredError);
  });
});

describe('isConnected', () => {
  it('is false with no token and true with one', () => {
    expect(createOAuth(deps({ secrets: fakeSecrets({ client: CLIENT }) })).isConnected()).toBe(false);
    expect(createOAuth(deps({ secrets: fakeSecrets({ client: CLIENT, token: TOKEN }) })).isConnected()).toBe(true);
  });
});

describe('disconnect', () => {
  it('revokes the refresh token with Google and forgets it', async () => {
    const secrets = fakeSecrets({ client: CLIENT, token: TOKEN });
    const d = deps({ secrets });
    await createOAuth(d).disconnect();
    expect(d._posts[0].url).toBe(REVOKE_ENDPOINT);
    expect(d._posts[0].body.get('token')).toBe('R');
    expect(secrets._bag.token).toBeUndefined();
  });

  // Otherwise you can never disconnect while offline, and the credential
  // stays on disk exactly when the user is trying to remove it.
  it('forgets the token even when the revoke call fails', async () => {
    const secrets = fakeSecrets({ client: CLIENT, token: TOKEN });
    const d = deps({ secrets, httpPost: async () => { throw new Error('offline'); } });
    await expect(createOAuth(d).disconnect()).resolves.toBeUndefined();
    expect(secrets._bag.token).toBeUndefined();
  });

  it('is harmless when nothing is connected', async () => {
    const d = deps({ secrets: fakeSecrets({ client: CLIENT }) });
    await expect(createOAuth(d).disconnect()).resolves.toBeUndefined();
    expect(d._posts).toHaveLength(0);
  });
});

describe('connect', () => {
  function connectDeps() {
    const server = fakeServer(51500);
    const secrets = fakeSecrets({ client: CLIENT });
    const opened: string[] = [];
    const d = loopbackDeps(server, {
      secrets,
      createPkce: () => ({ verifier: 'V', challenge: 'CH', state: 'ST' }),
      openExternal: async (url: string) => {
        opened.push(url);
        server.hit(`${CALLBACK_PATH}?code=CODE&state=ST`);
      },
    });
    return { d, server, secrets, opened };
  }

  it('opens the consent URL built from the PKCE challenge and the bound port', async () => {
    const { d, opened } = connectDeps();
    await createOAuth(d).connect();
    const url = new URL(opened[0]);
    expect(url.searchParams.get('code_challenge')).toBe('CH');
    expect(url.searchParams.get('state')).toBe('ST');
    expect(url.searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:51500${CALLBACK_PATH}`);
  });

  it('exchanges the code with the verifier and stores the token', async () => {
    const { d, secrets } = connectDeps();
    await createOAuth(d).connect();
    const exchange = d._posts.find((p) => p.body.get('grant_type') === 'authorization_code')!;
    expect(exchange.body.get('code_verifier')).toBe('V');
    expect((secrets._bag.token as typeof TOKEN).refreshToken).toBe('REFRESH');
  });

  it('stores nothing when the exchange fails', async () => {
    const { d, secrets } = connectDeps();
    d.httpPost = async () => ({ ok: false, status: 400, json: { error: 'invalid_grant' } });
    await expect(createOAuth(d).connect()).rejects.toThrow(/invalid_grant/);
    expect(secrets._bag.token).toBeUndefined();
  });

  it('refuses before the client credentials are configured', async () => {
    const { d } = connectDeps();
    d.secrets = fakeSecrets({});
    await expect(createOAuth(d).connect()).rejects.toThrow(/not configured/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run --config vitest.config.ts electron/oauth.test.ts
```

Expected: FAIL — `getAccessToken is not a function` and friends; the 31 earlier tests still pass.

- [ ] **Step 3: Extend the contract**

In `electron/oauth.d.cts` add to `OAuthDeps`:

```ts
  /** Injected so `connect` is deterministic under test. */
  createPkce(): { verifier: string; challenge: string; state: string };
```

and to `OAuth`:

```ts
  /** Full flow: PKCE, loopback, consent, exchange, store. */
  connect(): Promise<void>;
  /** Revoke with Google, then forget the token locally. */
  disconnect(): Promise<void>;
  /** A valid access token, refreshing when stale. */
  getAccessToken(): Promise<string>;
  isConnected(): boolean;
```

plus the exports:

```ts
/** No token stored at all — offer "Connect". */
export declare class NotConnectedError extends Error {}
/** The refresh token was rejected — keep cached blocks, prompt to re-connect. */
export declare class ReauthRequiredError extends Error {}
/** Refresh this far before nominal expiry, so a request cannot expire mid-flight. */
export declare const REFRESH_SKEW_MS: number;
```

- [ ] **Step 4: Write the implementation**

In `electron/oauth.cjs`, add the error classes and constant near the top:

```js
class NotConnectedError extends Error {
  constructor() { super('Google Calendar is not connected'); this.name = 'NotConnectedError'; }
}
class ReauthRequiredError extends Error {
  constructor() { super('Google rejected the stored credential; reconnect required'); this.name = 'ReauthRequiredError'; }
}

const REFRESH_SKEW_MS = 60_000;
```

Add `openExternal` and `createPkce` to the destructured deps, and these methods to the returned object:

```js
  function storedToken() {
    const token = secrets.get('token');
    return token && token.refreshToken ? token : null;
  }

  async function getAccessToken() {
    const token = storedToken();
    if (!token) throw new NotConnectedError();
    // Refresh a minute early: a token that expires mid-flight produces a 401
    // on a request that held a valid token when it was chosen.
    if (token.accessToken && now() < token.expiresAt - REFRESH_SKEW_MS) return token.accessToken;

    const { clientId, clientSecret } = client();
    const res = await httpPost(TOKEN_ENDPOINT, new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: token.refreshToken,
      grant_type: 'refresh_token',
    }));
    if (!res.ok) {
      // invalid_grant means revoked or expired — a DIFFERENT user-facing
      // state from "never connected", per spec §10. Anything else (503,
      // offline) is transient and must not prompt for reauth.
      if (res.json?.error === 'invalid_grant') throw new ReauthRequiredError();
      throw new Error(`Google token refresh failed: ${tokenErrorDetail(res)}`);
    }
    // Google does not return the refresh token again. Spreading the previous
    // record forward is what stops a refresh from silently disconnecting.
    const next = {
      refreshToken: token.refreshToken,
      accessToken: res.json.access_token,
      expiresAt: now() + Number(res.json.expires_in) * 1000,
    };
    secrets.set('token', next);
    return next.accessToken;
  }

  async function connect() {
    client(); // fail before opening a browser if unconfigured
    const pkce = createPkce();
    const code = await listenForCode({
      state: pkce.state,
      onReady: (redirectUri) => openExternal(authUrl({
        clientId: client().clientId,
        redirectUri,
        challenge: pkce.challenge,
        state: pkce.state,
      })),
    });
    // The redirect URI must match the one the code was issued against.
    const redirectUri = lastRedirectUri;
    const tokens = await exchangeCode({ code, verifier: pkce.verifier, redirectUri });
    secrets.set('token', tokens);
  }

  async function disconnect() {
    const token = storedToken();
    if (!token) return;
    try {
      await httpPost(REVOKE_ENDPOINT, new URLSearchParams({ token: token.refreshToken }));
    } catch {
      // Deliberately swallowed: otherwise you could never disconnect while
      // offline, and the credential would stay on disk at exactly the moment
      // the user is asking to remove it. Local removal is what matters.
    }
    secrets.remove('token');
  }

  function isConnected() { return storedToken() !== null; }
```

`connect` needs the redirect URI that `listenForCode` bound. Capture it rather than recomputing: declare `let lastRedirectUri = null;` inside `createOAuth`, and in `listenForCode`'s `onReady` chain set it before calling the caller's `onReady`:

```js
        .then((port) => {
          lastRedirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
          return onReady(lastRedirectUri);
        })
```

Return `connect`, `disconnect`, `getAccessToken`, `isConnected` alongside the earlier methods, and add `NotConnectedError`, `ReauthRequiredError`, `REFRESH_SKEW_MS` to `module.exports`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run --config vitest.config.ts electron/oauth.test.ts
```

Expected: PASS, 49 tests.

- [ ] **Step 6: Prove three tests discriminate**

Each mutation run and restored, reporting the observed failure:

1. Replace `refreshToken: token.refreshToken` in `next` with `refreshToken: res.json.refresh_token`. *"keeps the refresh token across a refresh"* must FAIL. This is the bug that disconnects a working integration after an hour.
2. Change the `invalid_grant` branch to throw a plain `Error`. *"throws ReauthRequiredError when the refresh token has been revoked"* must FAIL.
3. Move `secrets.remove('token')` inside the `try`. *"forgets the token even when the revoke call fails"* must FAIL.

- [ ] **Step 7: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
```

Expected: 1579 tests / 80 files (1561 + 18). Report the actual numbers.

```bash
git add electron/oauth.cjs electron/oauth.d.cts electron/oauth.test.ts
git commit -m "$(cat <<'EOF'
feat(calendar): refresh, revoke, and connect

Google does not return the refresh token again on a refresh, so the
stored record is carried forward rather than replaced — overwriting it
wholesale drops the refresh token and disconnects a working
integration about an hour later, which is the kind of failure nobody
attributes to the refresh.

invalid_grant gets its own error type. Spec 10 renders "never
connected" and "credential revoked" differently, and a 503 must not
prompt anyone to reconnect.

Disconnect forgets the token even when revoking fails. Otherwise you
could never disconnect while offline, and the credential would stay on
disk at the exact moment the user asked to remove it.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The Google client

Pure HTTP over the two endpoints. No arithmetic beyond the query margin, and no normalization — that is `busyBlocks.cjs`'s job.

The critical rule, from spec §7.1: **the result is all-or-nothing.** A half-fetched week renders the missing calendar's meetings as *free time*, so any failure must abort the whole call rather than return what it got.

**Files:**
- Create: `electron/googleClient.cjs`, `electron/googleClient.d.cts`
- Modify: `electron/busyBlocks.cjs`, `electron/busyBlocks.d.cts`, `electron/busyBlocks.test.ts` (export and directly test `addDays`)
- Test: `electron/googleClient.test.ts`

**Interfaces:**
- Consumes: `addDays` from `electron/busyBlocks.cjs`; an injected `getAccessToken()`.
- Produces:
  ```ts
  CALENDAR_LIST_ENDPOINT: string
  EVENTS_ENDPOINT: (calendarId: string) => string
  QUERY_MARGIN_DAYS: number   // 1
  MAX_PAGES: number           // runaway guard
  createGoogleClient(deps: GoogleClientDeps): GoogleClient
  interface GoogleClientDeps {
    httpGet(url: string, accessToken: string): Promise<HttpResponse>;
    getAccessToken(): Promise<string>;
  }
  interface GoogleClient {
    listCalendars(): Promise<Array<{ id: string; summary: string; primary: boolean }>>;
    fetchEvents(input: { rangeStart: string; rangeEnd: string; calendarIds: string[] }): Promise<GoogleEvent[]>;
  }
  ```

- [ ] **Step 1: Export `addDays` and test it directly**

In `electron/busyBlocks.cjs`, add `addDays` to `module.exports`. In `electron/busyBlocks.d.cts`, add:

```ts
/**
 * 'YYYY-MM-DD' plus n days, without touching the machine timezone.
 *
 * Exported because `googleClient.cjs` needs the same date arithmetic to widen
 * its query window, and a second implementation would be a second thing to
 * get wrong.
 */
export declare function addDays(date: string, n: number): string;
```

Append to `electron/busyBlocks.test.ts` (extending the import):

```ts
describe('addDays', () => {
  it('moves forward and backward', () => {
    expect(addDays('2026-08-04', 1)).toBe('2026-08-05');
    expect(addDays('2026-08-04', -1)).toBe('2026-08-03');
    expect(addDays('2026-08-04', 0)).toBe('2026-08-04');
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  // Leap-year handling comes free from Date.UTC, but a hand-rolled version
  // would get this wrong, so it is pinned.
  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  // The whole point of routing through Date.UTC rather than local getters:
  // the answer must not depend on the machine's timezone or DST.
  it('is unaffected by a DST transition in the machine zone', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
  });

  it('always zero-pads, so results still compare correctly as strings', () => {
    expect(addDays('2026-09-09', 1)).toBe('2026-09-10');
    expect(addDays('2026-08-31', 1) > '2026-08-31').toBe(true);
  });
});
```

Run `npx vitest run --config vitest.config.ts electron/busyBlocks.test.ts` — expect the file's existing tests plus 5, all passing.

- [ ] **Step 2: Write the failing test**

Create `electron/googleClient.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  createGoogleClient, CALENDAR_LIST_ENDPOINT, EVENTS_ENDPOINT, MAX_PAGES,
  type GoogleClientDeps,
} from './googleClient.cjs';

type Reply = { ok?: boolean; status?: number; json: Record<string, unknown> };

/** Replies are keyed by a substring of the URL, so a test says what it means. */
function client(replies: Array<[string, Reply]>, over: Partial<GoogleClientDeps> = {}) {
  const urls: string[] = [];
  const tokens: string[] = [];
  const deps: GoogleClientDeps = {
    getAccessToken: async () => 'ACCESS',
    httpGet: async (url, accessToken) => {
      urls.push(url);
      tokens.push(accessToken);
      const hit = replies.find(([needle]) => url.includes(needle));
      if (!hit) throw new Error(`no fake reply matches ${url}`);
      return { ok: hit[1].ok ?? true, status: hit[1].status ?? 200, json: hit[1].json };
    },
    ...over,
  };
  return { api: createGoogleClient(deps), urls, tokens };
}

const RANGE = { rangeStart: '2026-08-03', rangeEnd: '2026-08-10', calendarIds: ['primary'] };
const ev = (id: string) => ({ id, status: 'confirmed', summary: id });

describe('listCalendars', () => {
  it('returns id, summary and primary', async () => {
    const { api } = client([[CALENDAR_LIST_ENDPOINT, { json: { items: [
      { id: 'me@example.com', summary: 'Me', primary: true },
      { id: 'team@group.calendar.google.com', summary: 'Team' },
    ] } }]]);
    expect(await api.listCalendars()).toEqual([
      { id: 'me@example.com', summary: 'Me', primary: true },
      { id: 'team@group.calendar.google.com', summary: 'Team', primary: false },
    ]);
  });

  it('follows pagination', async () => {
    let call = 0;
    const { api } = client([[CALENDAR_LIST_ENDPOINT, { json: {} }]], {
      httpGet: async () => {
        call += 1;
        return call === 1
          ? { ok: true, status: 200, json: { items: [{ id: 'a', summary: 'A' }], nextPageToken: 'p2' } }
          : { ok: true, status: 200, json: { items: [{ id: 'b', summary: 'B' }] } };
      },
    });
    expect((await api.listCalendars()).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('sends the access token as a bearer header, never in the URL', async () => {
    const { api, urls, tokens } = client([[CALENDAR_LIST_ENDPOINT, { json: { items: [] } }]]);
    await api.listCalendars();
    expect(tokens[0]).toBe('ACCESS');
    expect(urls[0]).not.toContain('ACCESS');
  });

  it('throws on a failed response rather than returning an empty list', async () => {
    const { api } = client([[CALENDAR_LIST_ENDPOINT, { ok: false, status: 403, json: { error: { message: 'Forbidden' } } }]]);
    await expect(api.listCalendars()).rejects.toThrow(/Forbidden|403/);
  });
});

describe('fetchEvents', () => {
  it('expands recurrences server-side, so no RRULE parsing is ever needed here', async () => {
    const { api, urls } = client([['/events', { json: { items: [ev('a')] } }]]);
    await api.fetchEvents(RANGE);
    expect(new URL(urls[0]).searchParams.get('singleEvents')).toBe('true');
  });

  // The margin is what lets normalizeEvents clip by LOCAL date without this
  // layer doing any zone arithmetic. One day each side is provably enough:
  // the largest real UTC offset is ±14h.
  it('widens the query by one day on each side, at UTC midnight', async () => {
    const { api, urls } = client([['/events', { json: { items: [] } }]]);
    await api.fetchEvents(RANGE);
    const q = new URL(urls[0]).searchParams;
    expect(q.get('timeMin')).toBe('2026-08-02T00:00:00Z');
    expect(q.get('timeMax')).toBe('2026-08-11T00:00:00Z');
  });

  it('queries every selected calendar', async () => {
    const { api, urls } = client([['/events', { json: { items: [] } }]]);
    await api.fetchEvents({ ...RANGE, calendarIds: ['primary', 'team@group.calendar.google.com'] });
    expect(urls).toHaveLength(2);
    expect(urls.join(' ')).toContain('primary');
  });

  // Holiday calendar ids contain '#', which truncates a URL if not encoded.
  it('percent-encodes the calendar id', async () => {
    const { api, urls } = client([['/events', { json: { items: [] } }]]);
    await api.fetchEvents({ ...RANGE, calendarIds: ['en.usa#holiday@group.v.calendar.google.com'] });
    expect(urls[0]).toContain('en.usa%23holiday%40group.v.calendar.google.com');
    expect(urls[0]).not.toContain('#holiday');
  });

  it('follows pagination within one calendar', async () => {
    let call = 0;
    const { api } = client([['/events', { json: {} }]], {
      httpGet: async () => {
        call += 1;
        return call === 1
          ? { ok: true, status: 200, json: { items: [ev('a')], nextPageToken: 'p2' } }
          : { ok: true, status: 200, json: { items: [ev('b')] } };
      },
    });
    expect((await api.fetchEvents(RANGE)).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('concatenates events across calendars', async () => {
    let call = 0;
    const { api } = client([['/events', { json: {} }]], {
      httpGet: async () => {
        call += 1;
        return { ok: true, status: 200, json: { items: [ev(`cal${call}`)] } };
      },
    });
    const out = await api.fetchEvents({ ...RANGE, calendarIds: ['a', 'b'] });
    expect(out.map((e) => e.id)).toEqual(['cal1', 'cal2']);
  });

  // THE critical rule. A partial result renders the missing calendar's
  // meetings as free time — silently wrong in the direction that causes
  // over-commitment.
  it('discards everything when any calendar fails', async () => {
    let call = 0;
    const { api } = client([['/events', { json: {} }]], {
      httpGet: async () => {
        call += 1;
        return call === 1
          ? { ok: true, status: 200, json: { items: [ev('from-the-good-calendar')] } }
          : { ok: false, status: 500, json: { error: { message: 'Backend error' } } };
      },
    });
    await expect(api.fetchEvents({ ...RANGE, calendarIds: ['a', 'b'] })).rejects.toThrow(/Backend error|500/);
  });

  it('discards everything when a later page fails', async () => {
    let call = 0;
    const { api } = client([['/events', { json: {} }]], {
      httpGet: async () => {
        call += 1;
        return call === 1
          ? { ok: true, status: 200, json: { items: [ev('page1')], nextPageToken: 'p2' } }
          : { ok: false, status: 503, json: { error: { message: 'Unavailable' } } };
      },
    });
    await expect(api.fetchEvents(RANGE)).rejects.toThrow(/Unavailable|503/);
  });

  it('propagates a token failure without calling Google', async () => {
    const { api, urls } = client([['/events', { json: { items: [] } }]], {
      getAccessToken: async () => { throw new Error('NotConnected'); },
    });
    await expect(api.fetchEvents(RANGE)).rejects.toThrow(/NotConnected/);
    expect(urls).toHaveLength(0);
  });

  it('returns an empty array for no calendars, without calling Google', async () => {
    const { api, urls } = client([['/events', { json: { items: [] } }]]);
    expect(await api.fetchEvents({ ...RANGE, calendarIds: [] })).toEqual([]);
    expect(urls).toHaveLength(0);
  });

  // A server that keeps returning the same page token would otherwise loop
  // forever inside the main process.
  it('gives up rather than paging forever', async () => {
    const { api, urls } = client([['/events', { json: {} }]], {
      httpGet: async () => ({ ok: true, status: 200, json: { items: [ev('x')], nextPageToken: 'always-the-same' } }),
    });
    await expect(api.fetchEvents(RANGE)).rejects.toThrow(/too many pages/i);
    expect(urls.length).toBeLessThanOrEqual(MAX_PAGES);
  });

  it('targets the documented events endpoint', async () => {
    const { api, urls } = client([['/events', { json: { items: [] } }]]);
    await api.fetchEvents(RANGE);
    expect(urls[0].startsWith(EVENTS_ENDPOINT('primary'))).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run --config vitest.config.ts electron/googleClient.test.ts
```

Expected: FAIL — cannot resolve `./googleClient.cjs`.

- [ ] **Step 4: Write the contract**

Create `electron/googleClient.d.cts`:

```ts
import type { GoogleEvent } from './busyBlocks.d.cts';
import type { HttpResponse } from './oauth.d.cts';

export interface GoogleClientDeps {
  /** The access token goes in an Authorization header, never in the URL. */
  httpGet(url: string, accessToken: string): Promise<HttpResponse>;
  getAccessToken(): Promise<string>;
}

export interface CalendarSummary {
  id: string;
  summary: string;
  primary: boolean;
}

export interface GoogleClient {
  listCalendars(): Promise<CalendarSummary[]>;
  /**
   * Raw events across every selected calendar, unnormalized.
   *
   * ALL-OR-NOTHING: any failed calendar or page rejects the whole call. A
   * partial result would render the missing calendar's meetings as free time.
   */
  fetchEvents(input: {
    rangeStart: string;   // 'YYYY-MM-DD' local, inclusive
    rangeEnd: string;     // 'YYYY-MM-DD' local, EXCLUSIVE
    calendarIds: string[];
  }): Promise<GoogleEvent[]>;
}

export declare const CALENDAR_LIST_ENDPOINT: string;
export declare function EVENTS_ENDPOINT(calendarId: string): string;
/** One day each side; the largest real UTC offset is ±14h, so this is enough. */
export declare const QUERY_MARGIN_DAYS: number;
/** Runaway guard against a server that keeps handing back a page token. */
export declare const MAX_PAGES: number;

export declare function createGoogleClient(deps: GoogleClientDeps): GoogleClient;
```

- [ ] **Step 5: Write the implementation**

Create `electron/googleClient.cjs`:

```js
// The two Google Calendar endpoints this feature reads. No normalization
// happens here — busyBlocks.cjs owns every minute of arithmetic.

const { addDays } = require('./busyBlocks.cjs');

const CALENDAR_LIST_ENDPOINT = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
const EVENTS_BASE = 'https://www.googleapis.com/calendar/v3/calendars';

// Calendar ids contain '@' and, for holiday calendars, '#'. An unencoded '#'
// truncates the URL at the fragment and silently queries the wrong calendar.
function EVENTS_ENDPOINT(calendarId) {
  return `${EVENTS_BASE}/${encodeURIComponent(calendarId)}/events`;
}

const QUERY_MARGIN_DAYS = 1;
const MAX_PAGES = 20;
const PAGE_SIZE = 2500; // Google's maximum for events.list

function createGoogleClient(deps) {
  const { httpGet, getAccessToken } = deps;

  function fail(res) {
    const message = res.json?.error?.message || res.json?.error_description || `HTTP ${res.status}`;
    return new Error(`Google Calendar request failed: ${message}`);
  }

  /** Walk `nextPageToken` and concatenate `items`. Any failed page throws. */
  async function pages(buildUrl, accessToken) {
    const out = [];
    let pageToken;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await httpGet(buildUrl(pageToken), accessToken);
      if (!res.ok) throw fail(res);
      out.push(...(res.json.items || []));
      pageToken = res.json.nextPageToken;
      if (!pageToken) return out;
    }
    // A server repeating the same token would otherwise spin forever inside
    // the main process, which has no other thread to notice.
    throw new Error('Google Calendar returned too many pages; giving up');
  }

  async function listCalendars() {
    const accessToken = await getAccessToken();
    const items = await pages((pageToken) => {
      const q = new URLSearchParams({ maxResults: '250' });
      if (pageToken) q.set('pageToken', pageToken);
      return `${CALENDAR_LIST_ENDPOINT}?${q.toString()}`;
    }, accessToken);
    return items.map((c) => ({ id: c.id, summary: c.summary, primary: c.primary === true }));
  }

  async function fetchEvents({ rangeStart, rangeEnd, calendarIds }) {
    if (calendarIds.length === 0) return [];
    const accessToken = await getAccessToken();

    // A one-day margin at UTC midnight, so normalizeEvents can clip by LOCAL
    // date without any zone arithmetic reaching this layer. See the plan's
    // "one arithmetic decision".
    const timeMin = `${addDays(rangeStart, -QUERY_MARGIN_DAYS)}T00:00:00Z`;
    const timeMax = `${addDays(rangeEnd, QUERY_MARGIN_DAYS)}T00:00:00Z`;

    const out = [];
    for (const calendarId of calendarIds) {
      // Sequential rather than parallel: any failure must abort the whole
      // fetch anyway, and a burst of parallel requests only makes it likelier.
      const items = await pages((pageToken) => {
        const q = new URLSearchParams({
          timeMin,
          timeMax,
          // Google expands recurrences server-side, so no RRULE, EXDATE or
          // VTIMEZONE parsing ever enters this codebase.
          singleEvents: 'true',
          maxResults: String(PAGE_SIZE),
        });
        if (pageToken) q.set('pageToken', pageToken);
        return `${EVENTS_ENDPOINT(calendarId)}?${q.toString()}`;
      }, accessToken);
      out.push(...items);
    }
    return out;
  }

  return { listCalendars, fetchEvents };
}

module.exports = {
  CALENDAR_LIST_ENDPOINT, EVENTS_ENDPOINT, QUERY_MARGIN_DAYS, MAX_PAGES, createGoogleClient,
};
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run --config vitest.config.ts electron/googleClient.test.ts
```

Expected: PASS, 17 tests.

- [ ] **Step 7: Prove the all-or-nothing and encoding tests discriminate**

Two mutations, each run and restored, reporting the observed failure:

1. In `fetchEvents`, wrap the per-calendar `pages(...)` call in `try { ... } catch { continue; }` — i.e. skip a failing calendar. *"discards everything when any calendar fails"* must FAIL. This is the exact defect that renders a missing calendar's meetings as free time.
2. Change `EVENTS_ENDPOINT` to interpolate `calendarId` without `encodeURIComponent`. *"percent-encodes the calendar id"* must FAIL.

- [ ] **Step 8: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
```

Expected: 1597 tests / 81 files (1575 + 5 + 17). Report the actual numbers.

```bash
git add electron/googleClient.cjs electron/googleClient.d.cts electron/googleClient.test.ts electron/busyBlocks.cjs electron/busyBlocks.d.cts electron/busyBlocks.test.ts
git commit -m "$(cat <<'EOF'
feat(calendar): read calendars and events from Google

All-or-nothing by construction: any failed calendar or page rejects
the whole fetch. Returning what succeeded would render the missing
calendar's meetings as free time, which is silently wrong in the one
direction that causes over-commitment.

The query is widened by a day on each side at UTC midnight so that
normalizeEvents can clip by local date with no zone arithmetic in the
HTTP layer. The largest real UTC offset is 14h, so one day is provably
enough, and the alternative was offset maths that drops boundary-day
events while every page still reports success.

Calendar ids are percent-encoded: holiday calendars contain '#', which
truncates a URL at the fragment and queries the wrong calendar.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The IPC handlers

Where the pieces meet. Every renderer-supplied argument is validated here, every failure becomes a typed reason rather than a thrown stack, and nothing sensitive crosses.

**A spec correction this task makes.** Spec §8 lists five channels, but §6.2 says the user pastes their OAuth client id and secret into a field in Phase — with no channel to save them through. This task adds a sixth, `configure`, and amends §8 to match. Do not skip the spec edit; §8 is the contract plan 3 builds its settings UI against.

**Files:**
- Create: `electron/calendarIpc.cjs`, `electron/calendarIpc.d.cts`
- Test: `electron/calendarIpc.test.ts`
- Modify: `docs/superpowers/specs/2026-08-04-google-calendar-producer-design.md` (§8)

**Interfaces:**
- Consumes: `SecretStore`, `CorruptSecretStoreError`, `OAuth`, `NotConnectedError`, `ReauthRequiredError`, `GoogleClient`, `normalizeEvents`.
- Produces:
  ```ts
  createCalendarHandlers(deps: HandlerDeps): CalendarHandlers
  interface CalendarHandlers {
    status(): Promise<StatusResult>;
    configure(input: { clientId: string; clientSecret: string }): Promise<void>;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    listCalendars(): Promise<CalendarSummary[]>;
    fetch(input: FetchInput): Promise<FetchResult>;
  }
  type FetchResult =
    | { ok: true; blocks: BusyBlock[]; fetchedAt: string; accountId: string; timeZone: string }
    | { ok: false; reason: FetchFailure };
  type FetchFailure =
    'not-configured' | 'not-connected' | 'reauth-required'
    | 'invalid-range' | 'malformed-data' | 'request-failed';
  registerCalendarIpc(ipcMain, handlers): void
  CHANNEL_PREFIX = 'phase-calendar'
  ```

- [ ] **Step 1: Write the failing test**

Create `electron/calendarIpc.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createCalendarHandlers, registerCalendarIpc, CHANNEL_PREFIX, type HandlerDeps } from './calendarIpc.cjs';
import { CorruptSecretStoreError } from './secrets.cjs';
import { NotConnectedError, ReauthRequiredError } from './oauth.cjs';

const CLIENT = { clientId: 'cid', clientSecret: 'sec' };
const RANGE = { rangeStart: '2026-08-03', rangeEnd: '2026-08-10', calendarIds: ['primary'] };
const EVENT = {
  status: 'confirmed', summary: 'standup',
  start: { dateTime: '2026-08-04T09:00:00-04:00' },
  end: { dateTime: '2026-08-04T10:00:00-04:00' },
};

function fakeSecrets(seed: Record<string, unknown> = {}) {
  const bag: Record<string, unknown> = { ...seed };
  return {
    available: () => true,
    get: (k: string) => bag[k],
    set: (k: string, v: unknown) => { bag[k] = v; },
    remove: (k: string) => { delete bag[k]; },
    reset: () => { for (const k of Object.keys(bag)) delete bag[k]; },
    _bag: bag,
  };
}

function handlers(over: Partial<HandlerDeps> = {}) {
  const calls: string[] = [];
  const secrets = (over.secrets as ReturnType<typeof fakeSecrets>) ?? fakeSecrets({ client: CLIENT });
  const deps = {
    secrets,
    oauth: {
      isConnected: () => true,
      connect: async () => { calls.push('connect'); },
      disconnect: async () => { calls.push('disconnect'); },
      getAccessToken: async () => 'A',
    },
    googleClient: {
      listCalendars: async () => [{ id: 'me@example.com', summary: 'Me', primary: true }],
      fetchEvents: async () => [EVENT],
    },
    normalizeEvents: (events: unknown[], options: { rangeStart: string; rangeEnd: string; timeZone: string }) =>
      [{ date: options.rangeStart, startMin: 540, endMin: 600, title: `n=${events.length}`, allDay: false }],
    timeZone: () => 'America/New_York',
    nowIso: () => '2026-08-04T13:41:00.000Z',
    ...over,
  } as HandlerDeps;
  return Object.assign(createCalendarHandlers(deps), { _calls: calls, _secrets: secrets, _deps: deps });
}

describe('status', () => {
  it('reports configured and connected with the account and zone', async () => {
    const h = handlers({ secrets: fakeSecrets({ client: CLIENT, account: { accountId: 'me@example.com' } }) });
    expect(await h.status()).toEqual({
      configured: true, connected: true, corrupt: false,
      accountId: 'me@example.com', timeZone: 'America/New_York',
    });
  });

  it('reports not configured before credentials are saved', async () => {
    const h = handlers({ secrets: fakeSecrets({}) });
    expect(await h.status()).toMatchObject({ configured: false, connected: false, accountId: null });
  });

  it('reports a corrupt store instead of throwing at boot', async () => {
    const secrets = fakeSecrets({});
    secrets.get = () => { throw new CorruptSecretStoreError(new Error('bad key')); };
    const h = handlers({ secrets });
    expect(await h.status()).toMatchObject({ configured: false, connected: false, corrupt: true });
  });

  // The whole point of the seam. A leaked secret here would reach the renderer.
  it('never returns a credential', async () => {
    const h = handlers({ secrets: fakeSecrets({ client: CLIENT, token: { refreshToken: 'R' }, account: { accountId: 'me@example.com' } }) });
    const json = JSON.stringify(await h.status());
    expect(json).not.toContain('sec');
    expect(json).not.toContain('R');
  });
});

describe('configure', () => {
  it('stores the pasted credentials', async () => {
    const h = handlers({ secrets: fakeSecrets({}) });
    await h.configure({ clientId: ' cid ', clientSecret: ' sec ' });
    expect(h._secrets._bag.client).toEqual({ clientId: 'cid', clientSecret: 'sec' });
  });

  it('rejects empty input rather than storing a broken credential', async () => {
    const h = handlers({ secrets: fakeSecrets({}) });
    await expect(h.configure({ clientId: '', clientSecret: 'sec' })).rejects.toThrow(/client id/i);
    await expect(h.configure({ clientId: 'cid', clientSecret: '  ' })).rejects.toThrow(/client secret/i);
    expect(h._secrets._bag.client).toBeUndefined();
  });

  // Reconfiguring means a different Cloud project, so the old token is
  // meaningless — and leaving it would make status() claim a connection the
  // new credentials cannot use.
  it('clears any existing token and account', async () => {
    const h = handlers({ secrets: fakeSecrets({ client: CLIENT, token: { refreshToken: 'R' }, account: { accountId: 'x' } }) });
    await h.configure({ clientId: 'new', clientSecret: 'new' });
    expect(h._secrets._bag.token).toBeUndefined();
    expect(h._secrets._bag.account).toBeUndefined();
  });
});

describe('connect', () => {
  it('runs the flow then records the primary calendar as the account', async () => {
    const h = handlers({ secrets: fakeSecrets({ client: CLIENT }) });
    await h.connect();
    expect(h._calls).toContain('connect');
    expect(h._secrets._bag.account).toEqual({ accountId: 'me@example.com' });
  });

  it('leaves no account recorded when there is no primary calendar', async () => {
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      googleClient: { listCalendars: async () => [{ id: 'x', summary: 'X', primary: false }], fetchEvents: async () => [] },
    });
    await h.connect();
    expect(h._secrets._bag.account).toBeUndefined();
  });
});

describe('disconnect', () => {
  it('revokes and forgets the account too', async () => {
    const h = handlers({ secrets: fakeSecrets({ client: CLIENT, account: { accountId: 'me@example.com' } }) });
    await h.disconnect();
    expect(h._calls).toContain('disconnect');
    expect(h._secrets._bag.account).toBeUndefined();
  });
});

describe('fetch', () => {
  it('normalizes what Google returned and stamps provenance', async () => {
    const h = handlers({ secrets: fakeSecrets({ client: CLIENT, account: { accountId: 'me@example.com' } }) });
    expect(await h.fetch(RANGE)).toEqual({
      ok: true,
      blocks: [{ date: '2026-08-03', startMin: 540, endMin: 600, title: 'n=1', allDay: false }],
      fetchedAt: '2026-08-04T13:41:00.000Z',
      accountId: 'me@example.com',
      timeZone: 'America/New_York',
    });
  });

  it('passes the requested range and the machine zone to the normalizer', async () => {
    const seen: unknown[] = [];
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT, account: { accountId: 'a' } }),
      normalizeEvents: (_e: unknown[], o: unknown) => { seen.push(o); return []; },
    });
    await h.fetch(RANGE);
    expect(seen[0]).toEqual({ rangeStart: '2026-08-03', rangeEnd: '2026-08-10', timeZone: 'America/New_York' });
  });

  it.each([
    ['a non-date start', { ...RANGE, rangeStart: '2026-8-3' }],
    ['a non-date end', { ...RANGE, rangeEnd: 'tomorrow' }],
    ['a reversed range', { ...RANGE, rangeStart: '2026-08-10', rangeEnd: '2026-08-03' }],
    ['an empty range', { ...RANGE, rangeStart: '2026-08-03', rangeEnd: '2026-08-03' }],
    ['calendarIds that is not an array', { ...RANGE, calendarIds: 'primary' as unknown as string[] }],
    ['a non-string calendar id', { ...RANGE, calendarIds: [42] as unknown as string[] }],
  ])('refuses %s', async (_label, input) => {
    const h = handlers({ secrets: fakeSecrets({ client: CLIENT }) });
    expect(await h.fetch(input)).toEqual({ ok: false, reason: 'invalid-range' });
  });

  it('reports not-configured before credentials exist', async () => {
    const h = handlers({ secrets: fakeSecrets({}) });
    expect(await h.fetch(RANGE)).toEqual({ ok: false, reason: 'not-configured' });
  });

  it('maps NotConnectedError to not-connected', async () => {
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      googleClient: { listCalendars: async () => [], fetchEvents: async () => { throw new NotConnectedError(); } },
    });
    expect(await h.fetch(RANGE)).toEqual({ ok: false, reason: 'not-connected' });
  });

  // Distinct because spec §10 keeps the cached blocks and prompts to
  // re-connect, rather than offering a first-time connect.
  it('maps ReauthRequiredError to reauth-required', async () => {
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      googleClient: { listCalendars: async () => [], fetchEvents: async () => { throw new ReauthRequiredError(); } },
    });
    expect(await h.fetch(RANGE)).toEqual({ ok: false, reason: 'reauth-required' });
  });

  // normalizeEvents throws RangeError on unparseable calendar data, and that
  // must surface as a failure rather than an empty — i.e. free — day.
  it('maps a RangeError from the normalizer to malformed-data', async () => {
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      normalizeEvents: () => { throw new RangeError('Invalid all-day end.date: 2026-8-6'); },
    });
    expect(await h.fetch(RANGE)).toEqual({ ok: false, reason: 'malformed-data' });
  });

  it('maps anything else to request-failed', async () => {
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      googleClient: { listCalendars: async () => [], fetchEvents: async () => { throw new Error('socket hang up'); } },
    });
    expect(await h.fetch(RANGE)).toEqual({ ok: false, reason: 'request-failed' });
  });

  it('never leaks a Google message or a stack to the renderer', async () => {
    const h = handlers({
      secrets: fakeSecrets({ client: CLIENT }),
      googleClient: { listCalendars: async () => [], fetchEvents: async () => { throw new Error('Bearer ya29.SECRET rejected'); } },
    });
    expect(JSON.stringify(await h.fetch(RANGE))).not.toContain('ya29');
  });
});

describe('registerCalendarIpc', () => {
  it('registers exactly the six channels under one prefix', () => {
    const registered: string[] = [];
    registerCalendarIpc({ handle: (channel: string) => registered.push(channel) }, handlers());
    expect(registered.sort()).toEqual([
      `${CHANNEL_PREFIX}:configure`,
      `${CHANNEL_PREFIX}:connect`,
      `${CHANNEL_PREFIX}:disconnect`,
      `${CHANNEL_PREFIX}:fetch`,
      `${CHANNEL_PREFIX}:listCalendars`,
      `${CHANNEL_PREFIX}:status`,
    ].sort());
  });

  it('drops the IPC event argument before calling the handler', async () => {
    const impls: Record<string, (...a: unknown[]) => unknown> = {};
    registerCalendarIpc({ handle: (c: string, fn: (...a: unknown[]) => unknown) => { impls[c] = fn; } }, handlers({
      secrets: fakeSecrets({ client: CLIENT, account: { accountId: 'a' } }),
    }));
    // A handler that forwarded the event object would treat it as the input.
    const out = await impls[`${CHANNEL_PREFIX}:fetch`]({ sender: 'ipc-event' }, RANGE);
    expect(out).toMatchObject({ ok: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run --config vitest.config.ts electron/calendarIpc.test.ts
```

Expected: FAIL — cannot resolve `./calendarIpc.cjs`.

- [ ] **Step 3: Write the contract**

Create `electron/calendarIpc.d.cts`:

```ts
import type { BusyBlock } from './busyBlocks.d.cts';
import type { SecretStore } from './secrets.d.cts';
import type { CalendarSummary, GoogleClient } from './googleClient.d.cts';

export interface StatusResult {
  configured: boolean;
  connected: boolean;
  /** The store exists but cannot be decrypted; the UI offers a reset. */
  corrupt: boolean;
  /** Provenance only — the Google account's primary calendar id. Never a credential. */
  accountId: string | null;
  timeZone: string;
}

export type FetchFailure =
  | 'not-configured'
  | 'not-connected'
  | 'reauth-required'
  | 'invalid-range'
  | 'malformed-data'
  | 'request-failed';

export type FetchResult =
  | { ok: true; blocks: BusyBlock[]; fetchedAt: string; accountId: string | null; timeZone: string }
  | { ok: false; reason: FetchFailure };

export interface FetchInput {
  rangeStart: string;
  rangeEnd: string;
  calendarIds: string[];
}

export interface HandlerDeps {
  secrets: SecretStore;
  oauth: {
    isConnected(): boolean;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getAccessToken(): Promise<string>;
  };
  googleClient: GoogleClient;
  normalizeEvents(events: unknown[], options: { rangeStart: string; rangeEnd: string; timeZone: string }): BusyBlock[];
  /** The machine's IANA zone. Injected so no test depends on where it runs. */
  timeZone(): string;
  nowIso(): string;
}

export interface CalendarHandlers {
  status(): Promise<StatusResult>;
  configure(input: { clientId: string; clientSecret: string }): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listCalendars(): Promise<CalendarSummary[]>;
  fetch(input: FetchInput): Promise<FetchResult>;
}

export declare const CHANNEL_PREFIX: string;
export declare function createCalendarHandlers(deps: HandlerDeps): CalendarHandlers;
/** `ipcMain` is typed loosely so the module never imports `electron`. */
export declare function registerCalendarIpc(
  ipcMain: { handle(channel: string, fn: (...args: any[]) => unknown): void },
  handlers: CalendarHandlers,
): void;
```

- [ ] **Step 4: Write the implementation**

Create `electron/calendarIpc.cjs`:

```js
// The renderer-facing surface. Every argument the renderer supplies is
// validated here, and every failure becomes a typed reason rather than a
// thrown stack — a Google error message can carry a bearer token.

const { CorruptSecretStoreError } = require('./secrets.cjs');
const { NotConnectedError, ReauthRequiredError } = require('./oauth.cjs');

const CHANNEL_PREFIX = 'phase-calendar';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CALENDARS = 50;

function createCalendarHandlers(deps) {
  const { secrets, oauth, googleClient, normalizeEvents, timeZone, nowIso } = deps;

  /** Reading a corrupt store must not throw out of `status`. */
  function safeGet(key) {
    try {
      return { ok: true, value: secrets.get(key) };
    } catch (err) {
      if (err instanceof CorruptSecretStoreError) return { ok: false, value: undefined };
      throw err;
    }
  }

  function validFetchInput(input) {
    if (!input || typeof input !== 'object') return false;
    const { rangeStart, rangeEnd, calendarIds } = input;
    if (!DATE_RE.test(rangeStart) || !DATE_RE.test(rangeEnd)) return false;
    if (!(rangeEnd > rangeStart)) return false;
    if (!Array.isArray(calendarIds) || calendarIds.length > MAX_CALENDARS) return false;
    return calendarIds.every((id) => typeof id === 'string' && id.length > 0);
  }

  async function status() {
    const client = safeGet('client');
    if (!client.ok) {
      return { configured: false, connected: false, corrupt: true, accountId: null, timeZone: timeZone() };
    }
    const account = safeGet('account').value;
    return {
      configured: !!(client.value && client.value.clientId && client.value.clientSecret),
      connected: oauth.isConnected(),
      corrupt: false,
      accountId: account ? account.accountId : null,
      timeZone: timeZone(),
    };
  }

  async function configure({ clientId, clientSecret }) {
    const id = typeof clientId === 'string' ? clientId.trim() : '';
    const secret = typeof clientSecret === 'string' ? clientSecret.trim() : '';
    if (!id) throw new Error('A Google OAuth client id is required');
    if (!secret) throw new Error('A Google OAuth client secret is required');
    // A different Cloud project means the stored token is meaningless, and
    // leaving it would make status() claim a connection the new credentials
    // cannot use.
    secrets.remove('token');
    secrets.remove('account');
    secrets.set('client', { clientId: id, clientSecret: secret });
  }

  async function connect() {
    await oauth.connect();
    // The account id is provenance, and the primary calendar's id IS the
    // user's address — so no extra scope is needed to learn it.
    const primary = (await googleClient.listCalendars()).find((c) => c.primary);
    if (primary) secrets.set('account', { accountId: primary.id });
  }

  async function disconnect() {
    await oauth.disconnect();
    secrets.remove('account');
  }

  async function listCalendars() {
    return googleClient.listCalendars();
  }

  async function fetchBlocks(input) {
    if (!validFetchInput(input)) return { ok: false, reason: 'invalid-range' };
    const client = safeGet('client');
    if (!client.ok) return { ok: false, reason: 'not-configured' };
    if (!client.value || !client.value.clientId) return { ok: false, reason: 'not-configured' };

    const zone = timeZone();
    try {
      const events = await googleClient.fetchEvents({
        rangeStart: input.rangeStart, rangeEnd: input.rangeEnd, calendarIds: input.calendarIds,
      });
      const blocks = normalizeEvents(events, {
        rangeStart: input.rangeStart, rangeEnd: input.rangeEnd, timeZone: zone,
      });
      const account = safeGet('account').value;
      return {
        ok: true,
        blocks,
        fetchedAt: nowIso(),
        accountId: account ? account.accountId : null,
        timeZone: zone,
      };
    } catch (err) {
      if (err instanceof NotConnectedError) return { ok: false, reason: 'not-connected' };
      if (err instanceof ReauthRequiredError) return { ok: false, reason: 'reauth-required' };
      // normalizeEvents throws RangeError on unparseable calendar data. It
      // must surface as a failure: an empty result would read as a free day.
      if (err instanceof RangeError) return { ok: false, reason: 'malformed-data' };
      // Deliberately does NOT forward the message. A Google error can quote
      // the Authorization header back at you.
      return { ok: false, reason: 'request-failed' };
    }
  }

  return { status, configure, connect, disconnect, listCalendars, fetch: fetchBlocks };
}

function registerCalendarIpc(ipcMain, handlers) {
  // The leading IPC event argument is dropped: forwarding it would let the
  // handler mistake it for the caller's input.
  ipcMain.handle(`${CHANNEL_PREFIX}:status`, () => handlers.status());
  ipcMain.handle(`${CHANNEL_PREFIX}:configure`, (_event, input) => handlers.configure(input));
  ipcMain.handle(`${CHANNEL_PREFIX}:connect`, () => handlers.connect());
  ipcMain.handle(`${CHANNEL_PREFIX}:disconnect`, () => handlers.disconnect());
  ipcMain.handle(`${CHANNEL_PREFIX}:listCalendars`, () => handlers.listCalendars());
  ipcMain.handle(`${CHANNEL_PREFIX}:fetch`, (_event, input) => handlers.fetch(input));
}

module.exports = { CHANNEL_PREFIX, createCalendarHandlers, registerCalendarIpc };
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run --config vitest.config.ts electron/calendarIpc.test.ts
```

Expected: PASS, 24 tests.

- [ ] **Step 6: Prove three tests discriminate**

Each mutation run and restored, reporting the observed failure:

1. Change the catch-all to `return { ok: false, reason: err.message }`. *"never leaks a Google message or a stack to the renderer"* must FAIL.
2. Delete the `RangeError` branch so it falls through to `request-failed`. *"maps a RangeError from the normalizer to malformed-data"* must FAIL.
3. Remove `secrets.remove('token')` from `configure`. *"clears any existing token and account"* must FAIL.

- [ ] **Step 7: Amend the spec**

In `docs/superpowers/specs/2026-08-04-google-calendar-producer-design.md` §8, change "Five `invoke`/`handle` channels and nothing else" to six and add the row:

```markdown
| `configure({ clientId, clientSecret })` | — |
```

Then add below the table:

```markdown
**`configure` was added during implementation.** §6.2 specifies that the user
pastes their OAuth client id and secret into a field in Phase, and the original
five channels gave that field nowhere to write. Configuring also clears any
stored token and account: different client credentials mean a different Cloud
project, so the old token is meaningless, and leaving it would make `status()`
claim a connection the new credentials cannot use.
```

- [ ] **Step 8: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
```

Expected: 1621 tests / 82 files (1597 + 24). Report the actual numbers.

```bash
git add electron/calendarIpc.cjs electron/calendarIpc.d.cts electron/calendarIpc.test.ts docs/superpowers/specs/2026-08-04-google-calendar-producer-design.md
git commit -m "$(cat <<'EOF'
feat(calendar): expose the producer over IPC

Six channels, not the spec's five: 6.2 has the user paste their OAuth
client credentials into Phase, and there was no channel for that field
to write through. The spec is amended rather than worked around, since
plan 3 builds its settings UI against it.

Every failure becomes a typed reason instead of a thrown stack. A
Google error message can quote the Authorization header back at you, so
the catch-all deliberately forwards nothing. RangeError gets its own
reason because it means unparseable calendar data, and an empty result
would read as a free day.

Reconfiguring clears the stored token: different credentials mean a
different Cloud project, and a stale token would let status() claim a
connection that cannot work.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Preload, real adapters, and the setup guide

The only task in this plan whose main artefact cannot be unit-tested, because it is the wiring to Electron itself. Everything it wires up is already tested; what it adds is the adapters and the bridge. Task 9's manual checklist is its verification.

**One constraint that shapes the design.** Electron preload scripts are **sandboxed by default** (Electron 20+), so a preload cannot `require('./calendarIpc.cjs')` — only `electron` is available. The channel names must therefore be written out in `preload.cjs` rather than imported. That duplication is a drift hazard, so Task 7's test file gains a guard that reads `preload.cjs` as text and checks it against `CHANNEL_PREFIX`.

That guard reads a source file, which the Global Constraints otherwise forbid. The constraint exists to keep tests off real I/O *under test*; reading the repo's own source as a fixture is not that, and the alternative — disabling the preload sandbox to allow an import — trades a real security boundary for tidiness. Do not disable the sandbox.

**Files:**
- Create: `electron/preload.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/calendarIpc.test.ts` (the drift guard)
- Create: `docs/google-calendar-setup.md`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: `window.phaseCalendar` in the renderer, with the six methods from Task 7. Plan 3's `src/lib/calendarBridge.ts` is its only consumer.

- [ ] **Step 1: Write the drift guard**

Add `import { readFileSync } from 'node:fs';` to the **top** of
`electron/calendarIpc.test.ts` alongside the existing imports — not inline
below, where `verbatimModuleSyntax` and ordinary readability both object.
Then append:

```ts
/**
 * A sandboxed preload cannot `require` a local module, so preload.cjs writes
 * the channel names out by hand. This is the only thing stopping the two
 * lists drifting apart — and drift would be a silent "function is not a
 * function" in the renderer, not a build error.
 */
describe('preload channel names', () => {
  const preload = readFileSync(new URL('./preload.cjs', import.meta.url), 'utf8');

  it('uses the same prefix the handlers register under', () => {
    expect(preload).toContain(CHANNEL_PREFIX);
  });

  it('exposes every registered channel and no others', () => {
    const registered: string[] = [];
    registerCalendarIpc({ handle: (channel: string) => registered.push(channel) }, handlers());
    const method = (channel: string) => channel.slice(CHANNEL_PREFIX.length + 1);
    for (const channel of registered) {
      expect(preload, channel).toContain(`${CHANNEL_PREFIX}:${method(channel)}`);
    }
    const invoked = [...preload.matchAll(new RegExp(`${CHANNEL_PREFIX}:(\\w+)`, 'g'))].map((m) => m[1]);
    expect([...new Set(invoked)].sort()).toEqual(registered.map(method).sort());
  });

  it('exposes the bridge under the name the renderer looks for', () => {
    expect(preload).toContain('phaseCalendar');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --config vitest.config.ts electron/calendarIpc.test.ts
```

Expected: FAIL — `ENOENT` on `preload.cjs`.

- [ ] **Step 3: Write the preload**

Create `electron/preload.cjs`:

```js
// The renderer's only door to the calendar producer.
//
// Preload scripts are sandboxed (Electron 20+), so this file cannot require
// calendarIpc.cjs for CHANNEL_PREFIX — only `electron` is available here. The
// channel names are therefore written out by hand, and a test in
// calendarIpc.test.ts reads this file to stop the two lists drifting.
//
// Nothing but these six invocations is exposed. No token, no client secret,
// and no ability to name a URL ever crosses.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('phaseCalendar', {
  status: () => ipcRenderer.invoke('phase-calendar:status'),
  configure: (input) => ipcRenderer.invoke('phase-calendar:configure', input),
  connect: () => ipcRenderer.invoke('phase-calendar:connect'),
  disconnect: () => ipcRenderer.invoke('phase-calendar:disconnect'),
  listCalendars: () => ipcRenderer.invoke('phase-calendar:listCalendars'),
  fetch: (input) => ipcRenderer.invoke('phase-calendar:fetch', input),
});
```

- [ ] **Step 4: Run the guard to verify it passes**

```bash
npx vitest run --config vitest.config.ts electron/calendarIpc.test.ts
```

Expected: PASS, 27 tests (24 + 3).

Then prove the guard discriminates: temporarily rename `phase-calendar:fetch` to `phase-calendar:fetchBlocks` in `preload.cjs`. *"exposes every registered channel and no others"* must FAIL. Restore. Report the observed failure — this guard is the only thing standing between a renamed channel and a runtime error in the renderer.

- [ ] **Step 5: Wire the real adapters into `main.cjs`**

Add to the top of `electron/main.cjs`, after the existing requires:

```js
const fs = require('node:fs')
const http = require('node:http')
const { safeStorage, ipcMain } = require('electron')
const { createSecretStore } = require('./secrets.cjs')
const { createPkce } = require('./pkce.cjs')
const { createOAuth } = require('./oauth.cjs')
const { createGoogleClient } = require('./googleClient.cjs')
const { normalizeEvents } = require('./busyBlocks.cjs')
const { createCalendarHandlers, registerCalendarIpc } = require('./calendarIpc.cjs')
```

Add this block before `createWindow`:

```js
// The encrypted store lives beside the app's other user data, NOT in the
// bundle: an .app is read-only and is replaced wholesale on every update.
const secretsPath = () => path.join(app.getPath('userData'), 'calendar-secrets.bin')

/** Adapts node:http to the LoopbackServer shape oauth.cjs expects. */
function createLoopbackServer() {
  let handler = null
  const server = http.createServer((req, res) => {
    if (handler) handler(req.url, (status, body) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(body)
    })
  })
  return {
    listen: () => new Promise((resolve, reject) => {
      // Port 0 asks the OS for any free port, and 127.0.0.1 keeps the socket
      // off every other interface.
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve(server.address().port))
    }),
    close: () => { try { server.close() } catch { /* already closed */ } },
    onRequest: (fn) => { handler = fn },
  }
}

async function httpJson(url, init) {
  const res = await fetch(url, init)
  let json = {}
  try { json = await res.json() } catch { /* an error body need not be JSON */ }
  return { ok: res.ok, status: res.status, json }
}

function buildCalendar() {
  const secrets = createSecretStore({
    readFile: () => (fs.existsSync(secretsPath()) ? fs.readFileSync(secretsPath()) : null),
    writeFile: (bytes) => fs.writeFileSync(secretsPath(), bytes, { mode: 0o600 }),
    removeFile: () => { try { fs.unlinkSync(secretsPath()) } catch { /* already gone */ } },
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (bytes) => safeStorage.decryptString(bytes),
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  })

  const oauth = createOAuth({
    secrets,
    httpPost: (url, body) => httpJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }),
    createServer: createLoopbackServer,
    openExternal: (url) => shell.openExternal(url),
    now: () => Date.now(),
    setTimer: (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id) },
    createPkce: () => createPkce(),
  })

  const googleClient = createGoogleClient({
    httpGet: (url, accessToken) => httpJson(url, { headers: { Authorization: `Bearer ${accessToken}` } }),
    getAccessToken: () => oauth.getAccessToken(),
  })

  return createCalendarHandlers({
    secrets,
    oauth,
    googleClient,
    normalizeEvents,
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    nowIso: () => new Date().toISOString(),
  })
}
```

In `createWindow`, add the preload to `webPreferences` — leaving `contextIsolation` and `nodeIntegration` exactly as they are:

```js
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
```

In `app.whenReady()`, register **before** creating the window:

```js
app.whenReady().then(() => {
  // Before createWindow: a fast first paint must not reach a channel that
  // does not exist yet.
  registerCalendarIpc(ipcMain, buildCalendar())
  createWindow()
```

- [ ] **Step 6: Verify the app still boots**

```bash
npx tsc -b && npm run build
```

Both must exit 0. Then launch it and confirm the window appears with no console error:

```bash
npm run dev &
sleep 4
npm run app:dev
```

In the app's devtools console, run `await window.phaseCalendar.status()`. Expect `{ configured: false, connected: false, corrupt: false, accountId: null, timeZone: '<your zone>' }`. Quit the app and stop the dev server.

Report the actual object you got. If `window.phaseCalendar` is undefined, the preload path or the sandbox is wrong and nothing else in this task matters.

- [ ] **Step 7: Write the setup guide**

Create `docs/google-calendar-setup.md`. It must cover, in order: creating a Google Cloud project; enabling the Google Calendar API; configuring the OAuth consent screen as **External**; **setting Publishing status to "In production"**; creating an OAuth client of type **Desktop app**; and pasting the client id and secret into Phase.

The publishing-status table is the most important content in the file — reproduce it:

```markdown
| Posture | Refresh token | Notes |
|---|---|---|
| Own client, **In production**, unverified | Persists | **Recommended.** One-time "Google hasn't verified this app" screen — click *Advanced → Go to Phase*. |
| Own client, **Testing** | **Expires in 7 days** | Development only. You will be forced to re-consent every week. |
| Verified production app | Persists | Requires Google review; out of scope. |
```

Also state: the API is free with no billing account; the two scopes requested and why (`calendar.events.readonly` for the busy data, `calendar.calendarlist.readonly` for the picker — `events.readonly` alone does not authorize the picker, and the broader `calendar.readonly` would grant more than Phase needs); that Phase never writes to Google; and that a desktop OAuth client's "secret" is not confidential, which is why Phase ships none and PKCE is what actually protects the flow.

- [ ] **Step 8: Run the whole suite, typecheck, and commit**

```bash
npm test && npx tsc -b
```

Expected: 1624 tests / 82 files (1621 + 3). Report the actual numbers.

```bash
git add electron/preload.cjs electron/main.cjs electron/calendarIpc.test.ts docs/google-calendar-setup.md
git commit -m "$(cat <<'EOF'
feat(calendar): wire the producer into the Electron shell

Handlers register before the window is created, so a fast first paint
cannot reach a channel that does not exist yet.

Preload scripts are sandboxed, so preload.cjs cannot require
calendarIpc.cjs for the channel names and writes them out by hand. A
test reads the file to stop the two lists drifting, because drift would
surface as "not a function" in the renderer rather than a build error.
Disabling the sandbox to allow the import would trade a real security
boundary for tidiness.

The encrypted store lives in userData, not the bundle: an .app is
read-only and is replaced wholesale on update.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Verification sweep

**Files:** none created or modified unless a check fails.

- [ ] **Step 1: Full suite from clean**

```bash
npm test
```

Expected: **1624 tests / 82 files**. If `src/views/goals/BoardCard.keyboard.test.tsx` fails, re-run it alone; it is a known pre-existing flake. Any other failure is real.

- [ ] **Step 2: Typecheck and production build**

```bash
npx tsc -b && npm run build
```

Both exit 0.

- [ ] **Step 3: Confirm no test reaches the network or Electron**

```bash
grep -rn "require('electron')\|from 'electron'" electron/*.test.ts
grep -rn "createServer\|listen(" electron/*.test.ts | grep -v fakeServer
grep -rln "http://localhost\|https://www.googleapis" electron/*.test.ts
```

The first two must be empty. The third may match only where a test asserts a URL string — confirm by reading that no test performs a request.

- [ ] **Step 4: Confirm nothing sensitive can cross the bridge**

```bash
grep -n "clientSecret\|refreshToken\|accessToken" electron/calendarIpc.cjs electron/preload.cjs
```

Expected: no match in `preload.cjs`, and in `calendarIpc.cjs` only inside `configure` (which receives them) — never in a return value. Read `status()` and `fetch()`'s returns and confirm by eye.

- [ ] **Step 5: Confirm `src/` is untouched**

```bash
git diff --stat 9d5b490..HEAD -- src/
```

Expected: empty. `9d5b490` is the last commit of plan 1, i.e. the commit before Task 1 of this plan. This plan changes nothing in the renderer; that is plan 3.

- [ ] **Step 6: Confirm the seam still holds**

```bash
grep -rn "googleapis\|GoogleEvent\|phase-calendar" src/ --include="*.ts" --include="*.tsx"
```

Expected: no output. `src/` still knows nothing about Google or the IPC channels until plan 3.

- [ ] **Step 7: Manual checks — the only way to exercise OAuth at all**

These cannot be automated. The OAuth flow end-to-end, the `safeStorage` round-trip, and the IPC boundary itself all need a real Electron process and a real Google account, and no test in this repo can substitute.

**Prerequisite:** the user must have completed `docs/google-calendar-setup.md` and have a client id and secret to paste.

Run the app, open devtools, and work through the console:

```bash
npm run dev &
npm run app:dev
```

1. **Not configured.** `await window.phaseCalendar.status()` → `configured: false, connected: false, corrupt: false`.
2. **Configure.** `await window.phaseCalendar.configure({ clientId: '...', clientSecret: '...' })`, then `status()` → `configured: true, connected: false`.
3. **Connect.** `await window.phaseCalendar.connect()` opens your browser. Consent, click through the unverified-app screen. The browser should land on a page saying Phase is connected. `status()` → `connected: true` and `accountId` is your Google address.
4. **The socket closed.** `lsof -iTCP -sTCP:LISTEN -P | grep -i electron` — no stray loopback port remains.
5. **List calendars.** `await window.phaseCalendar.listCalendars()` → your calendars, with `primary: true` on exactly one.
6. **Fetch.** `await window.phaseCalendar.fetch({ rangeStart: '<a Monday>', rangeEnd: '<+7d>', calendarIds: ['primary'] })` → `ok: true` with blocks whose dates and times match what you actually have that week. **Check one meeting against your real calendar** — right day, right start minute.
7. **Overlapping meetings merge.** If that week has two overlapping meetings, confirm one block covers their union with both titles joined, not two blocks or a doubled duration.
8. **Restart persistence.** Quit the app entirely, relaunch, `status()` → still `connected: true` with no re-consent. This is what proves the refresh token survived `safeStorage` and that publishing status is right.
9. **Refresh works.** Optional but valuable: leave the app open for over an hour, then `fetch()` again. It must succeed without re-consent — that exercises the refresh path, which nothing else does.
10. **Bad range refused.** `await window.phaseCalendar.fetch({ rangeStart: '2026-8-3', rangeEnd: '2026-08-10', calendarIds: ['primary'] })` → `{ ok: false, reason: 'invalid-range' }`.
11. **Disconnect.** `await window.phaseCalendar.disconnect()`, then `status()` → `connected: false`, `accountId: null`. Confirm the grant is gone from https://myaccount.google.com/permissions.
12. **Browser still works.** `npm run dev` alone in a browser: Phase behaves exactly as before and `window.phaseCalendar` is `undefined`.

- [ ] **Step 8: Report**

Test count delta, every grep result, the outcome of each manual check with what you actually observed, every deliberate-failure check from Tasks 1–8 with the failure observed, and any Minor left open.

---

## What this plan deliberately does NOT do

Named so a reviewer does not read them as omissions:

- **Nothing in `src/` changes.** No `calendarBridge.ts`, no store state, no settings UI, no threading of `blocks` into `Plan.tsx`. That is plan 3.
- **No cache is written.** `src/db/calendarCache.ts` exists from plan 1 and stays unused; deciding *when* to fetch and what to persist is plan 3's job, because it owns `fetchRange` and `ifOwner`.
- **No UI.** The only way to drive this is the devtools console, deliberately — a settings panel built here would be built twice.
- **No retry, no backoff, no background poll.** Spec §7.3's triggers live in plan 3.
- **No provenance invalidation.** The handler stamps `accountId`/`timeZone` onto the result; comparing them against a cached row and discarding on mismatch is plan 3.
- **`electron/busyBlocks.cjs` gains only an export.** Its arithmetic is plan 1's and is not revisited.
