#!/usr/bin/env node
// Restore audit (section 9): numbering holes of every speech-name series (PREFIX + 2 digits) in the speech table and the speech mp3 directory.
//   node --experimental-strip-types tools/research/restore/scan-gaps.mjs
import fs from 'node:fs';
const table = fs.readFileSync('/tmp/le2-unused/speech-table.tsv', 'latin1').split('\n').map((l) => l.split('\t')[1]).filter(Boolean);
const files = fs.readdirSync('/Users/sander/Documents/legoeiland2-extract/game/Game/_data/sounds/speech/Data').map((f) => f.replace(/\.[^.]+$/, ''));
const series = (names) => { const m = new Map(); for (const n of names) { const x = /^([A-Z]+)(\d+)([A-Z_ ]*)$/i.exec(n); if (!x) continue; const k = x[1].toUpperCase(); (m.get(k) ?? m.set(k, []).get(k)).push(+x[2]); } return m; };
const T = series(table), F = series(files);
for (const [k, v] of [...T].sort()) {
  const s = new Set(v), max = Math.max(...v), min = Math.min(...v), holes = [];
  for (let i = min; i <= max; i++) if (!s.has(i)) holes.push(i);
  const fs_ = F.get(k) ?? [], extra = [...new Set(fs_)].filter((i) => !s.has(i));
  if (holes.length || extra.length) console.log(k.padEnd(8), `range ${min}-${max}`, holes.length ? `table holes: ${holes.join(',')}` : '', extra.length ? `files-not-in-table: ${extra.join(',')}` : '');
}
