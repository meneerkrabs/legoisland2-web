#!/bin/sh
# Serve a SNAPSHOT of the repo (src, index.html, configs) on port 5497 with a private Vite (no watcher, no HMR) so that long headless bot runs are not disturbed
# by edits of other people / workers: sh tools/m4-snapshot-server.sh [port]. Stop it with: pkill -f m4snap-<port>
set -e
PORT=${1:-5497}
SRC="$(cd "$(dirname "$0")/.." && pwd)"
SNAP=/tmp/m4snap-$PORT
pkill -f "m4snap-$PORT" 2>/dev/null || true; sleep 1
rm -rf "$SNAP"; mkdir -p "$SNAP"
cp -R "$SRC/src" "$SRC/index.html" "$SRC/package.json" "$SRC/tsconfig.json" "$SRC/vite.config.ts" "$SNAP/"
ln -s "$SRC/node_modules" "$SNAP/node_modules"
mkdir -p "$SNAP/public"; ln -s "$SRC/public/data" "$SNAP/public/data"
cat > "$SNAP/vite.snap.config.mjs" <<EOT
import base from './vite.config.ts';
export default { ...base, root: '$SNAP', cacheDir: '$SNAP/.cache', server: { port: $PORT, strictPort: true, hmr: false, watch: null } };
EOT
cd "$SNAP"
nohup npx vite --config vite.snap.config.mjs > "$SNAP/server.log" 2>&1 &
sleep 4
curl -sI "http://localhost:$PORT/" | head -1
