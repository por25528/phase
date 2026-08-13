#!/usr/bin/env bash
# Generate the monochrome menu-bar template images from build/phase-tray.svg.
# Uses only macOS-native tools: qlmanage (SVG raster) and sips (resize).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE="$PROJECT_DIR/build/phase-tray.svg"
ASSET_DIR="$PROJECT_DIR/electron/assets"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

mkdir -p "$ASSET_DIR"
qlmanage -t -s 36 -o "$WORK_DIR" "$SOURCE" >/dev/null 2>&1
RAW="$WORK_DIR/$(basename "$SOURCE").png"
test -f "$RAW"
sips -z 18 18 "$RAW" --out "$ASSET_DIR/phaseTemplate.png" >/dev/null
sips -z 36 36 "$RAW" --out "$ASSET_DIR/phaseTemplate@2x.png" >/dev/null
