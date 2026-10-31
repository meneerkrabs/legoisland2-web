#!/usr/bin/env node
// Real stud geometry for the game's stud surfaces (docs/re/lego3d.md section 4.4). For every placed record whose mesh draws a stud-plate texture on an upward face (island: 84 grey, 86 blue on the jetties and
// the bridge decks) the stud grid is read from the texture mapping (one tile = 2 x 2 studs, centres at (0.25 / 0.75, 0.25 / 0.75) of the tile) and written as a list of stud positions in the mesh's own
// space, plus the stud mesh from LDraw `stud.dat` (two LODs, unit pitch) into  <mod>/_data/z02LGI/lego3d/studs.json . At run time `src/mods/lego3d/studs.ts` draws them with the brick batch (the game's
// own palette texture and CPU lighting), full 16-sided studs near the camera, 8-sided further away, none beyond (the painted studs of the texture remain).
//   node tools/lego3d/studs.mjs [--mod DIR] [--zone z02LGI]
import fs from 'node:fs';
import path from 'node:path';
import { LDrawLib } from './ldraw.mjs';
import { LDRAW, scene, archive, memberOf, EXTRACT } from './lib.mjs';
import { weldSmooth } from './geom.mjs';
import { parseMsh } from '../../src/formats/msh.ts';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const MOD = opt('--mod', path.join(EXTRACT, 'mods/lego3d-pilot'));
const ZONE = opt('--zone', 'z02LGI');
const STUD_TEX = { 86: 'BLUE', 84: 'LTGREY' };   // texture id -> brick colour name of the game's palette (Bricks/text000.tga cell)
const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
const studMesh = (res) => {
  const f = lib.flatten('stud.dat', { res });
  // LDraw (x, y, z), stud from y = 0 up to y = -4, radius 6, pitch 20 -> unit pitch, +Y up: p = (x, -y, z) / 20, a reflection: re-wound
  const t = new Float32Array(f.tris.length);
  for (let i = 0; i < t.length; i += 9) for (let k = 0; k < 3; k++) {
    const j = k === 1 ? 2 : k === 2 ? 1 : k;
    t[i + j * 3] = f.tris[i + k * 3] / 20; t[i + j * 3 + 1] = -f.tris[i + k * 3 + 1] / 20; t[i + j * 3 + 2] = f.tris[i + k * 3 + 2] / 20;
  }
  const w = weldSmooth(t, 40);
  return { positions: Array.from(w.pos, (v) => +v.toFixed(5)), normals: Array.from(w.nrm, (v) => +v.toFixed(4)), indices: w.idx };
};
const hi = studMesh('std'), lo = studMesh('low');
console.log('stud mesh: hi', hi.positions.length / 3, 'verts', hi.indices.length / 3, 'tris; lo', lo.positions.length / 3, 'verts', lo.indices.length / 3, 'tris');

const sc = scene(ZONE), arch = archive(ZONE);
const sets = [];
let total = 0;
for (const rec of sc.records) {
  const model = rec.model; if (!model) continue;
  if (!/^(JETT|BRID)$/.test(rec.name)) continue;   // the static plate records of the pilot (vehicles move: not yet)
  const part = model.parts[0], tl = sc.texLists[part.texList] ?? [];
  const groupsWanted = tl.map((t, gi) => (STUD_TEX[t] ? gi : -1)).filter((g) => g >= 0);
  if (!groupsWanted.length) continue;
  const mp = sc.meshPaths[part.mesh]; if (!mp) continue;
  const msh = parseMsh(arch.read(memberOf(mp)));
  for (const gi of groupsWanted) {
    const g = msh.groups[gi]; if (!g) continue;
    const studs = [], pitchSamples = [];
    const colour = STUD_TEX[tl[gi]];
    const tris = [];
    for (let t = 0; t < g.indexCount; t += 3) {
      const v = [0, 1, 2].map((k) => msh.indices[g.firstIndex + t + k] + g.firstVertex);
      const P = v.map((i) => [msh.positions[i * 3], msh.positions[i * 3 + 1], msh.positions[i * 3 + 2]]), U = v.map((i) => [msh.uvs[i * 2], msh.uvs[i * 2 + 1]]);
      const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], nl = Math.hypot(...n) || 1;
      if (n[1] / nl < 0.9) continue;    // upward faces only (the winding gives outward = +Y)
      tris.push({ P, U });
      // texture tile size along u and v: world length of a uv step
      const du = [U[1][0] - U[0][0], U[1][1] - U[0][1]], dv = [U[2][0] - U[0][0], U[2][1] - U[0][1]], det = du[0] * dv[1] - du[1] * dv[0];
      if (Math.abs(det) > 1e-6) {
        // world (x, z) per uv: solve [e1 e2] = [du dv] * J
        const a = (dv[1] * e1[0] - du[1] * e2[0]) / det, b = (-dv[0] * e1[0] + du[0] * e2[0]) / det, c = (dv[1] * e1[2] - du[1] * e2[2]) / det, d = (-dv[0] * e1[2] + du[0] * e2[2]) / det;
        const tu = Math.hypot(a, c), tv = Math.hypot(b, d);
        if (tu > 0.1 && tv > 0.1) pitchSamples.push((tu + tv) / 2 / 2);
      }
    }
    if (!tris.length) continue;
    pitchSamples.sort((x, y) => x - y);
    const pitch = pitchSamples[pitchSamples.length >> 1];
    const R = 0.3;   // stud radius in pitches
    const inUnion = (u, v) => tris.some(({ U }) => {
      const d = (U[1][1] - U[2][1]) * (U[0][0] - U[2][0]) + (U[2][0] - U[1][0]) * (U[0][1] - U[2][1]);
      if (Math.abs(d) < 1e-9) return false;
      const l1 = ((U[1][1] - U[2][1]) * (u - U[2][0]) + (U[2][0] - U[1][0]) * (v - U[2][1])) / d, l2 = ((U[2][1] - U[0][1]) * (u - U[2][0]) + (U[0][0] - U[2][0]) * (v - U[2][1])) / d;
      return l1 >= -1e-6 && l2 >= -1e-6 && l1 + l2 <= 1 + 1e-6;
    });
    const bbox = { u0: 1e9, u1: -1e9, v0: 1e9, v1: -1e9 };
    for (const { U } of tris) for (const q of U) { bbox.u0 = Math.min(bbox.u0, q[0]); bbox.u1 = Math.max(bbox.u1, q[0]); bbox.v0 = Math.min(bbox.v0, q[1]); bbox.v1 = Math.max(bbox.v1, q[1]); }
    const seen = new Set();
    for (let i = Math.floor(bbox.u0 * 2) - 1; i <= Math.ceil(bbox.u1 * 2) + 1; i++) for (let j = Math.floor(bbox.v0 * 2) - 1; j <= Math.ceil(bbox.v1 * 2) + 1; j++) {
      const u = i / 2 + 0.25, v = j / 2 + 0.25;
      const r = R * 0.5;
      let ok = inUnion(u, v);
      for (let k = 0; ok && k < 8; k++) ok = inUnion(u + r * Math.cos((k * Math.PI) / 4), v + r * Math.sin((k * Math.PI) / 4));
      if (!ok) continue;
      for (const { P, U } of tris) {
        const d = (U[1][1] - U[2][1]) * (U[0][0] - U[2][0]) + (U[2][0] - U[1][0]) * (U[0][1] - U[2][1]);
        if (Math.abs(d) < 1e-9) continue;
        const l1 = ((U[1][1] - U[2][1]) * (u - U[2][0]) + (U[2][0] - U[1][0]) * (v - U[2][1])) / d, l2 = ((U[2][1] - U[0][1]) * (u - U[2][0]) + (U[0][0] - U[2][0]) * (v - U[2][1])) / d, l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const p = [0, 1, 2].map((c) => l1 * P[0][c] + l2 * P[1][c] + l3 * P[2][c]);
        const key = p.map((x) => x.toFixed(2)).join(',');
        if (seen.has(key)) break;
        seen.add(key); studs.push(+p[0].toFixed(3), +p[1].toFixed(3), +p[2].toFixed(3));
        break;
      }
    }
    if (!studs.length) continue;
    sets.push({ rec: rec.index, name: rec.name, mesh: path.basename(mp), group: gi, colour, pitch: +pitch.toFixed(4), studs });
    total += studs.length / 3;
    console.log(`record ${rec.index} ${rec.name} ${path.basename(mp)} group ${gi} (texture ${tl[gi]}): ${studs.length / 3} studs, pitch ${pitch.toFixed(3)}, colour ${colour}`);
  }
}
const out = path.join(MOD, '_data', ZONE, 'lego3d');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'studs.json'), JSON.stringify({ version: 1, hi, lo, sets }));
console.log('records', sets.length, 'studs', total, 'file', (fs.statSync(path.join(out, 'studs.json')).size / 1024).toFixed(0), 'kB');
