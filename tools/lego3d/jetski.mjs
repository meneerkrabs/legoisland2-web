#!/usr/bin/env node
// The island's jet ski (z02LGI Jetski_group1..3, model "JSKI") from the official LDraw model of the set it is made after: 6415 Res-Q Jet-Ski (LDraw OMR, by Robert Paciorek, CCAL 2.0 = CC BY 2.0).
// The game's model is the set's brick model (same wedge plates, handlebar, 0.04 game units per LDU); the replacement keeps its placement (rotation found by chamfer distance, centred on the original's
// bounding box), the group order / texture slots per LOD (111 black, 126 yellow, 112 grey, 314 the "R.E.S.Q" decal quad, which is kept and lifted onto the new hull), and the far LODs (4, 5) stay the game's.
//   node tools/lego3d/jetski.mjs [--mod DIR]
import fs from 'node:fs';
import path from 'node:path';
import { LDrawLib, splitMpd } from './ldraw.mjs';
import { LDRAW, scene, archive, memberOf, EXTRACT } from './lib.mjs';
import { readMesh, baseName } from './modelio.mjs';
import { writeMsh } from './mshwrite.mjs';
import { parseMsh, validateMsh } from '../../src/formats/msh.ts';
import { bboxPts, rotations24, applyRot, chamfer, samplePts, weldSmooth, pruneHidden, closestFacing, decimate } from './geom.mjs';

const MOD = process.argv.includes('--mod') ? process.argv[process.argv.indexOf('--mod') + 1] : path.join(EXTRACT, 'mods/lego3d-pilot');
const omr = path.join(LDRAW, 'omr');
const main = splitMpd(path.join(omr, '6415-1.mpd'), path.join(omr, '6415-1'));
const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw')); lib.addDir(path.join(omr, '6415-1'));
const sc = scene('z02LGI');
const model = sc.models.find((m) => m.parts.some((p) => /Jetski_group1/i.test(sc.meshPaths[p.mesh])));
const S = 0.04;
const COLOUR_TEX = { 0: 111, 14: 126, 7: 112, 15: 112 };
const g3shift = [0, 0.691260814666748, -2.3226020336151123];   // MATL entry 1 (group 3 of the original is drawn translated by it)
const ref = readMesh('z02LGI', sc.meshPaths[model.parts[0].mesh]).msh;
const refPts = []; ref.groups.slice(0, 2).forEach((g) => { for (let i = 0; i < g.indexCount; i++) { const v = ref.indices[g.firstIndex + i] + g.firstVertex; refPts.push(ref.positions[v * 3], ref.positions[v * 3 + 1], ref.positions[v * 3 + 2]); } });
const refB = bboxPts(Float32Array.from(refPts)), ctr = (b) => b.lo.map((l, i) => (l + b.hi[i]) / 2);

const flat = lib.flatten(main.replace('main.ldr', 'jetski.ldr'), { res: 'std' });
console.log('LDraw jet ski:', flat.tris.length / 9, 'tris (std), colours', JSON.stringify(Object.fromEntries([...new Set(flat.colors)].map((c) => [c, flat.colors.filter((x) => x === c).length]))));
// best rotation
let best = null;
const neg = Float32Array.from(flat.tris, (v) => -v * S);
for (const rot of rotations24()) {
  const r = new Float32Array(neg.length);
  for (let i = 0; i < neg.length; i += 3) r.set(applyRot(rot, [neg[i], neg[i + 1], neg[i + 2]]), i);
  const b = bboxPts(r), c = ctr(b), rc = ctr(refB);
  const sh = r.map((v, i) => v - c[i % 3] + rc[i % 3]);
  const d = chamfer(samplePts(sh), samplePts(Float32Array.from(refPts)));
  (globalThis.__cands ??= []).push({ d: +d.toFixed(3), rot: rot.join(',') });
  if (!best || d < best.d) best = { d, rot, shift: [rc[0] - c[0], refB.lo[1] - b.lo[1], rc[2] - c[2]], size: b.size };   // x / z centred, the hull's lowest point on the original's
}
console.log('top rotations', JSON.stringify(globalThis.__cands.sort((a, b) => a.d - b.d).slice(0, 5)));
console.log('rotation', best.rot.join(','), 'chamfer', best.d.toFixed(3), 'size', best.size.map((x) => x.toFixed(2)).join('x'), 'vs original', refB.size.map((x) => x.toFixed(2)).join('x'));
const toGame = (res, skip, dec) => {
  const f = lib.flatten(main.replace('main.ldr', 'jetski.ldr'), { res, skip });
  const out = new Float32Array(f.tris.length);
  for (let i = 0; i < out.length; i += 9) for (let k = 0; k < 3; k++) {
    const p = applyRot(best.rot, [-f.tris[i + k * 3] * S, -f.tris[i + k * 3 + 1] * S, -f.tris[i + k * 3 + 2] * S]), j = k === 1 ? 2 : k === 2 ? 1 : k;
    out[i + j * 3] = p[0] + best.shift[0]; out[i + j * 3 + 1] = p[1] + best.shift[1]; out[i + j * 3 + 2] = p[2] + best.shift[2];
  }
  // pruning by colour needs the colours: keep them with the triangles
  const cols = f.colors;
  let tris = out, c2 = cols;
  const keep = []; const all = out;
  for (let t = 0; t < out.length / 9; t++) keep.push(t);
  const pr = pruneHidden(out, all, 6);
  return { tris: out, cols, pruned: pr };
};
const LODS = [{ part: 0, res: 'std', skip: null }, { part: 1, res: 'low', skip: null }, { part: 2, res: 'low', skip: /stud/ }];
const outDir = path.join(MOD, '_data/z02LGI/meshes'); fs.mkdirSync(outDir, { recursive: true });
const rep = [];
for (const lod of LODS) {
  const part = model.parts[lod.part], name = baseName(sc.meshPaths[part.mesh]), texList = sc.texLists[part.texList];
  const orig = readMesh('z02LGI', sc.meshPaths[part.mesh]).msh;
  const f = lib.flatten(main.replace('main.ldr', 'jetski.ldr'), { res: lod.res, skip: lod.skip });
  // triangles to the game frame, grouped by texture; each triangle's visibility is tested against the whole model
  const world = new Float32Array(f.tris.length);
  for (let i = 0; i < world.length; i += 9) for (let k = 0; k < 3; k++) {
    const p = applyRot(best.rot, [-f.tris[i + k * 3] * S, -f.tris[i + k * 3 + 1] * S, -f.tris[i + k * 3 + 2] * S]), j = k === 1 ? 2 : k === 2 ? 1 : k;
    world[i + j * 3] = p[0] + best.shift[0]; world[i + j * 3 + 1] = p[1] + best.shift[1]; world[i + j * 3 + 2] = p[2] + best.shift[2];
  }
  const byTex = {};
  for (let t = 0; t < world.length / 9; t++) { const tex = COLOUR_TEX[f.colors[t]] ?? 126; (byTex[tex] ??= []).push(...world.subarray(t * 9, t * 9 + 9)); }
  const everything = Float32Array.from(Object.values(byTex).flat());
  const yellow = Float32Array.from(byTex[126] ?? []);
  const groups = texList.map((tex, gi) => {
    const og = orig.groups[gi];
    if (tex === 314) {   // the decal quad of the original, lifted onto the new hull
      const n = og.vertexCount, pos = new Float32Array(orig.positions.subarray(og.firstVertex * 3, (og.firstVertex + n) * 3)), nrm = orig.normals.slice(og.firstVertex * 3, (og.firstVertex + n) * 3);
      for (let v = 0; v < n; v++) {
        const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], nn = [nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]];
        const hit = closestFacing(p, nn, yellow, 0.5, 0.4);
        if (hit) { pos[v * 3] = hit.q[0] + hit.n[0] * 0.012; pos[v * 3 + 1] = hit.q[1] + hit.n[1] * 0.012; pos[v * 3 + 2] = hit.q[2] + hit.n[2] * 0.012; }
      }
      return { flags: og.flags, pos, nrm, uv: orig.uvs.slice(og.firstVertex * 2, (og.firstVertex + n) * 2), idx: Array.from(orig.indices.subarray(og.firstIndex, og.firstIndex + og.indexCount)) };
    }
    let tris = Float32Array.from(byTex[tex] ?? []);
    if (!tris.length) return { flags: og.flags, pos: orig.positions.slice(og.firstVertex * 3, (og.firstVertex + og.vertexCount) * 3), nrm: orig.normals.slice(og.firstVertex * 3, (og.firstVertex + og.vertexCount) * 3), uv: orig.uvs.slice(og.firstVertex * 2, (og.firstVertex + og.vertexCount) * 2), idx: Array.from(orig.indices.subarray(og.firstIndex, og.firstIndex + og.indexCount)) };
    tris = pruneHidden(tris, everything, 6);
    const w = weldSmooth(tris, 35);
    const gi3 = gi === 3;   // the original draws group 3 with MATL entry 1 (a translation): the geometry is pre-shifted the other way
    const pos = gi3 ? w.pos.map((v, i) => v - g3shift[i % 3]) : w.pos;
    return { flags: og.flags, pos, nrm: w.nrm, uv: new Float32Array(pos.length / 3 * 2).fill(0.5), idx: w.idx };
  });
  const bytes = writeMsh(groups, { gtom: Array.from(orig.gtom), matl: orig.matl });
  const m = parseMsh(bytes), pr = validateMsh(m);
  if (pr.length) console.log('PROBLEMS', name, pr);
  fs.writeFileSync(path.join(outDir, name), bytes);
  rep.push({ name, verts: m.vertexCount, tris: m.indices.length / 3, was: `${orig.vertexCount}v/${orig.indices.length / 3}t` });
}
console.table(rep);
