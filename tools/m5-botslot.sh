#!/bin/sh
# Run a command while holding one of two browser-bot slots (at most two headless bots at a time on this machine): sh tools/m5-botslot.sh <command...>
# Waits (polls) until a slot is free; stale slots (owner pid dead) are taken over.
while :; do
  for n in 1 2; do
    d=/tmp/m5-botslot-$n
    if mkdir "$d" 2>/dev/null; then echo $$ > "$d/pid"; trap 'rm -rf "$d"' EXIT INT TERM; "$@"; rc=$?; exit $rc; fi
    p=$(cat "$d/pid" 2>/dev/null); if [ -n "$p" ] && ! kill -0 "$p" 2>/dev/null; then rm -rf "$d"; fi
  done
  sleep 5
done
