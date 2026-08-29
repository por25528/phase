# macOS signing, notarization and the developer build

Phase ships as a Developer ID–signed, notarized DMG. Nothing in this repository
holds a certificate, a key or a password: every credential arrives from GitHub
Actions secrets at build time, and the runner throws away what it materialises.

There are exactly two ways to package the app, and one environment variable
decides which:

| | `PHASE_RELEASE_SIGNING` | Signature | Hardened runtime | Notarized | Runs on |
|---|---|---|---|---|---|
| **Developer build** | unset | ad-hoc (`-`) | yes | no | the Mac that built it |
| **Release build** | `1` | Developer ID Application | yes | yes, stapled | any Mac |

Both paths harden the runtime and sign against `build/entitlements.mac.plist`.
That is deliberate: an entitlement mistake then breaks the build on a laptop
rather than in a user's Console log.

The rules live in one place, [`PhaseApp/scripts/releaseConfig.cjs`](../PhaseApp/scripts/releaseConfig.cjs),
which `electron-builder.cjs` calls. `scripts/releaseConfig.test.ts` and
`scripts/releasePackaging.test.ts` cover them, and both run under `npm test`.

## The developer build

```bash
cd PhaseApp
npm run build:mac     # → PhaseApp/release/, one folder per architecture
npm run verify:mac    # asserts ad-hoc + hardened runtime + entitlements
```

No Apple account, no certificate, no network round-trip to Apple. What you get
is an **ad-hoc signature**: valid on the machine that produced it, and rejected
everywhere else. That is fine for testing your own build, and it is the reason
this path must never be what a user downloads.

`verify:mac` does not name a path. electron-builder writes `release/mac` for
x64 and `release/mac-arm64` for arm64, so which folders exist depends on the
machine and the flags; `scripts/verify-build.cjs` asks the filesystem and checks
every bundle it finds. A run that finds nothing fails — a verifier that
silently checks zero artifacts is indistinguishable from one that passed.

### Opening your own ad-hoc build

An ad-hoc signature carries no Developer ID and no notarization ticket, so
Gatekeeper will refuse the first launch. Overriding it here is legitimate: you
compiled the code, and the app you are being warned about is your own build.

1. Open the DMG and drag **Phase** to **Applications** as usual.
2. Launch it once. macOS refuses and offers only **Done**.
3. Open **System Settings → Privacy & Security**, scroll to the message naming
   Phase, and click **Open Anyway**.
4. Launch it again and confirm.

One approval per build, per machine. Equivalently, from a terminal:

```sh
xattr -d com.apple.quarantine /Applications/Phase.app
```

**This is the developer exception and it stays here.** It does not belong in
the README's download section or in the release notes: those describe the
published DMG, which is notarized and opens by double-clicking. Anyone who
needs these steps for a build they did not compile is being handed a build that
should never have been published — `scripts/releasePackaging.test.ts` fails the
suite if this copy reappears on an end-user install path.

## The release build

Tag and push; `.github/workflows/release.yml` does the rest:

1. **Preflight** — `scripts/check-release-credentials.cjs`, before `npm ci`,
   so a bad secret costs seconds rather than an install, a suite and a build.
   It fails if a secret is missing, blank, or belongs to the wrong notarization
   method, and for `api-key` it decodes the key in memory and checks it really
   is a PKCS#8 file. It also refuses a release missing either half of the
   managed Google OAuth client, which is the one credential whose absence
   would otherwise fail nothing. It prints names only.
2. `npm ci`, `npm test`, `npm run build`.
3. `npm run calendar:credentials` writes the managed Google OAuth client into
   `electron/calendar-credentials.json`, **before** electron-builder packs
   `electron/**`. See [the calendar secrets](#the-managed-google-oauth-client).
4. `scripts/write-apple-api-key.cjs` decodes the key into `$RUNNER_TEMP` — never
   the workspace — at mode 0600.
5. `electron-builder` imports the certificate into a throwaway keychain, signs
   with the hardened runtime and the entitlements, then notarizes and staples
   the `.app`.
6. `scripts/notarize-dmg.sh` notarizes and staples each DMG — electron-builder
   staples the app but not the image around it, and Gatekeeper assesses the
   downloaded image on its own.
7. `node scripts/verify-build.cjs release` proves what was produced.
8. The key file is deleted (`if: always()`).
9. Only then is the GitHub release created.

Step 6 is the gate that matters. electron-builder **warns rather than fails**
when it cannot assemble notarization options — `skipped macOS notarization` — so
a release can otherwise sail through green and be rejected on every user's Mac.
The verifier asserts, on the `.app` and on each DMG:

- `codesign --verify --deep --strict` passes
- the code directory carries the `runtime` flag
- all four entitlements are actually embedded
- `Authority=Developer ID Application`, and not `Signature=adhoc`
- `xcrun stapler validate` finds a ticket
- `spctl --assess` reports `accepted, source=Notarized Developer ID`

It names no path: the bundles and images are discovered under `release/`, so
every architecture that was built is checked, and finding none fails the job.

### The two names for the App Store Connect key

`APPLE_API_KEY_P8_BASE64` is the **repository secret** — base64 of the `.p8`.
`APPLE_API_KEY` is what electron-builder and `notarytool --key` read, and it is
a **path**. They are separate on purpose: one name for both is how a build ends
up handing notarytool a base64 blob as a filename and getting an error that
names neither. `scripts/releaseConfig.cjs` keeps the two contracts apart —
`requiredReleaseSecrets` for the preflight, `requiredBuilderVars` for
electron-builder — and `assertBuilderEnv` additionally checks that the path
names a file that exists, so a skipped materialise step fails at the config seam
rather than becoming an unnotarized DMG.

## The Apple-account seam

`PHASE_NOTARY_METHOD`, set at the top of `.github/workflows/release.yml`,
chooses how `notarytool` authenticates. Change that one value to switch.

### `api-key` (default, recommended)

An App Store Connect API key: scoped to notarization, revocable on its own, and
unaffected by 2FA or a password change.

Create it at **App Store Connect → Users and Access → Integrations → App Store
Connect API**, role **Developer**. You get one download of an `AuthKey_*.p8`.

| Secret | What it is |
|---|---|
| `APPLE_API_KEY_P8_BASE64` | `base64 -i AuthKey_XXXXXXXX.p8 \| pbcopy` |
| `APPLE_API_KEY_ID` | the key ID, e.g. `XXXXXXXX` |
| `APPLE_API_ISSUER` | the issuer UUID shown above the key list |

### `apple-id`

An Apple ID plus an app-specific password from
[appleid.apple.com](https://appleid.apple.com) → **Sign-In and Security** →
**App-Specific Passwords**.

| Secret | What it is |
|---|---|
| `APPLE_ID` | the Apple ID email on the Developer Program account |
| `APPLE_APP_SPECIFIC_PASSWORD` | the generated `xxxx-xxxx-xxxx-xxxx` password |
| `APPLE_TEAM_ID` | the 10-character team ID from developer.apple.com → Membership |

Set **only** the chosen method's secrets. electron-builder checks `APPLE_ID`
before it looks at the API key, so a leftover Apple ID variable would silently
override an `api-key` release — the preflight refuses that mixture rather than
letting it happen quietly.

### The certificate (both methods)

A **Developer ID Application** certificate, which needs a paid Apple Developer
Program membership.

1. Xcode → Settings → Accounts → Manage Certificates → **+** → Developer ID
   Application. (Or a CSR at developer.apple.com → Certificates.)
2. Keychain Access → export the certificate **and its private key** as a `.p12`
   with a passphrase.
3. `base64 -i Phase-DeveloperID.p12 | pbcopy`

| Secret | What it is |
|---|---|
| `MACOS_CERTIFICATE_P12_BASE64` | the base64 of the `.p12` |
| `MACOS_CERTIFICATE_PASSWORD` | the passphrase you set on export |

### The managed Google OAuth client

Phase ships an OAuth client so a user can connect a calendar without first
making their own Google Cloud project. It is **not** an Apple credential and
nothing about signing needs it — which is exactly why it is listed here: a
release built without it signs, notarizes and verifies perfectly, and ships an
app whose Calendar tab asks every user for a client ID. Nothing fails.

[`docs/google-calendar-setup.md`](google-calendar-setup.md) is the authority on
the client itself — which Cloud project it belongs to, which scopes it asks
for, and how to create or rotate one.

| Secret | What it is |
|---|---|
| `PHASE_GOOGLE_CLIENT_ID` | the Desktop app OAuth client ID, `NNN.apps.googleusercontent.com` |
| `PHASE_GOOGLE_CLIENT_SECRET` | that client's secret |

**Both or neither.** Half a pair cannot authenticate, so the preflight refuses
one without the other rather than shipping a build that fails at consent. An
ad-hoc developer build is allowed to have neither: `PHASE_RELEASE_SIGNING`
unset means no check, and the app falls back to Settings → Calendar → *Use my
own Google OAuth client*. That fallback is also what a user of a release gets
if these are ever unset.

A desktop client's "secret" is not confidential — a desktop app cannot keep
one, which is why PKCE rather than the secret protects the flow. It is still
kept out of the repository so it is rotatable without a code change, and so a
fork does not inherit this project's Cloud quota.

Add all of them under **Settings → Secrets and variables → Actions**.

## Entitlements

`build/entitlements.mac.plist` (the app) and `build/entitlements.mac.inherit.plist`
(the Renderer/GPU/Plugin helpers) grant four hardened-runtime exceptions:

| Entitlement | Why |
|---|---|
| `cs.allow-jit` | V8 compiles JavaScript at runtime |
| `cs.allow-unsigned-executable-memory` | V8's non-JIT executable pages |
| `cs.allow-dyld-environment-variables` | Electron launches helpers via `DYLD_*` |
| `cs.disable-library-validation` | the framework and helpers are separately signed code |

There is **no App Sandbox**. Phase is Developer ID software, not App Store
software, and the sandbox would break the loopback OAuth server, the Unix agent
socket at `~/Library/Application Support/Phase`, `safeStorage`'s Keychain access
and the global shortcut — none of which need an entitlement while unsandboxed.
`com.apple.security.inherit` is absent from the helper plist for the same
reason: it is a sandbox key with nothing to inherit.

## Secret hygiene

- No credential is written to `$GITHUB_ENV`, to the workspace, or to the log.
  Every workflow step passes them through `env:` straight into the tool.
- The `.p8` is decoded by `scripts/write-apple-api-key.cjs`, which reads the
  secret from the environment — so the value never appears in the rendered
  `run:` script — validates the base64 alphabet, the round trip and the PKCS#8
  header, and only then writes to `$RUNNER_TEMP` at mode 0600. A corrupted
  secret leaves no file behind rather than a plausible-looking broken one.
  `base64 --decode` was doing this before and it accepts corrupted input
  silently; the failure then surfaced inside notarytool, one signed app later.
- `scripts/notarize-dmg.sh` passes credentials as `notarytool` arguments only
  and never enables `set -x`; a test asserts that.
- `scripts/check-release-credentials.cjs` and `releaseConfig.cjs` report
  variable **names**; a test asserts no value reaches a failure message.
- The key file is removed in an `if: always()` step, so a failed build does not
  leave it behind.

## Rotating or revoking

Revoke the API key in App Store Connect (or the app-specific password at
appleid.apple.com), then replace the corresponding repository secrets. Nothing
in the repository needs to change. To move to a different Apple account,
replace the certificate secrets too and, if the account uses the other
authentication style, flip `PHASE_NOTARY_METHOD`.
