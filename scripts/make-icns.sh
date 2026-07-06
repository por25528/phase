#!/usr/bin/env bash
# Generate build/icon.icns and build/icon.png from build/icon.svg
# Uses only macOS-native tools: qlmanage (SVG raster), sips (resize), iconutil.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SVG="$ROOT/build/icon.svg"
OUT_PNG="$ROOT/build/icon.png"
OUT_ICNS="$ROOT/build/icon.icns"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ Rasterizing SVG at 1024px via QuickLook…"
qlmanage -t -s 1024 -o "$TMP" "$SVG" >/dev/null 2>&1
RAW="$TMP/$(basename "$SVG").png"
[ -f "$RAW" ] || { echo "qlmanage failed to produce a PNG"; exit 1; }

# Normalize to an exact 1024x1024 master (QuickLook can pad/round).
sips -z 1024 1024 "$RAW" --out "$OUT_PNG" >/dev/null

echo "→ Building .iconset…"
ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  x2=$((size * 2))
  sips -z "$size" "$size" "$OUT_PNG" --out "$ICONSET/icon_${size}x${size}.png"    >/dev/null
  sips -z "$x2"   "$x2"   "$OUT_PNG" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done

echo "→ Packing .icns…"
iconutil -c icns "$ICONSET" -o "$OUT_ICNS"

echo "✓ Wrote $OUT_ICNS and $OUT_PNG"
