#!/usr/bin/env bash
# Rebuild game assets: textures -> Blender gym -> compressed GLBs.
# Needs: python3 with numpy+Pillow, the bpy module (pip install bpy) at $BPY_PYTHON,
# and node with @gltf-transform/{core,extensions,functions}, meshoptimizer, sharp.
set -euo pipefail
cd "$(dirname "$0")/.."
BPY_PYTHON=${BPY_PYTHON:-python3}
NODE_TOOLS=${NODE_TOOLS:-.}
TMP=$(mktemp -d)
python3 tools/make_textures.py "$TMP/tex"
"$BPY_PYTHON" tools/build_gym.py "$TMP/tex" "$TMP/gym_raw.glb"
NODE_PATH="$NODE_TOOLS/node_modules" node tools/optimize.mjs "$TMP/gym_raw.glb" assets/gym.glb 1024
if [ -n "${HERO_SRC:-}" ]; then
  NODE_PATH="$NODE_TOOLS/node_modules" node tools/optimize.mjs "$HERO_SRC" assets/hero.glb 1024 '^Color$' 2048
fi
rm -rf "$TMP"
