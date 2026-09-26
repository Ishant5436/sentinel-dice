#!/usr/bin/env bash
# Bloom + title for the Blender cover render. Writes public/og-image.png (1200x630).
# Usage: scripts/blender/finish_cover.sh <cover-raw.png>
set -euo pipefail

RAW="${1:?usage: finish_cover.sh <cover-raw.png>}"
OUT="$(cd "$(dirname "$0")/../.." && pwd)/public/og-image.png"
FONTS=/System/Library/Fonts/Supplemental
TITLE_FONT="$FONTS/DIN Condensed Bold.ttf"
BODY_FONT="$FONTS/DIN Alternate Bold.ttf"

magick "$RAW" \
  \( +clone -level 55%,100% -blur 0x10 \) -compose screen -composite \
  \( -size 1300x760 -define gradient:radii=620,360 radial-gradient:'rgba(8,6,15,0.88)'-'rgba(8,6,15,0)' \) -gravity NorthWest -geometry -400-230 -compose over -composite \
  -gravity NorthWest \
  -font "$TITLE_FONT" -fill '#ffab4d' -pointsize 34 -kerning 6 -annotate +62+58 'GRAVITY SLINGSHOT' \
  -font "$TITLE_FONT" -fill '#efeaff' -pointsize 118 -kerning 2 -annotate +58+92 'GRAND TOUR' \
  -font "$BODY_FONT" -fill '#b9b3da' -pointsize 25 -kerning 0 -annotate +62+222 'Four gravity assists. Bank any time.' \
  -font "$BODY_FONT" -fill '#b9b3da' -pointsize 25 -annotate +62+254 '98% RTP on every route.' \
  -font "$TITLE_FONT" -fill '#bf8cff' -pointsize 40 -kerning 3 -annotate +62+300 'UP TO 1003.52x' \
  -resize 1200x630! "$OUT"

echo "wrote $OUT ($(magick identify -format '%wx%h' "$OUT"), $(wc -c < "$OUT") bytes)"
