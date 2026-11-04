#!/usr/bin/env node
// Wrist check (docs/re/lego3d.md "Round 12"): the gap / overlap between the arm's cuff and the hand's wrist peg, in game units, for every body layout at HR and MR, in the bind pose and over
// posed frames of the game's own clips, for the game's own meshes ("orig") and for the generated ones from a pack.
//   node tools/lego3d/wrist-check.mjs [--pack FILE] [--poses 400] [--only pepp,mfg,...] [--json OUT]
// Per (layout, LOD, side) and per pose it reports
//   gap      distance between the arm surface and the hand surface (0 when they touch or overlap)
//   overlap  how deep the hand's vertices are INSIDE the arm's closed shell (the peg in the hole), 0 when none is
//   off      lateral distance of the hand's tip (its vertices farthest up the arm: the peg's end) from the axis of the cuff (the line through the centre of the arm's end face along its normal): 0 = the peg is on the axis of the sleeve
//   tipIn    the share of the tip's vertices that are inside the arm's closed shell (1 = the peg stands in the hole); in the report: the share of poses where all of them are
//   depth    how far that tip is past the cuff's end plane along that axis (negative = inside the sleeve: where a peg belongs)
// The hand's bone is taken from the inventory (14 right, 16 left), the hand drawn as v * MATL * bone (what the game does); bodies are skinned with skinPositions.
// Needs the game folder (and a pack for the generated side). The cuff = the arm's end face (the triangles in the last 0.12 of the arm that look down it).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { parseMsh, groupMatrices } from '../../src/formats/msh.ts';
import { parseSvwl, skinPositions, sampleBlk } from '../../src/formats/anim.ts';
import { distSqPointTri } from '../../src/mods/lego3d/geom/measure.ts';
import { archive } from './lib.mjs';
import { loadInventory } from './chars-inventory.mjs';
import { poses as samplePoses } from './pack/chars-pose.mjs';
import { BONES } from './pack/chars-core.mjs';
import { endFace } from './pack/chars-wrist.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PACK = path.join(here, '../../src/mods/lego3d/data/lego3d.pack');

/** the characters of the report: a model of the inventory that carries this body mesh, its LODs to look at */
export const CASES = [
  { name: 'pepp', zone: 'z01BPK', model: 'g98380c:35', lods: [0, 1] },
  { name: 'mfg', zone: 'z01BPK', model: 'g98380c:37', lods: [0, 1] },
  { name: 'bb', zone: 'z02LGI', model: 'g98380c:17', lods: [0, 1] },
  { name: 'space', zone: 'z36CNT', model: 'g98380c:19', lods: [0] },
  { name: 'skel', zone: 'z01BPK', model: 'g98380c:55', lods: [0] },
  { name: 'mummy', zone: 'z18MMP', model: 'g98380c:122', lods: [0] },
];
const SIDES = [{ side: 'R', arm: [11, 13], slot: 6 }, { side: 'L', arm: [12, 15], slot: 8 }];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mean = (P) => [0, 1, 2].map((k) => P.reduce((s, p) => s + p[k], 0) / (P.length || 1));

/** ray (origin o, direction d) against triangle: t > 0 or -1 (Moeller-Trumbore) */
function rayTri(o, d, a, b, c) {
  const e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2), det = dot(e1, p);
  if (Math.abs(det) < 1e-14) return -1;
  const inv = 1 / det, s = sub(o, a), u = dot(s, p) * inv;
  if (u < 0 || u > 1) return -1;
  const q = cross(s, e1), v = dot(d, q) * inv;
  if (v < 0 || u + v > 1) return -1;
  const t = dot(e2, q) * inv;
  return t > 1e-9 ? t : -1;
}
const RAYS = [unit([0.5703, 0.6402, 0.5164]), unit([-0.3917, 0.2113, 0.8955]), unit([0.2236, -0.8412, 0.4930])];
/** inside the arm's shell? majority of three ray parities (the lofted arms of the far LODs are open tubes: one ray can leave through the open end) */
const insideArm = (p, T) => RAYS.filter((d) => { let hits = 0; for (const [a, b, c] of T) if (rayTri(p, d, a, b, c) > 0) hits++; return hits % 2 === 1; }).length >= 2;

/** a body mesh -> { m, sv, armTris (index triples of the arm's triangles), end/mid vertex sets (bind) } for the arm bones `arm` ([upper, lower]) */
function prepArm(bytes, arm) {
  const m = parseMsh(bytes), sv = parseSvwl(m.svwl, m.vertexCount);
  const tris = [];
  for (const g of m.groups) for (let t = 0; t < g.indexCount; t += 3) { const v = [0, 1, 2].map((k) => m.indices[g.firstIndex + t + k] + g.firstVertex); if (v.every((i) => arm.includes(sv.bone[i]))) tris.push(v); }
  const bind = skinPositions(m.positions, sv, BONES);
  const lowerB = arm[1], b13 = [BONES[lowerB * 16 + 12], BONES[lowerB * 16 + 13], BONES[lowerB * 16 + 14]], b14 = [BONES[(lowerB + 1) * 16 + 12], BONES[(lowerB + 1) * 16 + 13], BONES[(lowerB + 1) * 16 + 14]];
  const d0 = unit(sub(b14, b13));
  const used = new Set(tris.flat()), verts = [...used];
  const s = (v) => dot(sub([bind[v * 3], bind[v * 3 + 1], bind[v * 3 + 2]], b13), d0);
  const smax = Math.max(...verts.map(s));
  const endSet = verts.filter((v) => s(v) > smax - 0.05);
  const forearm = tris.filter((t) => t.every((v) => bind[v * 3 + 1] < 2.0));
  const cap = endFace(m, sv, bind, arm).tris;   // the cuff's end face (chars-wrist.mjs: the same as the builder's), found in the bind pose and followed through the poses
  return { m, sv, tris, forearm, endSet, cap, lower: lowerB };
}
/** a hand mesh -> { m, T (group matrices), raw positions } */
function prepHand(bytes) {
  const m = parseMsh(bytes), M = groupMatrices(m);
  const P = new Float32Array(m.vertexCount * 3), tri = [];
  m.groups.forEach((g, gi) => {
    const T = M[gi];
    for (let v = g.firstVertex; v < g.firstVertex + g.vertexCount; v++) {
      const x = m.positions[v * 3], y = m.positions[v * 3 + 1], z = m.positions[v * 3 + 2];
      if (T) { P[v * 3] = x * T[0] + y * T[4] + z * T[8] + T[12]; P[v * 3 + 1] = x * T[1] + y * T[5] + z * T[9] + T[13]; P[v * 3 + 2] = x * T[2] + y * T[6] + z * T[10] + T[14]; } else { P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z; }
    }
    for (let k = 0; k < g.indexCount; k += 3) tri.push([0, 1, 2].map((q) => m.indices[g.firstIndex + k + q] + g.firstVertex));
  });
  return { m, P, tri };
}
const xform = (M, b, p) => [p[0] * M[b * 16] + p[1] * M[b * 16 + 4] + p[2] * M[b * 16 + 8] + M[b * 16 + 12], p[0] * M[b * 16 + 1] + p[1] * M[b * 16 + 5] + p[2] * M[b * 16 + 9] + M[b * 16 + 13], p[0] * M[b * 16 + 2] + p[1] * M[b * 16 + 6] + p[2] * M[b * 16 + 10] + M[b * 16 + 14]];

/** gap / overlap / off / depth of one arm + hand in the pose `M` (16 floats per bone) */
function measure(A, H, hb, M) {
  const X = skinPositions(A.m.positions, A.sv, M);
  const V = (i) => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]];
  const hp = []; for (let v = 0; v < H.P.length / 3; v++) hp.push(xform(M, hb, [H.P[v * 3], H.P[v * 3 + 1], H.P[v * 3 + 2]]));
  // the cuff: centre and outward normal of its end face (area-weighted over the cap triangles), posed
  let capA = 0; const endC = [0, 0, 0], ax = [0, 0, 0];
  for (const t of A.cap) { const [p, q, r] = t.map(V), n = cross(sub(q, p), sub(r, p)), area = Math.hypot(...n) / 2; capA += area; for (let k = 0; k < 3; k++) { endC[k] += (p[k] + q[k] + r[k]) / 3 * area; ax[k] += n[k] / (2 * area) * area; } }
  if (capA > 0) { for (let k = 0; k < 3; k++) endC[k] /= capA; ax.splice(0, 3, ...unit(ax)); }
  else {   // an arm without an end face (an open tube): the ring of its last 0.05 and the bone's direction
    const e = mean(A.endSet.map(V)), lb = A.lower; endC.splice(0, 3, ...e);
    ax.splice(0, 3, ...unit([M[(lb + 1) * 16 + 12] - M[lb * 16 + 12], M[(lb + 1) * 16 + 13] - M[lb * 16 + 13], M[(lb + 1) * 16 + 14] - M[lb * 16 + 14]]));
  }
  // the tip of the hand: its vertices farthest UP the forearm (against ax)
  const up = hp.map((p) => -dot(sub(p, endC), ax)), top = Math.max(...up);
  const tipV = hp.filter((_, i) => up[i] > top - 0.012), tip = mean(tipV), rel = sub(tip, endC), depth = dot(rel, ax), lat = Math.hypot(...sub(rel, [ax[0] * depth, ax[1] * depth, ax[2] * depth]));
  // hand vertices inside the arm's closed shell (ray parity), and the distances
  const T = A.tris.map((t) => t.map(V)), Tf = A.forearm.map((t) => t.map(V));
  let inside = 0, gap = 1e9;
  const near = hp.filter((p) => Math.hypot(...sub(p, endC)) < 0.45);
  const insideV = [];
  for (const p of near) {
    if (insideArm(p, T)) insideV.push(p);
  }
  for (const p of insideV) { let best = 1e9; for (const [a, b, c] of Tf) best = Math.min(best, distSqPointTri(p, a, b, c)); inside = Math.max(inside, Math.sqrt(best)); }
  // is the peg's end inside the sleeve? (the share of the tip's vertices inside the arm's closed shell: 1 = the peg is in the hole, 0 = it is beside or below the cuff)
  let tipIn = 0; for (const p of tipV) if (insideArm(p, T)) tipIn++;
  tipIn /= tipV.length;
  if (insideV.length) gap = 0;
  else {
    for (const p of near) for (const [a, b, c] of Tf) gap = Math.min(gap, Math.sqrt(distSqPointTri(p, a, b, c)));
    const HT = H.tri.map((t) => t.map((i) => hp[i]));
    for (const i of A.endSet) { const p = V(i); for (const [a, b, c] of HT) gap = Math.min(gap, Math.sqrt(distSqPointTri(p, a, b, c))); }
  }
  return { gap, overlap: inside, off: lat, depth, tipIn };
}
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

/** -> rows (one per case / LOD / side / kind: 'orig' = the game's meshes, 'gen' = generated from the pack) */
export async function runWristCheck({ packFile = DEFAULT_PACK, nPoses = 400, only = [], log = console.log, jsonOut = null } = {}) {
  const PACK = packFile, NPOSE = nPoses, ONLY = only;
  const inv = loadInventory();
  let pack = null;
  if (fs.existsSync(PACK)) pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
  const all = samplePoses(5), step = Math.max(1, Math.floor(all.length / NPOSE)), P = [BONES];
  for (let i = 0; i < all.length; i += step) P.push(all[i]);
  log(`pack ${pack ? PACK : '(none)'}, ${P.length} poses (the first is the bind pose)`);
  const genCache = new Map(), results = [];
  for (const c of CASES) {
    if (ONLY.length && !ONLY.includes(c.name)) continue;
    const mo = inv.models.find((m) => m.zone === c.zone && m.model === c.model);
    if (!mo) { log(c.name, 'no such model'); continue; }
    const a = archive(c.zone);
    let gen = null;
    if (pack) { if (!genCache.has(c.zone)) genCache.set(c.zone, (await generateArchive(pack, c.zone, a, async () => null, ['characters'])).files); gen = genCache.get(c.zone); }
    for (const li of c.lods) {
      const body = mo.parts[li];
      for (const S of SIDES) {
        const ha = mo.attach.find((x) => x?.slot === S.slot);
        const hand = ha?.parts[Math.min(li, ha.parts.length - 1)];
        if (!body?.member || !hand?.member) continue;
        const hb = ha.bone;
        for (const kind of ['orig', 'gen']) {
          if (kind === 'gen' && !gen) continue;
          const bytes = (mem) => { const e = a.find(mem); return kind === 'gen' && gen.has(e.path) ? gen.get(e.path) : a.read(e); };
          const A = prepArm(bytes(body.member), S.arm), H = prepHand(bytes(hand.member));
          const r = P.map((M) => measure(A, H, hb, M));
          const row = { case: c.name, lod: li, side: S.side, kind, body: body.name, hand: hand.name, bind: r[0], gap: [pct(r.map((x) => x.gap), 0.5), pct(r.map((x) => x.gap), 0.9), Math.max(...r.map((x) => x.gap))], overlap: [pct(r.map((x) => x.overlap), 0.5), pct(r.map((x) => x.overlap), 0.9), Math.max(...r.map((x) => x.overlap))], off: [pct(r.map((x) => x.off), 0.5), pct(r.map((x) => x.off), 0.9), Math.max(...r.map((x) => x.off))], depth: [pct(r.map((x) => x.depth), 0.5), pct(r.map((x) => x.depth), 0.9), Math.max(...r.map((x) => x.depth))], tipIn: r.filter((x) => x.tipIn > 0.99).length / r.length };
          results.push(row);
          const f = (v) => v.toFixed(3), f3 = (x) => x.map(f).join('/');
          log(`${c.name.padEnd(6)} lod${li} ${S.side} ${kind.padEnd(4)} ${body.name}+${hand.name}: bind gap ${f(row.bind.gap)} overlap ${f(row.bind.overlap)} off ${f(row.bind.off)} depth ${f(row.bind.depth)} tipIn ${row.bind.tipIn.toFixed(2)} | posed p50/p90/max gap ${f3(row.gap)} overlap ${f3(row.overlap)} off ${f3(row.off)}, peg inside in ${(100 * row.tipIn).toFixed(0)}% of the poses`);
        }
      }
    }
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
  return results;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
  await runWristCheck({ packFile: opt('--pack', DEFAULT_PACK), nPoses: +opt('--poses', 400), only: (opt('--only', '') || '').split(',').filter(Boolean), jsonOut: opt('--json', null) });
}
