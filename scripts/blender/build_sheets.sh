#!/usr/bin/env bash
# Pack Blender spin frames into 6x6 WebP sprite sheets for TourCanvas.
# Usage: scripts/blender/build_sheets.sh <render_dir> [body ...]   (render_dir = out_dir given to render_bodies.py)
# With no body names, packs all eight. Needs ImageMagick (magick) and cwebp.
set -euo pipefail

RENDER_DIR="${1:?usage: build_sheets.sh <render_dir> [body ...]}"
OUT_DIR="$(cd "$(dirname "$0")/../.." && pwd)/public/sprites"
mkdir -p "$OUT_DIR"
shift
BODIES=("$@")
[ "${#BODIES[@]}" -gt 0 ] || BODIES=(moon jupiter pulsar blackhole comet neptune saturn redgiant)

for body in "${BODIES[@]}"; do
  frames=("$RENDER_DIR/$body"/f*.png)
  if [ "${#frames[@]}" -ne 36 ]; then
    echo "expected 36 frames for $body, found ${#frames[@]}" >&2
    exit 1
  fi
  sheet="$RENDER_DIR/$body-sheet.png"
  rows=()
  for start in 0 6 12 18 24 30; do
    rows+=("(" "${frames[@]:$start:6}" "+append" ")")
  done
  magick -background none "${rows[@]}" -append "$sheet"
  cwebp -quiet -q 88 -alpha_q 95 "$sheet" -o "$OUT_DIR/$body.webp"
  echo "$body: $(magick identify -format '%wx%h' "$sheet") -> $OUT_DIR/$body.webp ($(wc -c < "$OUT_DIR/$body.webp") bytes)"
done
