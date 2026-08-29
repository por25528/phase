#!/usr/bin/env bash
# Notarize and staple the DMGs themselves.
#
# electron-builder notarizes and staples the .app, so the copy a user drags to
# /Applications is already trusted offline. The disk image around it is not, and
# Gatekeeper assesses the DMG too — a user who downloads it before it is
# notarized gets a warning on the very first double-click. This closes that gap.
#
# Credentials come from the environment and are passed as arguments to
# notarytool only. Nothing here echoes them, and `set -x` is deliberately absent.

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: notarize-dmg.sh <dmg> [dmg...]" >&2
  exit 2
fi

method="${PHASE_NOTARY_METHOD:-api-key}"

case "$method" in
  api-key)
    : "${APPLE_API_KEY:?APPLE_API_KEY (path to the .p8) is not set}"
    : "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID is not set}"
    : "${APPLE_API_ISSUER:?APPLE_API_ISSUER is not set}"
    creds=(--key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER")
    ;;
  apple-id)
    : "${APPLE_ID:?APPLE_ID is not set}"
    : "${APPLE_APP_SPECIFIC_PASSWORD:?APPLE_APP_SPECIFIC_PASSWORD is not set}"
    : "${APPLE_TEAM_ID:?APPLE_TEAM_ID is not set}"
    creds=(--apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID")
    ;;
  *)
    echo "PHASE_NOTARY_METHOD must be api-key or apple-id, got: $method" >&2
    exit 2
    ;;
esac

for dmg in "$@"; do
  [ -f "$dmg" ] || { echo "no such disk image: $dmg" >&2; exit 1; }
  echo "==> notarizing $(basename "$dmg") via $method"
  # --wait blocks until Apple accepts or rejects; a rejection is a non-zero exit
  # and the release stops here rather than shipping an unstapled image.
  xcrun notarytool submit "$dmg" "${creds[@]}" --wait --timeout 30m
  echo "==> stapling $(basename "$dmg")"
  xcrun stapler staple "$dmg"
done
