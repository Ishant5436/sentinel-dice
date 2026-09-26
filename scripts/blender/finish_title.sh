#!/usr/bin/env bash
# Bloom for the text-free title-screen backdrop. Writes public/title-bg.webp.
# Usage: blender -b --python scripts/blender/render_cover.py -- <title-raw.png> 200
#        scripts/blender/finish_title.sh <title-raw.png>
set -euo pipefail

RAW="${1:?usage: finish_title.sh <title-raw.png>}"
OUT="$(cd "$(dirname "$0")/../.." && pwd)/public/title-bg.webp"

magick "$RAW" \
  \( +clone -level 55%,100% -blur 0x18 \) -compose screen -composite \
  -quality 82 -define webp:method=6 "$OUT"

echo "wrote $OUT ($(magick identify -format '%wx%h' "$OUT"), $(wc -c < "$OUT") bytes)"
