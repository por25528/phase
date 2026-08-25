#!/usr/bin/env bash
# Generate the monochrome menu-bar template images from build/phase-tray.svg.
# Uses only macOS-native tools: qlmanage (SVG raster) and a Swift/ImageIO
# post-processor (maskize) that turns the opaque white document page into a
# real template mask (neutral black RGB, alpha from inverse luminance),
# preserving the antialiased silhouette. qlmanage's SVG thumbnail is degenerate
# — whatever -s is requested the glyph rasterizes to a few pixels in the page
# corner — so maskize crops the non-white content bounds and scales the crop
# aspect-fit into each target with quiet even padding. Every failure aborts the
# script with a non-zero exit.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE="$PROJECT_DIR/build/phase-tray.svg"
ASSET_DIR="$PROJECT_DIR/electron/assets"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

if ! command -v swift >/dev/null 2>&1; then
  echo "make-tray-icon: swift (needed by maskize) not found" >&2
  exit 1
fi

mkdir -p "$ASSET_DIR"
qlmanage -t -s 288 -o "$WORK_DIR" "$SOURCE" >/dev/null 2>&1
RAW="$WORK_DIR/$(basename "$SOURCE").png"
test -f "$RAW"

swift "$SCRIPT_DIR/maskize.swift" "$RAW" "$WORK_DIR/tray-18-mask.png" 18 18
mv "$WORK_DIR/tray-18-mask.png" "$ASSET_DIR/phaseTemplate.png"

swift "$SCRIPT_DIR/maskize.swift" "$RAW" "$WORK_DIR/tray-36-mask.png" 36 36
mv "$WORK_DIR/tray-36-mask.png" "$ASSET_DIR/phaseTemplate@2x.png"
