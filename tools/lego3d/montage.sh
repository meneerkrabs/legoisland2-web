#!/bin/sh
# sh tools/lego3d/montage.sh out.png cols in1.png in2.png ...
d=$(dirname "$0")
exec /Applications/Blender.app/Contents/MacOS/Blender -b -P "$d/blender/montage.py" -- "$@" 2>&1 | grep -i -E "error|Traceback" 
