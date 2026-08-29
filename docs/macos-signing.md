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
npm run build:mac     # → PhaseApp/release/Phase-<version>-arm64.dmg (and x64)
npm run verify:mac    # asserts ad-hoc + hardened runtime + entitlements
```

No Apple account, no certificate, no network round-trip to Apple. What you get
is an **ad-hoc signature**: valid on the machine that produced it, and rejected
everywhere else. That is fine for testing your own build, and it is the reason
this path must never be what a user downloads.

If you hand an ad-hoc DMG to someone else, they will have to override Gatekeeper
to open it. Do not publish one and do not write override instructions for one:
the published DMG is notarized and opens by double-clicking.

## The release build

Tag and push; `.github/workflows/release.yml` does the rest:

1. `npm ci`, `npm test`, `npm run build`.
2. **Preflight** — `scripts/check-release-credentials.cjs` fails the job in
   seconds if a secret is missing, blank, or belongs to the wrong notarization
   method. It prints names only.
3. Materialise the App Store Connect key into `$RUNNER_TEMP` (never the
   workspace).
4. `electron-builder` imports the certificate into a throwaway keychain, signs
   with the hardened runtime and the entitlements, then notarizes and staples
   the `.app`.
5. `scripts/notarize-dmg.sh` notarizes and staples each DMG — electron-builder
   staples the app but not the image around it, and Gatekeeper assesses the
   downloaded image on its own.
6. `scripts/verify-macos-artifacts.sh release …` proves what was produced.
7. The key file is deleted (`if: always()`).
8. Only then is the GitHub release created.

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
- The `.p8` is decoded with `printenv … | base64 --decode`, so the value never
  appears in the rendered `run:` script, and lands in `$RUNNER_TEMP` under
  `umask 077`.
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
