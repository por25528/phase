#!/usr/bin/env bash
# Prove what was actually produced, instead of trusting that the build meant to.
#
#   verify-macos-artifacts.sh release <app> [dmg...]   what CI must see
#   verify-macos-artifacts.sh dev     <app>            the local ad-hoc build
#
# The release mode is the one that matters: every check here is a way a release
# has silently gone out broken before — an unsigned build that electron-builder
# only warned about, a hardened-runtime flag that never got set, a notarization
# that was skipped, a staple that never happened.

set -euo pipefail

usage() {
  echo "usage: verify-macos-artifacts.sh <release|dev> <app-bundle> [dmg...]" >&2
  exit 2
}

[ "$#" -ge 2 ] || usage
mode="$1"
app="$2"
shift 2
# What is left in "$@" is the disk images, possibly none. It stays as positional
# parameters rather than an array: `"${empty[@]}"` is an unbound-variable error
# under `set -u` in bash 3.2, which is what a macOS runner gives you.

case "$mode" in
  release|dev) ;;
  *) echo "mode must be release or dev, got: $mode" >&2; exit 2 ;;
esac
[ -d "$app" ] || { echo "no such app bundle: $app" >&2; exit 1; }

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "  ok  $*"; }

# codesign writes its report to stderr; capture both so it can be grepped.
signature="$(codesign -dvvv "$app" 2>&1)"
entitlements="$(codesign -d --entitlements - --xml "$app" 2>/dev/null || true)"

echo "==> $app"

codesign --verify --deep --strict --verbose=2 "$app" 2>&1 | sed 's/^/      /'
pass "signature is internally consistent (--deep --strict)"

# The hardened runtime is what the entitlements are exceptions to. Without the
# runtime flag the plist is inert and notarization would have been refused.
if ! grep -qE '^CodeDirectory .*flags=0x[0-9a-f]*\(.*runtime.*\)' <<<"$signature"; then
  fail "the hardened runtime is not enabled (no runtime flag in codesign -dvvv)"
fi
pass "hardened runtime enabled"

for key in com.apple.security.cs.allow-jit \
           com.apple.security.cs.allow-unsigned-executable-memory \
           com.apple.security.cs.allow-dyld-environment-variables \
           com.apple.security.cs.disable-library-validation; do
  grep -q "$key" <<<"$entitlements" || fail "entitlement not embedded: $key"
done
pass "all four hardened-runtime entitlements are embedded"

if [ "$mode" = dev ]; then
  # The developer path is honest about what it is: ad-hoc, no ticket, and
  # trusted by exactly one Mac. See docs/macos-signing.md.
  grep -q 'Signature=adhoc' <<<"$signature" \
    || fail "expected an ad-hoc signature; this build was signed with an identity"
  pass "ad-hoc signature, as a developer build should be"
  echo "==> all checks passed (dev)"
  exit 0
fi

grep -q 'Authority=Developer ID Application' <<<"$signature" \
  || fail "not signed with a Developer ID Application certificate"
pass "signed with Developer ID Application"

if grep -q 'Signature=adhoc' <<<"$signature"; then
  fail "this is an ad-hoc signature, not a releasable one"
fi
pass "not ad-hoc"

# The ticket, not just the signature: this is what lets the app launch on a Mac
# that has never seen it and may be offline.
xcrun stapler validate "$app" >/dev/null 2>&1 \
  || fail "no notarization ticket stapled to the app"
pass "notarization ticket stapled"

assessment="$(spctl --assess --type exec -vvv "$app" 2>&1 || true)"
grep -q 'accepted' <<<"$assessment" || fail "Gatekeeper rejects the app:
$assessment"
grep -q 'source=Notarized Developer ID' <<<"$assessment" \
  || fail "Gatekeeper accepts the app, but not as notarized:
$assessment"
pass "Gatekeeper: accepted, source=Notarized Developer ID"

for dmg in "$@"; do
  echo "==> $dmg"
  [ -f "$dmg" ] || fail "no such disk image: $dmg"
  xcrun stapler validate "$dmg" >/dev/null 2>&1 \
    || fail "no notarization ticket stapled to $(basename "$dmg")"
  pass "notarization ticket stapled"
  dmg_assessment="$(spctl --assess --type open --context context:primary-signature -vvv "$dmg" 2>&1 || true)"
  grep -q 'accepted' <<<"$dmg_assessment" || fail "Gatekeeper rejects the disk image:
$dmg_assessment"
  pass "Gatekeeper accepts the disk image"
done

echo "==> all checks passed (release)"
