#!/usr/bin/env node
// QA sheets for the brick library: per brick the game's LOD (blue) next to the replacement (orange, back-face culled; magenta = back faces would show) from two sides, 2 bricks per row.
//   node tools/lego3d/brick-sheets.mjs OUTPREFIX name:part[+glass] ...        (candidates built on the fly, like brick-search.mjs)
//   node tools/lego3d/brick-sheets.mjs --lod 1 ...                              (the LOD 1 meshes against the game's LOD 1)
import path from 'node:path';
import { LDrawLib } from './ldraw.mjs';
import { LDRAW, archive } from './lib.mjs';
import { buildBrickAll, parseFlags } from './brickbuild.mjs';
import { render, sheet, soup, boundsOf } from './qa-raster.mjs';

const args = process.argv.slice(2);
const lodI = args.indexOf('--lod'), LOD = lodI >= 0 ? +args[lodI + 1] : 0;
if (lodI >= 0) args.splice(lodI, 2);
const szI = args.indexOf('--size'), SZ = szI >= 0 ? +args[szI + 1] : 140;
if (szI >= 0) args.splice(szI, 2);
const [prefix, ...items] = args;
const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw')), a = archive('Bricks');
const cells = [];
for (const it of items) {
  // name:part[+part][|flag,flag]   flags: trans (glass = second colour), fit (per-axis fit to the game's box), b0=<x> b1=<x> (triangle budgets as multiples of the game's, 0 = none)
  const [head, flags = ''] = it.split('|'), [name, part] = head.split(':'), parts = part.split('+'), fl = flags.split(',').filter(Boolean);
  const o = { lods: [0, ...(LOD ? [LOD] : [])], ...parseFlags(flags) };
  const r = buildBrickAll(lib, a, name, parts, o);
  if (!r.lods) { console.log(`${name}:${part}\t${r.row.status}`); continue; }
  const L = r.lods[LOD], ref = r.refs[LOD], m = r.ms[LOD];
  console.log(`${name}:${part}\tbox ${m.boxErr.toFixed(3)} mean ${m.dev.mean.toFixed(4)} far ${(m.dev.far * 100).toFixed(1)}% ${L.tris}t (game ${ref.triCount}t) split ${L.split}/${L.pos.length / 3} studs ${r.row.studs ? `${r.row.studs.nNew}/${r.row.studs.nGame} worst ${r.row.studs.worst.toFixed(2)}` : '-'}${r.row.twoColour ? ' two-colour ' + r.row.colourMap : ''}`);
  const mineA = { tris: soup(L.pos, L.idx), colour: [255, 190, 90] }, b = boundsOf([{ tris: ref.tris }, mineA]);
  const g = { tris: ref.tris, colour: [110, 170, 255] };
  // two-colour: the first-colour vertices orange, the rest teal (the engine's split)
  const sp = L.split, tri1 = [], tri2 = [];
  for (let t = 0; t < L.idx.length; t += 3) { const dst = L.idx[t] >= sp ? tri2 : tri1; for (let k = 0; k < 3; k++) dst.push(L.pos[L.idx[t + k] * 3], L.pos[L.idx[t + k] * 3 + 1], L.pos[L.idx[t + k] * 3 + 2]); }
  const mine = [{ tris: Float32Array.from(tri1), colour: [255, 190, 90] }, { tris: Float32Array.from(tri2), colour: [90, 220, 200] }];
  const gm = ref.firstTris ? [{ tris: ref.firstTris, colour: [110, 170, 255] }, { tris: ref.secondTris, colour: [255, 120, 160] }] : [g];
  cells.push([render(gm, { yaw: 35, pitch: 30, size: SZ, bounds: b }), render(mine, { yaw: 35, pitch: 30, size: SZ, cull: true, bounds: b }), render(gm, { yaw: 215, pitch: 30, size: SZ, bounds: b }), render(mine, { yaw: 215, pitch: 30, size: SZ, cull: true, bounds: b })]);
}
const per = 24;
for (let s = 0; s * per < cells.length; s++) {
  const rows = [];
  for (let i = s * per; i < Math.min(cells.length, (s + 1) * per); i += 2) rows.push([...cells[i], ...(cells[i + 1] ?? [])]);
  sheet(`${prefix}-${s}.png`, rows);
  console.log(`sheet ${s}: ${items.slice(s * per, (s + 1) * per).map((x) => x.split(':')[0]).join(' ')}`);
}
