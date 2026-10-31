#!/bin/sh
# Builds the whole pilot mod folder (default ~/Documents/legoeiland2-extract/mods/lego3d-pilot): Pepper, jet ski, bricks, textures, attribution. Needs the game folder, the LDraw library in
# ~/Documents/legoeiland2-extract/ldraw (docs/re/lego3d.md section 3) and Blender (/Applications/Blender.app) for the textures.
set -e
cd "$(dirname "$0")/../.."
MOD=${1:-$HOME/Documents/legoeiland2-extract/mods/lego3d-pilot}
mkdir -p "$MOD"
cat > "$MOD/info.txt" <<'INFO'
LEGO 3D Pilot
tools/lego3d (pilot)
Pilot of a LEGO-model look: Pepper as an LDraw minifig (body, head, hands), the island's jet ski from the official LDraw model of set 6415, 14 bricks of the brick library, 10 stud / brick-wall textures rendered in Blender. Geometry derived from the LDraw.org Parts Library (CC BY 2.0 / 4.0, see ATTRIBUTION.txt). Needs the Dutch game data.
INFO
node tools/lego3d/pepper.mjs --mod "$MOD"
node tools/lego3d/jetski.mjs --mod "$MOD"
node tools/lego3d/bricks.mjs --mod "$MOD"
node tools/lego3d/textures.mjs --mod "$MOD" "${NORMALS:+--normals}"
node tools/lego3d/studs.mjs --mod "$MOD"
node tools/lego3d/attribution.mjs --mod "$MOD"
