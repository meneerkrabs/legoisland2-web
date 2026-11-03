#!/usr/bin/env node
// Room census of a mesh (docs/re/lego3d.md section 16.9): is the inside of a building a closed room for a camera that stands in it, in the game's own mesh and in the generated one?
//   node tools/lego3d/bldg-rooms.mjs [--pack FILE] [--gens sets,glass] [--glass-table] [--brief] [--no-panes] [--step 1] [--ys 1.5,3.5,5.5,9.5] [--list] zone Mesh [Mesh2 ...]      (Mesh without .Msh, e.g. garage_LOD1 rescue_LOD1)
// Sample points on a grid (x, z every `step` units, the heights `ys`, mesh space). A point is a ROOM point when at least four of the five directions +x -x +z -z +y end on a front-facing triangle within 30 units
// (the engine culls back faces: only those are seen) and it is not inside a wall's slab (two or more of the six first hits are back faces). For the room points the tool reports
//   closed          all five directions end on a front-facing triangle: the camera sees a surface everywhere
//   missing         directions that end on nothing (sky / ground / terrain shows through)
//   closable        of those, directions where a BACK-facing triangle exists behind the opening: a surface the game has but culls (double-sided drawing would show it), with the group(s) it belongs to
// and for the generated mesh how many room points of the game's mesh it closes / opens. Not a render: rays against the triangles in mesh space, MATL applied.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive, memberOf, scene } from './lib.mjs';
import { parseMsh, groupMatrices } from '../../src/formats/msh.ts';
import { transformPoint } from '../../src/render/math.ts';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args.splice(i, 2)[1]; };
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; };
const packFile = opt('--pack', path.join(here, '../../src/mods/lego3d/data/lego3d.pack')), step = +opt('--step', '1'), ys = opt('--ys', '1.5,3.5,5.5,9.5').split(',').map(Number), list = flag('--list');
const noPanes = flag('--no-panes'), gens = opt('--gens', 'sets').split(',');   // --gens glass: the meshes the LEGO 3D option does not replace, with the back of their glass (section 16.10)
const brief = flag('--brief'), allGlass = flag('--glass-table');
let [zone, ...names] = args;
const a = archive(zone), sc = scene(zone);
const TOT = { meshes: 0, regress: 0 };
if (allGlass) {   // every mesh of the glass table of this zone (section 16.10): the meshes the LEGO 3D option does not replace
  const tp = await Pack.open(new Uint8Array(fs.readFileSync(packFile))).json(`glass/arch/${zone.toLowerCase()}.json`);
  names = tp.meshes.map((e) => e.m.replace(/^.*\//, '').replace(/\.msh$/i, ''));
}
const gen = await generateArchive(Pack.open(new Uint8Array(fs.readFileSync(packFile))), zone, a, async () => null, noPanes ? [...gens, '-panes'] : gens);

const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]], dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
function prep(msh) {
  const gm = groupMatrices(msh), T = [];
  msh.groups.forEach((g, gi) => {
    for (let i = 0; i < g.indexCount; i += 3) {
      const P = [0, 1, 2].map((k) => { const v = msh.indices[g.firstIndex + i + k] + g.firstVertex, p = [msh.positions[v * 3], msh.positions[v * 3 + 1], msh.positions[v * 3 + 2]]; return gm[gi] ? transformPoint(gm[gi], p) : p; });
      const e1 = P[1].map((q, j) => q - P[0][j]), e2 = P[2].map((q, j) => q - P[0][j]);
      T.push({ g: gi, P, e1, e2, n: cross(e1, e2), lo: [0, 1, 2].map((c) => Math.min(...P.map((p) => p[c]))), hi: [0, 1, 2].map((c) => Math.max(...P.map((p) => p[c]))) });
    }
  });
  return T;
}
function cast(T, o, d) {
  let front = 1e30, back = 1e30, bg = -1;
  for (const t of T) {
    let ok = true;
    for (let c = 0; c < 3; c++) if (Math.abs(d[c]) < 1e-9 && (o[c] < t.lo[c] - 1e-3 || o[c] > t.hi[c] + 1e-3)) { ok = false; break; }
    if (!ok) continue;
    const h = cross(d, t.e2), A = dot(t.e1, h);
    if (Math.abs(A) < 1e-12) continue;
    const f = 1 / A, s = [o[0] - t.P[0][0], o[1] - t.P[0][1], o[2] - t.P[0][2]], u = f * dot(s, h);
    if (u < 0 || u > 1) continue;
    const q = cross(s, t.e1), v = f * dot(d, q);
    if (v < 0 || u + v > 1) continue;
    const tt = f * dot(t.e2, q);
    if (tt < 1e-4) continue;
    if (dot(t.n, d) < 0) { if (tt < front) front = tt; } else if (tt < back) { back = tt; bg = t.g; }
  }
  return { front: front < 30, back: back < 30, bg, firstBack: back < front && back < 30 };
}
const D = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]], DN = ['+x', '-x', '+z', '-z', '+y'];

for (const nm of names) {
  const idx = sc.meshPaths.findIndex((x) => x.toLowerCase().endsWith(`\\${nm.toLowerCase()}.msh`));
  if (idx < 0) { console.log(nm, 'not in', zone); continue; }
  const member = memberOf(sc.meshPaths[idx]), key = [...gen.files.keys()].find((k) => k.toLowerCase() === member.toLowerCase());
  if (!key) { console.log(nm, 'not written by', gens.join('+')); continue; }
  const G = prep(parseMsh(a.read(a.find(member)))), L = prep(parseMsh(gen.files.get(key)));
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const t of G) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], t.lo[c]); hi[c] = Math.max(hi[c], t.hi[c]); }
  const sum = (T) => ({ n: 0, closed: 0, missing: 0, closable: 0, open: 0, groups: {}, dirs: [0, 0, 0, 0, 0], pts: [] });
  const R = { game: sum(), lego: sum() };
  let regress = 0, gain = 0;
  const PP = { n: 0, missG: 0, missN: 0, clG: 0, clN: 0 };   // the game's own room points, in the game's and in the generated mesh (the same points: apples to apples)
  for (const y of ys) for (let x = lo[0] + 0.05; x <= hi[0]; x += step) for (let z = lo[2] + 0.05; z <= hi[2]; z += step) {
    const o = [x, y, z], rg = D.map((d) => cast(G, o, d)), rl = D.map((d) => cast(L, o, d));
    const room = (r) => r[0].front + r[1].front + r[2].front + r[3].front >= 3 && r.filter((q) => q.front).length >= 4 && r.filter((q) => q.firstBack).length < 2;
    const add = (S, r) => {
      S.n++;
      const f = r.filter((q) => q.front).length;
      if (f === 5) { S.closed++; return; }
      r.forEach((q, di) => { if (q.front) return; S.missing++; S.dirs[di]++; if (q.back) { S.closable++; S.groups[q.bg] = (S.groups[q.bg] ?? 0) + 1; } else { S.open++; if (list) S.pts.push(`${x.toFixed(1)},${y},${z.toFixed(1)} ${DN[di]}`); } });
    };
    if (room(rg)) { add(R.game, rg); const mg = rg.filter((q) => !q.front).length, ml = rl.filter((q) => !q.front).length; if (ml > mg) regress++; if (ml < mg) gain++; PP.n++; PP.missG += mg; PP.missN += ml; PP.clG += rg.filter((q) => !q.front && q.back).length; PP.clN += rl.filter((q) => !q.front && q.back).length; }
    if (room(rl)) add(R.lego, rl);
  }
  const line = (k, S) => `  ${k.padEnd(5)} ${String(S.n).padStart(4)} room points, ${String(S.closed).padStart(4)} closed; missing directions ${S.missing} (+x -x +z -z +y: ${S.dirs.join(' ')}): ${S.closable} closable by a culled back face ${JSON.stringify(S.groups)}, ${S.open} nothing behind`;
  TOT.meshes++; for (const k of Object.keys(PP)) TOT[k] = (TOT[k] ?? 0) + PP[k];
   TOT.regress += regress;
  if (brief) { if (PP.clG || PP.clN || regress) console.log(`${zone}/${nm}: ${G.length} -> ${L.length} triangles; at the game's ${PP.n} room points: missing directions ${PP.missG} -> ${PP.missN}, of which a culled back face behind ${PP.clG} -> ${PP.clN}; directions opened ${regress}`); continue; }
  console.log(`${zone}/${nm}: ${G.length} -> ${L.length} triangles`);
  console.log(line('game', R.game)); console.log(line('LEGO', R.lego));
  console.log(`  at the game's room points the generated mesh opens a direction the game had closed ${regress} times and closes one the game had left open ${gain} times`);
  if (list) console.log('  nothing behind (LEGO):', R.lego.pts.join(' | '));
}
if (allGlass || brief) console.log(`${zone} TOTAL ${JSON.stringify(TOT)}`);
