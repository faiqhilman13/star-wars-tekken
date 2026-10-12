#!/usr/bin/env bash
# VEXA full rebuild (headless, deterministic). Run from the repo root: bash art/characters/vexa/build/build.sh [stage]
set -e
R=tools/blender/run.py
C=vexa
stage=${1:-all}
if [[ $stage == all || $stage == base ]]; then
  python $R tools/blender/vroid_fit.py -- --char $C
  python $R art/characters/asha/build/a1b_prep.py -- --char $C
  python $R tools/blender/vroid_finish.py -- --char $C
fi
if [[ $stage == all || $stage == costume ]]; then
  python $R art/characters/$C/build/a2_costume.py -- --char $C
fi
if [[ $stage == all || $stage == export ]]; then
  python $R tools/blender/vroid_export.py -- --char $C --master art/characters/$C/${C}_master.blend
  mkdir -p art/characters/$C/review/a3_export
  python tools/blender/sd_glb_check.py public/models/$C.glb --char $C --json art/characters/$C/review/a3_export/glb_check.json > /dev/null && echo "glb_check PASS"
fi
