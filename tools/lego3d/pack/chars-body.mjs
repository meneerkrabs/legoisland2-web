// Body parts of the minifig layouts: LDraw part -> fitted to the original's regions (bind pose), pruned, decimated, skinned. Used by chars.mjs.
import path from 'node:path';
import { LDRAW } from '../lib.mjs';
import { LDrawLib } from '../ldraw.mjs';
import { pruneHidden, capSmallHoles, splitAtPlane } from '../geom.mjs';
import { ldrawToGame, bbox, boxFit, mapTris, regionBox, kernelSkin, AXIS, BONES } from './chars-core.mjs';

export const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
const P = (v) => [v[0], v[1], v[2]];
/** keep only the triangles whose centroid satisfies `keep` (game axes, LDU) */
const filterTris = (t, keep) => { const o = []; for (let i = 0; i < t.length; i += 9) { const c = [(t[i] + t[i + 3] + t[i + 6]) / 3, (t[i + 1] + t[i + 4] + t[i + 7]) / 3, (t[i + 2] + t[i + 5] + t[i + 8]) / 3]; if (keep(c)) o.push(...t.subarray(i, i + 9)); } return Float32Array.from(o); };

/**
 * The parts of the minifig body. `srcBox` = the part of the LDraw part (game axes, LDU) that is fitted onto the original region `region` of the HR mesh (groups / primary bones);
 * geometry outside the srcBox (neck stud, hinge) lands proportionally outside the target box. `drop` removes triangles by centroid before the fit (pegs that are hidden inside the
 * neighbouring part). `rotZ` = lean of the part about z (radians, about the pivot given in target coordinates, applied after the fit).
 */
export const PARTS = {
  hips: { ld: '3815b', skinKey: 'hips', srcBox: { lo: [-18, -8, -10], hi: [18, 0, 10] }, drop: (c) => c[1] < -9 || c[1] > 6 },
  'leg +x': { ld: '3816', skinKey: 'leg', srcBox: { lo: [1.5, -28, -9], hi: [19.5, 0, 11] }, drop: (c) => c[1] > 1 },
  'leg -x': { ld: '3817', skinKey: 'leg', srcBox: { lo: [-19.5, -28, -9], hi: [-1.5, 0, 11] }, drop: (c) => c[1] > 1 },
  torso: { ld: '973', skinKey: 'torso', srcBox: { lo: [-19, -32, -10], hi: [19, 0, 10] }, drop: (c) => c[1] > 0.5 },
  'arm +x': { ld: '3818', skinKey: 'arm', srcBox: { lo: [0, -22.4, -6.5], hi: [10.1, 6.5, 6.5] }, drop: (c) => c[0] < 0.3 },
  'arm -x': { ld: '3819', skinKey: 'arm', srcBox: { lo: [-10.1, -22.4, -6.5], hi: [0, 6.5, 6.5] }, drop: (c) => c[0] > -0.3 },
};

/** the fit of every part of a layout: target boxes from the original HR (bind pose). `spec.regions[part] = { groups, bones }` */
export function fitsOf(B, spec) {
  const fits = {};
  for (const [id, part] of Object.entries(PARTS)) {
    const reg = spec.regions[id];
    const r = regionBox(B, reg.groups, reg.bones);
    let dst = { lo: [...r.lo], hi: [...r.hi] };
    if (reg.override) for (const [c, [a, b]] of Object.entries(reg.override)) { dst.lo[+c] = a; dst.hi[+c] = b; }
    const src = part.srcBox;
    fits[id] = { ...boxFit(src, dst), dst, src };
    if (id.startsWith('arm')) {   // the axis of the original arm (it leans outward): centres of its solid vertices in the top and bottom third, as a line over y
      const pts = []; for (let v = 0; v < B.msh.vertexCount; v++) { if (reg.groups && !reg.groups.includes(B.groupOf[v])) continue; if (reg.bones && !reg.bones.includes(B.sv.bone[v])) continue; pts.push([B.world[v * 3], B.world[v * 3 + 1], B.world[v * 3 + 2]]); }
      const ylo = dst.lo[1], yh = dst.hi[1], third = (yh - ylo) / 3, mean = (sel) => { const q = pts.filter(sel); return [q.reduce((s, p) => s + p[0], 0) / q.length, q.reduce((s, p) => s + p[1], 0) / q.length, q.reduce((s, p) => s + p[2], 0) / q.length]; };
      const top = mean((p) => p[1] > yh - third), bot = mean((p) => p[1] < ylo + third);
      fits[id].axis = (y) => { const t = (y - bot[1]) / (top[1] - bot[1]); return [bot[0] + (top[0] - bot[0]) * t, bot[2] + (top[2] - bot[2]) * t]; };
    }
  }
  return fits;
}
/** one part, one LDraw resolution: game axes, hidden faces and pegs dropped, fitted, small holes capped -> triangle soup in the reference pose */
export function partTris(id, fit, res) {
  const c = cleanPart(id, res);
  return { tris: mapTris(c.tris, fit), infos: c.infos };
}

import { decimate } from '../../../src/mods/lego3d/geom/decimate.ts';
/** triangle soup -> indexed (welded by position) */
export function weldSoup(t, eps = 1e-5) {
  const map = new Map(), pos = [], idx = [];
  for (let i = 0; i < t.length; i += 3) {
    const k = `${Math.round(t[i] / eps)},${Math.round(t[i + 1] / eps)},${Math.round(t[i + 2] / eps)}`;
    let id = map.get(k); if (id === undefined) { id = pos.length / 3; map.set(k, id); pos.push(t[i], t[i + 1], t[i + 2]); }
    idx.push(id);
  }
  // drop degenerate triangles (`keep` = the source triangle of every kept one)
  const out = [], keep = []; for (let i = 0; i < idx.length; i += 3) if (idx[i] !== idx[i + 1] && idx[i + 1] !== idx[i + 2] && idx[i] !== idx[i + 2]) { out.push(idx[i], idx[i + 1], idx[i + 2]); keep.push(i / 3); }
  return { pos: Float32Array.from(pos), idx: Uint32Array.from(out), keep: Int32Array.from(keep) };
}
export const indexedToSoup = (pos, idx) => { const o = new Float32Array(idx.length * 3); for (let i = 0; i < idx.length; i++) { o[i * 3] = pos[idx[i] * 3]; o[i * 3 + 1] = pos[idx[i] * 3 + 1]; o[i * 3 + 2] = pos[idx[i] * 3 + 2]; } return o; };
/** decimates a soup to about `target` triangles (coplanar merge first: the cost of a flat collapse is 0) */
export function decimateSoup(t, target, opts = {}) {
  const w = weldSoup(t);
  if (w.idx.length / 3 <= target) return indexedToSoup(w.pos, w.idx);
  const r = decimate({ pos: w.pos, idx: w.idx }, { targetTris: target, crease: opts.crease ?? 30, ...opts });
  return indexedToSoup(r.pos, r.idx);
}

import { fixTJunctions, planeCap, visiblePrune } from './chars-geom.mjs';
import { capSmallHoles as capSmall } from '../geom.mjs';
/** per part: the planes (game axes, LDU) at which the opening is closed with a hull cap */
export const CAPS = { torso: [[1, -32, -1], [1, 0, 1]], 'leg +x': [[1, 0, 1]], 'leg -x': [[1, 0, 1]], hips: [], 'arm +x': [], 'arm -x': [] };
const prepCache = new Map();
/** a part as a clean outside-only shell in LDraw game axes (LDU): no studs, T-junctions fixed, openings capped, inside pruned */
export function cleanPart(id, res = 'std') {
  const key = `${id}|${res}`;
  if (prepCache.has(key)) return prepCache.get(key);
  const part = PARTS[id];
  const f = lib.flatten(part.ld + '.dat', { res, skip: /stud/ });
  let t = fixTJunctions(ldrawToGame(f.tris)).tris;
  if (part.drop) t = filterTris(t, (c) => !part.drop(c));
  for (const [ax, at, sg] of CAPS[id] ?? []) t = planeCap(t, ax, at, sg).tris;
  t = visiblePrune(t);
  t = capSmall(fixTJunctions(t).tris, 120, 80).tris;
  t = visiblePrune(t);
  const r = { tris: t, infos: f.infos };
  prepCache.set(key, r);
  return r;
}
