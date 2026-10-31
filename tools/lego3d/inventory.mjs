#!/usr/bin/env node
// Inventory of the LEGO-like content of the game (docs/re/lego3d.md): every mesh of every archive (10,731 files) classified, scored for stud geometry, minifig parts measured against the LDraw
// parts they would be replaced with. Output: $LE2_LEGO3D/inventory/meshes.json (+ summary on stdout). Reads the user's own game folder only.
//   node tools/lego3d/inventory.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { archive, archiveNames, scene, WORK } from './lib.mjs';
import { parseMsh } from '../../src/formats/msh.ts';
import { parseSvwl } from '../../src/formats/anim.ts';

const OUT = path.join(WORK, 'inventory'); fs.mkdirSync(OUT, { recursive: true });
const STUD_R = 0.24, PITCH = 0.8;

/** stud score: vertices on a ring of the stud radius around a point of the 0.8 stud grid (4 grid offsets tried); a stud has at least 8 such vertices */
function studScore(pos) {
  let best = 0;
  for (const [ox, oz] of [[0, 0], [0.4, 0], [0, 0.4], [0.4, 0.4]]) {
    let n = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const dx = ((pos[i] - ox) % PITCH + PITCH * 1.5) % PITCH - PITCH / 2, dz = ((pos[i + 2] - oz) % PITCH + PITCH * 1.5) % PITCH - PITCH / 2;
      if (Math.abs(Math.hypot(dx, dz) - STUD_R) < 0.012) n++;
    }
    best = Math.max(best, n);
  }
  return best;
}
const SUFFIX = [
  ['hand', /^(r|l)hand\d*$/i], ['head', /head\d*$/i], ['hair', /hair\d*$/i], ['headgear', /^(hat|cap|tophat|crown|helmet|helm|visor|tutu)$/i],
  ['accessory', /^(bag|quiver|bow|arrow|hook|bugle|cape|cloak|skirt|meppe|leppe|reppe|body)$/i],
];
const classify = (archName, p, m, sv, bonesMax) => {
  const base = p.split('/').pop().replace(/\.msh$/i, '');
  if (archName === 'Bricks') return 'brick-library';
  const mm = base.match(/^(.*?)_(HR|MR|LR|SLR|BGR)(.*)$/);
  if (mm) {
    const s = mm[3];
    for (const [k, re] of SUFFIX) if (re.test(s)) return `minifig-${k}`;
    if (s === '' && sv && bonesMax < 17) return 'minifig-body';
    if (s === '' && sv) return 'creature-skinned';
    return 'lod-other';
  }
  if (sv) return bonesMax < 17 ? 'minifig-body' : 'creature-skinned';
  return 'other';
};

const rows = [];
const seen = new Map();
for (const an of archiveNames()) {
  const a = archive(an);
  for (const e of a.entries) {
    if (!/\.msh$/i.test(e.path)) continue;
    const bytes = a.read(e);
    const hash = crypto.createHash('md5').update(bytes).digest('hex').slice(0, 12);
    let m; try { m = parseMsh(bytes); } catch { continue; }
    let sv = null, bonesMax = -1;
    if (m.svwl) { sv = parseSvwl(m.svwl, m.vertexCount); for (let v = 0; v < m.vertexCount; v++) bonesMax = Math.max(bonesMax, sv.bone[v]); for (let i = 0; i < sv.extra.count; i++) bonesMax = Math.max(bonesMax, sv.extra.bone[i]); }
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let i = 0; i < m.positions.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], m.positions[i + c]); hi[c] = Math.max(hi[c], m.positions[i + c]); }
    const studs = m.vertexCount < 4000 && hi[0] - lo[0] < 40 ? studScore(m.positions) : 0;
    rows.push({ archive: an, path: e.path, hash, verts: m.vertexCount, tris: m.indices.length / 3, groups: m.groups.length, skinned: !!sv, bonesMax, size: hi.map((h, i) => +(h - lo[i]).toFixed(3)), studs, cat: classify(an, e.path, m, sv, bonesMax), dup: seen.has(hash) });
    seen.set(hash, true);
  }
}
fs.writeFileSync(path.join(OUT, 'meshes.json'), JSON.stringify(rows));
const sum = {};
for (const r of rows) { const s = (sum[r.cat] ??= { files: 0, unique: 0, tris: 0 }); s.files++; if (!r.dup) { s.unique++; s.tris += r.tris; } }
console.log('meshes', rows.length, 'unique by content', rows.filter((r) => !r.dup).length);
console.table(sum);
const studRows = rows.filter((r) => !r.dup && r.cat !== 'brick-library' && r.studs >= 8);
console.log('unique non-library meshes with stud geometry (>= 8 ring vertices):', studRows.length);
const byArch = {}; for (const r of studRows) byArch[r.archive] = (byArch[r.archive] ?? 0) + 1;
console.log(JSON.stringify(byArch));
console.log(studRows.sort((a, b) => b.studs - a.studs).slice(0, 25).map((r) => `${r.archive}/${r.path} studs~${r.studs}`).join('\n'));
