#!/usr/bin/env node
// Geometry audit of the replaced vehicles (docs/re/lego3d.md section 17): for every mesh the sets generator writes (pack -> generator, the browser's path), against the game's own mesh:
//   * size: world box (MATL applied) of the game's mesh and of the new one, the change per axis and of the lowest point (where it sits on the water / the track)
//   * floating parts: the static triangles (identity MATL) are joined when they come within `touch` (0.05) of each other; every cluster but the largest is listed (triangles, box, nearest distance to the rest);
//     a cluster that is only studs (tiny) is ignored unless --studs
//   * moving groups (MATL != identity): triangles of the new static geometry that stand INSIDE the box of a moving group's axle-aligned bounding cylinder (a body piece in a wheel arch / a rotor)
//   node tools/lego3d/vehicles-audit.mjs [zone[:Mesh] ...] [--pack FILE] [--touch 0.05] [--min 4] [--studs] [--json out]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive, memberOf, scene } from './lib.mjs';
import { parseMsh, groupMatrices } from '../../src/formats/msh.ts';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { closestOnTri } from '../../src/mods/lego3d/gen/sets.ts';
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const showStuds = args.includes('--studs') && !!args.splice(args.indexOf('--studs'), 1), stud = null;
const minGap = +opt('--gap', 0.1), touch = +opt('--touch', 0.05), minTris = +opt('--min', 4), jsonOut = opt('--json', null);
const packFile = opt('--pack', path.join(here, '../../src/mods/lego3d/data/lego3d.pack'));
const want = args.map((s) => s.split(':'));
const pack = Pack.open(new Uint8Array(fs.readFileSync(packFile)));
const idn = (M) => { for (let i = 0; i < 16; i++) if (Math.abs(M[i] - (i % 5 === 0 ? 1 : 0)) > 1e-4) return false; return true; };
const xf = (M, p) => (M ? [p[0] * M[0] + p[1] * M[4] + p[2] * M[8] + M[12], p[0] * M[1] + p[1] * M[5] + p[2] * M[9] + M[13], p[0] * M[2] + p[1] * M[6] + p[2] * M[10] + M[14]] : p);
/** triangles in world space: { s: [a,b,c] static, m: moving: { g, tri } } */
function soup(msh) {
  const gm = groupMatrices(msh), stat = [], mov = new Map();
  msh.groups.forEach((g, gi) => {
    const M = gm[gi], moving = M && !idn(M);
    for (let i = 0; i < g.indexCount; i += 3) {
      const t = [0, 1, 2].map((k) => { const v = msh.indices[g.firstIndex + i + k] + g.firstVertex; return xf(M, [msh.positions[v * 3], msh.positions[v * 3 + 1], msh.positions[v * 3 + 2]]); });
      if (moving) { if (!mov.has(gi)) mov.set(gi, []); mov.get(gi).push(t); } else stat.push(t);
    }
  });
  return { stat, mov };
}
const box = (tris) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const t of tris) for (const p of t) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], p[c]); hi[c] = Math.max(hi[c], p[c]); } return { lo, hi }; };
/** splits triangles with an edge longer than `maxEdge` (midpoint of the longest edge) so that a vertex test also sees where a long thin triangle passes close to another surface */
function subdivide(tris, maxEdge) {
  const out = [], st = [...tris];
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  while (st.length) {
    const t = st.pop(), e = [d2(t[0], t[1]), d2(t[1], t[2]), d2(t[2], t[0])], k = e.indexOf(Math.max(...e));
    if (e[k] <= maxEdge * maxEdge) { out.push(t); continue; }
    const a = t[k], b = t[(k + 1) % 3], c = t[(k + 2) % 3], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    st.push([a, m, c], [m, b, c]);
  }
  return out;
}
function clusters(tris) {
  const n = tris.length, par = Array.from({ length: n }, (_, i) => i), find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const cell = 0.4, grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  const bb = tris.map((t) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const p of t) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], p[c]); hi[c] = Math.max(hi[c], p[c]); } return { lo, hi }; });
  tris.forEach((t, i) => { const b = bb[i]; for (let x = Math.floor((b.lo[0] - touch) / cell); x <= Math.floor((b.hi[0] + touch) / cell); x++) for (let y = Math.floor((b.lo[1] - touch) / cell); y <= Math.floor((b.hi[1] + touch) / cell); y++) for (let z = Math.floor((b.lo[2] - touch) / cell); z <= Math.floor((b.hi[2] + touch) / cell); z++) { const k = key(x, y, z); (grid.get(k) ?? grid.set(k, []).get(k)).push(i); } });
  const t2 = touch * touch, seen = new Set();
  for (const list of grid.values()) for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
    const i = list[a], j = list[b]; if (find(i) === find(j)) continue;
    const k = i < j ? i * n + j : j * n + i; if (seen.has(k)) continue; seen.add(k);
    let near = false;
    for (const p of tris[i]) if (closestOnTri(p, tris[j][0], tris[j][1], tris[j][2]).d2 <= t2) { near = true; break; }
    if (!near) for (const p of tris[j]) if (closestOnTri(p, tris[i][0], tris[i][1], tris[i][2]).d2 <= t2) { near = true; break; }
    if (near) par[find(i)] = find(j);
  }
  const m = new Map(); tris.forEach((_, i) => { const r = find(i); (m.get(r) ?? m.set(r, []).get(r)).push(i); });
  return [...m.values()].sort((a, b) => b.length - a.length);
}
const out = [];
const zones = [...new Set(want.length ? want.map((w) => w[0]) : ['z02LGI', 'z07CSI', 'z13CAI', 'z14OSD', 'z16PYA', 'z22BIP', 'z23DIP', 'z38PAR'])];
for (const zone of zones) {
  const a = archive(zone), sc = scene(zone), gen = await generateArchive(pack, zone, a, async () => null, ['sets']);
  for (const [member, bytes] of gen.files) {
    const nm = path.basename(member);
    if (!want.length && !/^(Jetski|Ambulance|speedster|speedboat|Heli_resq|Dingy|locomotive|loco_|seaplane|airstrip_seaplane)/i.test(nm)) continue;
    if (want.some((w) => w[0] === zone && w[1]) && !want.some((w) => w[0] === zone && (!w[1] || w[1].toLowerCase() + '.msh' === nm.toLowerCase() || w[1].toLowerCase() === nm.toLowerCase()))) continue;
    const e = a.find(member); if (!e) continue;
    const A = parseMsh(a.read(e)), B = parseMsh(bytes), SA = soup(A), SB = soup(B);
    const allA = box([...SA.stat, ...[...SA.mov.values()].flat()]), allB = box([...SB.stat, ...[...SB.mov.values()].flat()]);
    const d = (c) => (allB.hi[c] - allB.lo[c]) - (allA.hi[c] - allA.lo[c]);
    const row = { zone, mesh: nm, tris: [A.indices.length / 3, B.indices.length / 3], size: allA.hi.map((h, c) => +(h - allA.lo[c]).toFixed(2)), dSize: [0, 1, 2].map((c) => +d(c).toFixed(2)), dLow: +(allB.lo[1] - allA.lo[1]).toFixed(2), dHigh: +(allB.hi[1] - allA.hi[1]).toFixed(2), floating: [], inMoving: [] };
    const baseCl = clusters(subdivide(SA.stat, 0.6)); row.gameClusters = baseCl.filter((c) => c.length >= minTris).length; const sub = subdivide(SB.stat, 0.6), cl = clusters(sub), main = cl[0], rest = main.map((i) => sub[i]);
    for (const c of cl.slice(1)) {
      if (c.length < minTris) continue;
      const ts = c.map((i) => sub[i]), b = box(ts);
      if (!showStuds && b.hi[1] - b.lo[1] <= 0.2 * (stud ?? 1) + 0.05 && b.hi[0] - b.lo[0] <= 0.7 * (stud ?? 1) && b.hi[2] - b.lo[2] <= 0.7 * (stud ?? 1)) { row.studs = (row.studs ?? 0) + 1; continue; }   // a stud prism: its seat is the plate under it (the plate is its own cluster when the studs sit on a curve)
      // nearest distance to the main cluster (vertex to triangle, sampled)
      let best = 1e9; for (const t of ts) for (const p of t) for (const q of rest) { const bb = Math.min(...[0, 1, 2].map((k) => Math.max(0, Math.max(p[k] - Math.max(q[0][k], q[1][k], q[2][k]), Math.min(q[0][k], q[1][k], q[2][k]) - p[k])))); if (bb > best) continue; const dd = Math.sqrt(closestOnTri(p, q[0], q[1], q[2]).d2); if (dd < best) best = dd; }
      if (best < minGap) continue;
      row.floating.push({ tris: c.length, lo: b.lo.map((v) => +v.toFixed(2)), hi: b.hi.map((v) => +v.toFixed(2)), gap: +best.toFixed(3) });
    }
    // body triangles standing inside a moving group's box (shrunk by 12 %: wheels / rotors keep their clearance)
    for (const [gi, ts] of SB.mov) {
      const b = box(ts), sh = [0, 1, 2].map((c) => (b.hi[c] - b.lo[c]) * 0.12);
      if (ts.length < 8) continue;
      const lo = b.lo.map((v, c) => v + sh[c]), hi = b.hi.map((v, c) => v - sh[c]);
      let n = 0, inside = 0; for (const t of SB.stat) { n++; const c = [0, 1, 2].map((k) => (t[0][k] + t[1][k] + t[2][k]) / 3); if (c.every((v, k) => v > lo[k] && v < hi[k])) inside++; }
      if (inside) row.inMoving.push({ group: gi, tris: ts.length, box: [b.lo.map((v) => +v.toFixed(1)), b.hi.map((v) => +v.toFixed(1))], bodyTrisInside: inside });
    }
    out.push(row);
    console.log(`${zone}/${nm}: ${row.tris.join(' -> ')} tris, size ${row.size.join('x')} (d ${row.dSize.join(',')}), lowest ${row.dLow >= 0 ? '+' : ''}${row.dLow}, top ${row.dHigh >= 0 ? '+' : ''}${row.dHigh}; floating clusters ${row.floating.length} (the game's own mesh: ${row.gameClusters} separate pieces)${row.floating.map((f) => `\n    ${f.tris} tris box ${f.lo}..${f.hi} gap ${f.gap}`).join('')}${row.inMoving.length ? '\n  body inside moving: ' + row.inMoving.map((m) => `g${m.group} (${m.tris} tris) ${m.bodyTrisInside}`).join('; ') : ''}`);
  }
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 1));
