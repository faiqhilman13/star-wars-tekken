#!/usr/bin/env bash
# quick toon review of the costume master: bash art/characters/asha/build/review.sh <outdir> [shots]
C=vexa
OUT=${1:-art/characters/$C/review/a2_costume}
SHOTS=${2:-body}
python tools/blender/run.py tools/blender/sd_review.py -- --blend art/characters/$C/${C}_master.blend --out $OUT --shots $SHOTS --toon 2>&1 | grep -E "Error|Traceback"
python tools/blender/sd_sheet.py --out $OUT/sheet_body.png --cols 5 --height 760 $OUT/body_front.png $OUT/body_threequarter.png $OUT/body_side.png $OUT/body_back.png $OUT/body_far_side.png 2>/dev/null | tail -1
