#!/bin/sh
D="/Users/sander/Documents/legoeiland2-extract/game/Game/_data/sounds/speech/Data"
: > out.tsv
while IFS= read -r f; do
  ffmpeg -loglevel error -y -i "$D/$f" -ar 16000 -ac 1 /tmp/le2-unused/whisper/t.wav
  t=$(whisper-cli -m ggml-small.bin -l nl -nt -np -f /tmp/le2-unused/whisper/t.wav 2>/dev/null | tr '\n' ' ' | sed 's/  */ /g')
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$D/$f")
  printf '%s\t%s\t%s\n' "$f" "$dur" "$t" >> out.tsv
done < orphans.txt
echo done > run.done
