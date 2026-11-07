#!/bin/sh
# Runs tools/steps/qa-cutscenes.mjs over the zones for one LEGO 3D setting: sh tools/qa-cut-queue.sh <lego3d 0|1> <port> [job ...]   (job = zone or zone:node, default list below)
# output: /tmp/qa-cut/<job>-l<v>/*.png and /tmp/qa-cut/<job>-l<v>.log (the QA lines: node tools/qa-cut-summary.mjs <log>)
V=$1; PORT=$2; shift 2
JOBS=${*:-"z02LGI z02LGI:7 z02LGI:30 z02LGI:52 z02LGI:61 z07CSI z14OSD z16PYA z21FSH z23DIP z28HAT z40aPO z40OGL z42BRP"}
cd "$(dirname "$0")/.."
for J in $JOBS; do
  Z=${J%%:*}; N=${J#*:}; Q=""; T=$Z; [ "$N" != "$J" ] && { Q="&node=$N"; T="$Z-n$N"; }
  D=/tmp/qa-cut/$T-l$V; mkdir -p "$D"
  EVERY=${EVERY:-4} MAXSHOTS=${MAXSHOTS:-8} sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:$PORT/?zone=$Z&hold=1&lego3d=$V$Q" tools/steps/qa-cutscenes.mjs --size 480x360 --out "$D" > "$D.log" 2>&1
  echo "$T l3d=$V done: $(grep -c '^QA' "$D.log") scripts" >> /tmp/qa-cut/queue-$V.status
done
echo ALLDONE >> /tmp/qa-cut/queue-$V.status
