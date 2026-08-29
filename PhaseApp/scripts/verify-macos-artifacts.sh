#!/usr/bin/env bash
# Prove what was actually produced, instead of trusting that the build meant to.
#
#   verify-macos-artifacts.sh dev     <app>          the local ad-hoc build
#   verify-macos-artifacts.sh release <app>          what CI must see
#   verify-macos-artifacts.sh dmg     <dmg> [dmg...] the images CI publishes
#
# One artifact kind per mode, so a caller never has to guess which arguments a
# mode consumes. scripts/verify-build.cjs is what drives all three, because it
# is the filesystem — not this script and not the workflow — that knows which
# architectures were built.
#
# Every check here is a way a release has silently gone out broken before: a
# build electron-builder only warned about, a hardened-runtime flag that never
# got set, a notarization that was skipped, a staple that never happened.

set -euo pipefail

usage() {
  echo "usage: verify-macos-artifacts.sh <dev|release> <app-bundle>" >&2
  echo "       verify-macos-artifacts.sh dmg <disk-image> [disk-image...]" >&2
  exit 2
}

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "  ok  $*"; }

[ "$#" -ge 2 ] || usage
mode="$1"
shift

verify_dmg() {
  local dmg="$1"
  echo "==> $dmg"
  [ -f "$dmg" ] || fail "no such disk image: $dmg"
  # The ticket, not just the signature: Gatekeeper assesses the downloaded image
  # on its own, and electron-builder staples the app but never the image.
  xcrun stapler validate "$dmg" >/dev/null 2>&1 \
    || fail "no notarization ticket stapled to $(basename "$dmg")"
  pass "notarization ticket stapled"
  local assessment
  assessment="$(spctl --assess --type open --context context:primary-signature -vvv "$dmg" 2>&1 || true)"
  grep -q 'accepted' <<<"$assessment" || fail "Gatekeeper rejects the disk image:
$assessment"
  pass "Gatekeeper accepts the disk image"
}

verify_app() {
  local want="$1" app="$2"
  [ -d "$app" ] || fail "no such app bundle: $app"

  # codesign writes its report to stderr; capture both so it can be grepped.
  local signature entitlements
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

  local key
  for key in com.apple.security.cs.allow-jit \
             com.apple.security.cs.allow-unsigned-executable-memory \
             com.apple.security.cs.allow-dyld-environment-variables \
             com.apple.security.cs.disable-library-validation; do
    grep -q "$key" <<<"$entitlements" || fail "entitlement not embedded: $key"
  done
  pass "all four hardened-runtime entitlements are embedded"

  if [ "$want" = dev ]; then
    # The developer path is honest about what it is: ad-hoc, no ticket, and
    # trusted by exactly one Mac. See docs/macos-signing.md.
    grep -q 'Signature=adhoc' <<<"$signature" \
      || fail "expected an ad-hoc signature; this build was signed with an identity"
    pass "ad-hoc signature, as a developer build should be"
    return
  fi

  grep -q 'Authority=Developer ID Application' <<<"$signature" \
    || fail "not signed with a Developer ID Application certificate"
  pass "signed with Developer ID Application"

  if grep -q 'Signature=adhoc' <<<"$signature"; then
    fail "this is an ad-hoc signature, not a releasable one"
  fi
  pass "not ad-hoc"

  # This is what lets the app launch on a Mac that has never seen it, offline.
  xcrun stapler validate "$app" >/dev/null 2>&1 \
    || fail "no notarization ticket stapled to the app"
  pass "notarization ticket stapled"

  local assessment
  assessment="$(spctl --assess --type exec -vvv "$app" 2>&1 || true)"
  grep -q 'accepted' <<<"$assessment" || fail "Gatekeeper rejects the app:
$assessment"
  grep -q 'source=Notarized Developer ID' <<<"$assessment" \
    || fail "Gatekeeper accepts the app, but not as notarized:
$assessment"
  pass "Gatekeeper: accepted, source=Notarized Developer ID"
}

case "$mode" in
  dev|release)
    [ "$#" -eq 1 ] || usage
    verify_app "$mode" "$1"
    ;;
  dmg)
    for image in "$@"; do verify_dmg "$image"; done
    ;;
  *)
    echo "mode must be dev, release or dmg, got: $mode" >&2
    exit 2
    ;;
esac

echo "==> all checks passed ($mode)"
