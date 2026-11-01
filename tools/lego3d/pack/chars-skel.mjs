// The skeleton body (SKEL_HR of the skeleton, MUMM_HR of the mummy guards: the same shape, flat white): the LDraw minifig skeleton parts - torso with ribs and pelvis 6260, arm 6265, leg 6266 - fitted to the
// regions of the game's body, simplified with the quadric decimator, skinned RIGIDLY like the original (every region one bone, cut at its joint plane so the parts of a joint have their own vertices).
// Builder only; the pack gets positions / bones / weights (encodeBody), nothing of the game's mesh.
import path from 'node:path';
import { LDRAW } from '../lib.mjs';
import { LDrawLib } from '../ldraw.mjs';
import { ldrawToGame, bbox, boxFit, mapTris, loadBody } from './chars-core.mjs';
import { rotations24, applyRot, chamfer, samplePts, splitAtPlane } from '../geom.mjs';
import { weldSoup, indexedToSoup } from './chars-body.mjs';
import { decimate } from '../../../src/mods/lego3d/geom/decimate.ts';
import { loft, shapeLevels } from './chars-loft.mjs';

const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
/** the regions: original vertices whose primary bone is in `bones`; `split` = the joint plane (y) with the bone below / above it; `budget` = triangles of the part at the original's HR count */
export const SKEL_PARTS = [
  { id: 'torso', ld: '6260', res: 'low', bones: [0, 8], split: { y: 1.62, lo: 0, hi: 8 }, ramp: 0.18, share: 0.46 },
  { id: 'arm +x', ld: '6265', res: 'std', bones: [11, 13], split: { y: 2.255, lo: 13, hi: 11 }, ramp: 0.12, share: 0.1, loft: { K: 8, levels: 7 } },
  { id: 'arm -x', ld: '6265', res: 'std', bones: [12, 15], split: { y: 2.255, lo: 15, hi: 12 }, ramp: 0.12, share: 0.1, mirror: true, loft: { K: 8, levels: 7 } },
  { id: 'leg +x', ld: '6266', res: 'std', bones: [2, 6], split: { y: 0.37, lo: 6, hi: 2 }, ramp: 0.12, share: 0.17, loft: { K: 6, levels: 8 } },
  { id: 'leg -x', ld: '6266', res: 'std', bones: [1, 4], split: { y: 0.37, lo: 4, hi: 1 }, ramp: 0.12, share: 0.17, mirror: true, loft: { K: 6, levels: 8 } },
];
const rotated = (t, rot) => { const r = new Float32Array(t.length); for (let i = 0; i < t.length; i += 3) r.set(applyRot(rot, [t[i], t[i + 1], t[i + 2]]), i); return r; };
const mirrorX = (t) => { const r = new Float32Array(t.length); for (let i = 0; i < t.length; i += 9) { for (let k = 0; k < 3; k++) { const j = k === 1 ? 2 : k === 2 ? 1 : k; r[i + j * 3] = -t[i + k * 3]; r[i + j * 3 + 1] = t[i + k * 3 + 1]; r[i + j * 3 + 2] = t[i + k * 3 + 2]; } } return r; };   // x -> -x, winding kept outward

/** the original's triangles whose first vertex has a primary bone in `bones` (bind pose, world) */
function regionTris(B, bones) {
  const o = [];
  for (const g of B.msh.groups) for (let t = 0; t < g.indexCount; t += 3) {
    const v = [0, 1, 2].map((k) => B.msh.indices[g.firstIndex + t + k] + g.firstVertex);
    if (!bones.includes(B.sv.bone[v[0]])) continue;
    for (const i of v) o.push(B.world[i * 3], B.world[i * 3 + 1], B.world[i * 3 + 2]);
  }
  return Float32Array.from(o);
}
/** fit an LDraw part (game axes, LDU) onto a region: the best of the 24 rotations (x 2 for a mirrored copy) by chamfer distance after the per-axis box fit */
function fitPart(src, region) {
  const small = (() => { const w = weldSoup(src); const r = w.idx.length / 3 > 220 ? decimate({ pos: w.pos, idx: w.idx }, { targetTris: 220, crease: 30 }) : { pos: w.pos, idx: w.idx }; return indexedToSoup(r.pos, r.idx); })();
  const ref = samplePts(region), step = Math.max(1, Math.floor(ref.length / 3 / 500));
  const refS = []; for (let i = 0; i < ref.length / 3; i += step) refS.push(ref[i * 3], ref[i * 3 + 1], ref[i * 3 + 2]);
  const box = bbox(region);
  let best = null;
  const longest = (b) => [0, 1, 2].reduce((m, c) => (b.hi[c] - b.lo[c] > b.hi[m] - b.lo[m] ? c : m), 0);
  for (const rot of rotations24()) {
    const r = rotated(small, rot), rb = bbox(r);
    if (longest(rb) !== longest(box)) continue;   // a bone lies along the region's long axis
    const fit = boxFit(rb, box);
    const pts = samplePts(r); const ps = []; for (let i = 0; i < pts.length / 3; i += 2) ps.push(pts[i * 3] * fit.s[0] + fit.o[0], pts[i * 3 + 1] * fit.s[1] + fit.o[1], pts[i * 3 + 2] * fit.s[2] + fit.o[2]);
    const d = chamfer(Float32Array.from(ps), Float32Array.from(refS));
    if (!best || d < best.d) best = { d, rot, fit };
  }
  return best;
}

/** { soups: { id: tris (bind pose, game units) }, bones per vertex are decided by the caller }: every part fitted, cut at its joint plane, decimated to its share of `target` */
export function buildSkeleton(zone, member, target) {
  const B = loadBody(zone, member), out = {};
  for (const p of SKEL_PARTS) {
    const region = regionTris(B, p.bones);
    if (!region.length) return null;
    let src = ldrawToGame(lib.flatten(p.ld + '.dat', { res: p.res }).tris);
    if (p.mirror) src = mirrorX(src);
    const fit = fitPart(src, region);
    let t = mapTris(rotated(src, fit.rot), fit.fit);
    const want = Math.max(24, Math.round(target * p.share));
    if (p.loft) {   // the bones are tubes: a ring loft through the levels where the cross-section changes and the joint plane (decimating the LDraw shell leaves spikes)
      const bb = bbox(t), lo = bb.lo[1], hi = bb.hi[1], K = p.loft.K, cap = p.loft.levels;
      // the blend band of the joint has a ring at each edge (and at its middle); no other ring inside it or nearer than 0.1 to those: short edges across a skin gradient stretch
      const lv = new Set([+lo.toFixed(3), +hi.toFixed(3), +(p.split.y - p.ramp).toFixed(3), +p.split.y.toFixed(3), +(p.split.y + p.ramp).toFixed(3)]);
      for (const y of shapeLevels(t, lo, hi, p.loft.tol ?? 0.006).ranked) if (lv.size < cap && y > lo + 0.02 && y < hi - 0.02 && ![...lv].some((q) => Math.abs(q - y) < 0.1)) lv.add(+y.toFixed(3));
      out[p.id] = { tris: loft(t, [...lv].sort((a, b) => a - b), K, { round: true }), chamfer: fit.d };
      continue;
    }
    for (const y of [p.split.y - p.ramp, p.split.y, p.split.y + p.ramp]) t = splitAtPlane(t, 1, y);
    const w = weldSoup(t);
    const r = w.idx.length / 3 > want ? decimate({ pos: w.pos, idx: w.idx }, { targetTris: want, crease: 28, planes: [p.split.y - p.ramp, p.split.y, p.split.y + p.ramp].map((value) => ({ axis: 1, value })) }) : { pos: w.pos, idx: w.idx };
    out[p.id] = { tris: indexedToSoup(r.pos, r.idx), chamfer: fit.d };
  }
  return out;
}

/** the skeleton as one indexed mesh with per-vertex bones: rigid per region, a linear blend across the joint band (`ramp` each side of the joint plane) */
export function packSkeleton(sk) {
  const pos = [], bone = [], weight = [], idx = [], group = [], part = [];
  SKEL_PARTS.forEach((sp, pi) => {
    const w = weldSoup(sk[sp.id].tris), base = pos.length / 3;
    for (let v = 0; v < w.pos.length / 3; v++) {
      const y = w.pos[v * 3 + 1];
      pos.push(w.pos[v * 3], y, w.pos[v * 3 + 2]);
      const th = Math.max(0, Math.min(1, (y - (sp.split.y - sp.ramp)) / (2 * sp.ramp))), b = th >= 1 ? [[sp.split.hi, 1]] : th <= 0 ? [[sp.split.lo, 1]] : [[sp.split.hi, th], [sp.split.lo, 1 - th]];
      for (let k = 0; k < 4; k++) { bone.push(b[k]?.[0] ?? 255); weight.push(b[k]?.[1] ?? 0); }
    }
    for (let t = 0; t < w.idx.length; t += 3) { idx.push(base + w.idx[t], base + w.idx[t + 1], base + w.idx[t + 2]); group.push(0); part.push(pi); }
  });
  return { pos, bone, weight, idx, group, part };
}
