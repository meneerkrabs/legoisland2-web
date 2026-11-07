#!/bin/sh
# Contact sheet of the frames of one cutscene (tools/steps/qa-cutscenes.mjs): sh tools/qa-cut-sheet.sh <dir> <script> <out.png> [columns]
# (ffmpeg tile filter; the frames are <dir>/<script>-NN.png)
D=$1; S=$2; O=$3; C=${4:-4}
N=$(ls "$D"/"$S"-[0-9][0-9].png 2>/dev/null | wc -l | tr -d ' ')
[ "$N" -gt 0 ] || { echo "no frames $D/$S-NN.png"; exit 1; }
R=$(( (N + C - 1) / C ))
ffmpeg -v error -y -framerate 1 -i "$D/$S-%02d.png" -vf "tile=${C}x${R}:padding=2:color=0x303030" -frames:v 1 "$O"
echo "$O ($N frames)"
