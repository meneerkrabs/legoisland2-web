#!/bin/sh
# usage: transcribe-orphans.sh <model.bin> <outdir> [orphans.txt]
# Converts every orphan speech mp3 to 16 kHz mono wav (scratch in /tmp) and runs whisper-cli (-l nl, full JSON).
M="$1"; OUT="$2"; LIST="${3:-/tmp/le2-restore/orphans.txt}"
D="/Users/sander/Documents/legoeiland2-extract/game/Game/_data/sounds/speech/Data"
W=/tmp/le2-restore/wav; mkdir -p "$W" "$OUT"
PROMPT="Pepper Roni, Lego Eiland, Dondersteen, Brickster, Infomaniac, Valérie, Dr. Pepper, pizza, skateboard, brickbots."
while IFS= read -r f; do
  b=$(basename "$f" .mp3 | tr ' ' '_')
  [ -f "$W/$b.wav" ] || ffmpeg -loglevel error -y -i "$D/$f" -ar 16000 -ac 1 "$W/$b.wav"
  [ -f "$OUT/$b.json" ] || whisper-cli -m "$M" -l nl -nt -np -ojf -of "$OUT/$b" --prompt "$PROMPT" -f "$W/$b.wav" >/dev/null 2>&1
done < "$LIST"  # note: list must end with a newline
