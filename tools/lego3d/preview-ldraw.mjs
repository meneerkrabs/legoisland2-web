#!/usr/bin/env node
// node tools/lego3d/preview-ldraw.mjs <name> <views> <part.dat[@x,y,z[@m0..m8]]>...  : renders LDraw parts (with their LDraw colour) through headless Blender (axes mapped like the game: p = (-x, -y, -z))
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { LDrawLib } from './ldraw.mjs';
import { LDRAW, WORK } from './lib.mjs';
const [name, views, ...specs] = process.argv.slice(2);
const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
const CC = { 0: [0.1, 0.1, 0.1], 1: [0.1, 0.3, 0.8], 2: [0.1, 0.6, 0.2], 4: [0.8, 0.1, 0.1], 14: [0.95, 0.8, 0.1], 15: [0.95, 0.95, 0.95], 16: [0.7, 0.7, 0.7], 7: [0.6, 0.6, 0.6], 72: [0.4, 0.4, 0.4], 25: [0.9, 0.4, 0.1], 71: [0.65, 0.65, 0.65] };
const parts = [];
for (const spec of specs) {
  const [file, pos, mat] = spec.split('@');
  const p = (pos ?? '0,0,0').split(',').map(Number);
  const m = (mat ?? '1,0,0,0,1,0,0,0,1').split(',').map(Number);
  const r = lib.flatten(file, { res: process.env.RES ?? 'std', matrix: [...m, ...p] });
  const n = r.tris.length / 3;
  const pos3 = new Float32Array(r.tris.length), idx = [];
  for (let i = 0; i < n; i++) { pos3[i * 3] = -r.tris[i * 3]; pos3[i * 3 + 1] = -r.tris[i * 3 + 1]; pos3[i * 3 + 2] = -r.tris[i * 3 + 2]; }
  const groups = []; const byCol = new Map();
  for (let t = 0; t < n / 3; t++) { const c = r.colors[t]; if (!byCol.has(c)) byCol.set(c, []); byCol.get(c).push(t); }
  let first = 0;
  for (const [c, ts] of byCol) { for (const t of ts) idx.push(t * 3, t * 3 + 2, t * 3 + 1); groups.push({ first, count: ts.length * 3, tex: null, color: CC[c] ?? [0.5, 0.5, 0.5] }); first += ts.length * 3; }
  parts.push({ name: file, positions: Array.from(pos3), uvs: [], indices: idx, groups });
}
const dir = path.join(WORK, 'preview', name); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify({ parts, light: 'STUDIO' }));
execFileSync('/Applications/Blender.app/Contents/MacOS/Blender', ['-b', '-P', path.join(path.dirname(new URL(import.meta.url).pathname), 'blender/preview.py'), '--', path.join(dir, 'scene.json'), path.join(WORK, 'preview', name), ...views.split(',')], { stdio: ['ignore', 'ignore', 'inherit'] });
console.log('wrote', path.join(WORK, 'preview', name) + '_*.png');
