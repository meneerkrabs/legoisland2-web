#!/usr/bin/env node
// Looks for the LDraw part of every game brick BY MEASUREMENT (no names): all library parts whose sorted bounding-box dimensions are within 0.12 of the game's LOD 0 are fitted (best of 24 rotations, flat
// undersides ignored), the best 3 are built (brickmesh.mjs) and verified on the BUILT LOD 0 against the game's LOD 0 (bbox per axis, symmetric surface distance). Output: <WORK>/brick-search.json
// (per brick: the top candidates with their numbers); `brickmap.mjs` is written from it (by hand for the compound bricks).
//   node tools/lego3d/brick-search.mjs [--part i/n] [--only a,b]
import fs from 'node:fs';
import path from 'node:path';
import { LDrawLib } from './ldraw.mjs';
import { LDRAW, WORK, archive } from './lib.mjs';
import { gameBrick, fitToGame, isVerified, S } from './brickfit.mjs';
import { buildBrickAll } from './brickbuild.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const part = opt('--part', '0/1').split('/').map(Number), only = opt('--only', '') ? opt('--only', '').split(',') : null;
const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
const dir = path.join(LDRAW, 'lib/ldraw/parts');

// ---- index of the library (title + bbox of every plausible part), cached
const cache = path.join(WORK, 'ldindex.json');
if (!fs.existsSync(cache)) {
  const out = {};
  const skipT = /sticker|duplo|belville|scala|fabuland|primo|minifig|pov-ray|znap|electric|string|ribbon|hair|torso|helmet|figure|animal|plant|flag|paper|cloth|capacitor|bionicle|clikits|pattern|decorated/i;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.dat')) continue;
    const title = (fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/)[0] || '').slice(2).trim();
    if (/^[_=|]/.test(title) || /^~Moved/.test(title) || skipT.test(title) || /^\d+[a-z]*(p[0-9a-z]{2,3}|pr\d+|ps\d+|d\d+)\.dat$/i.test(f)) continue;
    try {
      const r = lib.flatten(f, { res: 'std' });
      if (!r.tris.length) continue;
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (let i = 0; i < r.tris.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], r.tris[i + c]); hi[c] = Math.max(hi[c], r.tris[i + c]); }
      out[f] = { title, lo, hi };
    } catch { /* unreadable part */ }
  }
  fs.writeFileSync(cache, JSON.stringify(out));
}
const index = JSON.parse(fs.readFileSync(cache, 'utf8'));

const a = archive('Bricks');
const txt = new TextDecoder('latin1').decode(a.read(a.find('brickset.txt')));
const names = txt.split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter((t) => t.length >= 7).map((t) => t[0]);
const res = {};
let ni = -1;
for (const name of names) {
  if (only && !only.includes(name)) continue;
  ni++;
  if (ni % part[1] !== part[0]) continue;
  const ref = gameBrick(a, name, 0);
  if (!ref) continue;
  if (ref.vertexCount <= 24) { res[name] = { slab: true }; continue; }
  const rd = [...ref.box.size].sort((x, y) => x - y), cands = [];
  for (const [f, i] of Object.entries(index)) {
    const sz = [0, 1, 2].map((c) => (i.hi[c] - i.lo[c]) * S).sort((x, y) => x - y);
    if (sz.some((v, k) => Math.abs(v - rd[k]) > 0.12)) continue;
    const fit = fitToGame(lib.flatten(f, { res: 'std' }).tris, ref, { n: 500 });
    if (fit) cands.push({ part: f.replace(/\.dat$/, ''), title: index[f].title, fit: +fit.dev.mean.toFixed(4), box: +fit.boxErr.toFixed(3), rot: fit.rot });
  }
  cands.sort((x, y) => x.fit - y.fit);
  for (const c of cands.slice(0, 8)) {
    try {
      const r = buildBrickAll(lib, a, name, [c.part], { lods: [0] });
      if (!r.lods) { c.built = { error: r.row.status }; continue; }
      const m = r.ms[0];
      c.built = { box: +m.boxErr.toFixed(3), mean: +m.dev.mean.toFixed(4), p95: +m.dev.p95.toFixed(3), far: +m.dev.far.toFixed(3), max: +m.dev.max.toFixed(3), tris: r.lods[0].tris, verts: r.lods[0].pos.length / 3, twoColour: r.row.twoColour, ok: isVerified({ boxErr: m.boxErr, dev: m.dev }) };
    } catch (e) { c.built = { error: String(e.message ?? e) }; }
  }
  const builtOnes = cands.filter((c) => c.built?.mean !== undefined).sort((x, y) => x.built.mean - y.built.mean).concat(cands.filter((c) => c.built?.mean === undefined));
  cands.splice(0, cands.length, ...builtOnes);
  res[name] = { ref: ref.box.size.map((v) => +v.toFixed(3)), game: `${ref.vertexCount}v/${ref.triCount}t`, nCands: cands.length, top: cands.slice(0, 5) };
  const b = cands[0]?.built;
  console.log(name.padEnd(26), cands.slice(0, 3).map((o) => `${o.part}(${o.fit}${o.built?.mean !== undefined ? `/${o.built.mean}` : ''}${o.built?.ok ? '*' : ''})`).join(' '), b ? `${b.tris}t vs ${ref.triCount}` : '');
}
fs.writeFileSync(path.join(WORK, `brick-search-${part[0]}.json`), JSON.stringify(res, null, 1));
