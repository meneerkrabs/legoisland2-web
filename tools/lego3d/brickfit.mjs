// Fitting + verification of LDraw parts against the game's brick meshes (Bricks/lods/<name>_lod0.msh), by MEASUREMENT: the part is turned into the game's frame (p = -(x, y, z) * 0.04, then the best of the
// 24 axis rotations, bounding boxes centred), and compared with the game's own LOD 0 by (1) the bounding box per axis and (2) the symmetric surface distance (exact point / triangle distance of area-weighted
// samples, mean and 95th percentile). A brick is VERIFIED when the bbox error is <= BOX_TOL on every axis and the mean / p95 distances are below the limits. Node only (reads the game folder).
import { parseMsh } from '../../src/formats/msh.ts';
import { bboxPts, rotations24, applyRot } from './geom.mjs';
import { TriGrid, areaSample, pointStats } from './geomx.mjs';

export const S = 0.04;
export const BOX_TOL = 0.045;           // per axis (game units): the stud grid is 0.8, so this is 1/18 of a stud pitch
export const MEAN_TOL = 0.02;           // mean surface distance, game -> part and part -> game (built LOD 0 against the game LOD 0, flat undersides left out)
export const FAR_TOL = 0.08;            // at most 8 % of the surface samples (each direction) may be more than 0.1 off: a stud or two that one side lacks, not a missing wing
// "same functional element" classes (windows, doors, wheels, inverted slopes, pins, hinges ...): a real LDraw part that does the same job, looks different in details (documented per brick, looked at on the QA sheets).
export const CLASS_BOX = 0.1;           // bounding box per axis (after the per-axis fit, studs stay on the stud grid)
export const CLASS_MEAN = 0.1;          // mean surface distance of the built LOD 0 against the game's (thin frames and panes make this number a poor judge on its own: the sheets decide)
export const ctr = (b) => b.lo.map((l, i) => (l + b.hi[i]) / 2);

/** the game's brick LOD as { tris (soup), box, vertexCount, triCount, groups } (all groups); null when missing */
export function gameBrick(arch, name, lod = 0, split = null) {
  const e = arch.find(`lods/${name}_lod${lod}.msh`);
  if (!e) return null;
  const bytes = arch.read(e), m = parseMsh(bytes), t = [];
  for (const g of m.groups) for (let i = 0; i < g.indexCount; i++) { const v = m.indices[g.firstIndex + i] + g.firstVertex; t.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]); }
  const out = { tris: Float32Array.from(t), box: bboxPts(m.positions), vertexCount: m.vertexCount, triCount: m.indices.length / 3, bytes, msh: m, split };
  if (split !== null && split > 0 && split < m.vertexCount) {   // the engine draws the vertices below `split` in the first colour, the rest in the second: two surfaces
    const a = [], b = [];
    for (const g of m.groups) for (let i = 0; i < g.indexCount; i += 3) {
      const ids = [0, 1, 2].map((k) => m.indices[g.firstIndex + i + k] + g.firstVertex), second = ids.filter((v) => v >= split).length >= 2, dst = second ? b : a;
      for (const v of ids) dst.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]);
    }
    out.firstTris = Float32Array.from(a); out.secondTris = Float32Array.from(b);
  }
  return out;
}

/** LDraw triangles (LDU, LDraw axes) -> game frame (S, p = -p, rotation R, shift), winding reversed (the mapping is a reflection) */
export function toGame(tris, rot, shift) {
  const out = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 9) for (let k = 0; k < 3; k++) {
    const p = applyRot(rot, [-tris[i + k * 3] * S, -tris[i + k * 3 + 1] * S, -tris[i + k * 3 + 2] * S]), j = k === 1 ? 2 : k === 2 ? 1 : k;
    out[i + j * 3] = p[0] + shift[0]; out[i + j * 3 + 1] = p[1] + shift[1]; out[i + j * 3 + 2] = p[2] + shift[2];
  }
  return out;
}
/** the (rotation, shift) pair applied to a point of LDraw space (LDU), no winding */
export const pointToGame = (rot, shift, p) => { const q = applyRot(rot, [-p[0] * S, -p[1] * S, -p[2] * S]); return [q[0] + shift[0], q[1] + shift[1], q[2] + shift[2]]; };

/**
 * Best rotation / shift of `ldTris` (the part's full surface incl. real studs, LDU) against the game's LOD 0 `ref` ({ tris, box }).
 * Returns { rot, shift, size, boxErr (max per axis), dev: { mean, p95, max }, cands: [{ rot, mean }] } or null when no rotation has a plausible box.
 */
export function fitToGame(ldTris, ref, { n = 1200, boxLimit = 0.12, upright = true } = {}) {
  // bricks stand upright in the game (studs up): only the 4 turns about the vertical axis are tried first; the other 20 rotations only when those fit badly AND one of them is clearly better
  if (!upright) return fitRot(ldTris, ref, { n, boxLimit, only: 'all' });
  const first = fitRot(ldTris, ref, { n, boxLimit, only: 'yaw' });
  if (first && first.dev.mean <= 0.05) return first;
  const all = fitRot(ldTris, ref, { n, boxLimit, only: 'all' });
  if (!first) return all;
  return all && all.dev.mean < 0.6 * first.dev.mean ? all : first;
}
function fitRot(ldTris, ref, { n = 1200, boxLimit = 0.12, only = 'all' } = {}) {
  const src = ldTris;   // rotation search on the full (unpruned) surface; the verdict is taken on the built LOD 0 (`measureMesh`)
  const neg = Float32Array.from(src, (v) => -v * S);
  const refGrid = new TriGrid(ref.tris), refS = areaSample(ref.tris, n, true), rc = ctr(ref.box);
  const under = (y, ny) => ny < -0.5 && y < ref.box.lo[1] + 0.25;   // the undersides (the game's solid bottom, LDraw's hollow ceiling) do not count
  let best = null;
  const cands = [];
  for (const rot of rotations24()) {
    if (only === 'yaw' && rot[4] !== 1) continue;
    const r = new Float32Array(neg.length);
    for (let i = 0; i < neg.length; i += 3) r.set(applyRot(rot, [neg[i], neg[i + 1], neg[i + 2]]), i);
    const b = bboxPts(r), dim = b.size.map((v, k) => Math.abs(v - ref.box.size[k]));
    if (Math.max(...dim) > boxLimit) continue;
    const c = ctr(b), shift = [rc[0] - c[0], rc[1] - c[1], rc[2] - c[2]];
    const sh = new Float32Array(r.length);
    for (let i = 0; i < r.length; i++) sh[i] = r[i] + shift[i % 3];
    const gp = new TriGrid(sh);
    const ps = areaSample(sh, n, true), a = pointStats(refS.pts, gp, 1e9, refS.nrm, under), bb = pointStats(ps.pts, refGrid, 1e9, ps.nrm, under), mean = (a.mean + bb.mean) / 2;
    cands.push({ rot, mean });
    if (!best || mean < best.dev.mean) best = { rot, shift, size: b.size, boxErr: Math.max(...dim), dim, dev: { mean, p95: Math.max(a.p95, bb.p95), max: Math.max(a.max, bb.max), ab: a.mean, ba: bb.mean } };
  }
  if (!best) return null;
  best.cands = cands.sort((x, y) => x.mean - y.mean).slice(0, 3);
  return best;
}

/** the verdict of a BUILT mesh (soup in the game frame) against the game's LOD 0: { boxErr, dim, dev } (undersides left out) */
export function measureMesh(soup, ref, n = 1500) {
  const b = bboxPts(soup), dim = b.size.map((v, k) => Math.abs(v - ref.box.size[k])), cen = ctr(b).map((v, k) => Math.abs(v - ctr(ref.box)[k]));
  const rg = new TriGrid(ref.tris), mg = new TriGrid(soup), rs = areaSample(ref.tris, n, true), ms = areaSample(soup, n, true);
  const under = (y, ny) => ny < -0.5 && y < ref.box.lo[1] + 0.25;
  const a = pointStats(rs.pts, mg, 1e9, rs.nrm, under), bb = pointStats(ms.pts, rg, 1e9, ms.nrm, under);
  return { boxErr: Math.max(...dim), dim, centreErr: Math.max(...cen), dev: { mean: (a.mean + bb.mean) / 2, p95: Math.max(a.p95, bb.p95), max: Math.max(a.max, bb.max), far: Math.max(a.far, bb.far), ab: a.mean, ba: bb.mean } };
}
export const isVerified = (fit) => !!fit && fit.boxErr <= BOX_TOL && fit.dev.mean <= MEAN_TOL && fit.dev.far <= FAR_TOL;
export function reason(fit) {
  if (!fit) return 'no rotation with a similar bounding box';
  const r = [];
  if (fit.boxErr > BOX_TOL) r.push(`box ${fit.boxErr.toFixed(3)} > ${BOX_TOL}`);
  if (fit.dev.mean > MEAN_TOL) r.push(`mean ${fit.dev.mean.toFixed(3)} > ${MEAN_TOL}`);
  if (fit.dev.far > FAR_TOL) r.push(`far ${(fit.dev.far * 100).toFixed(1)}% > ${FAR_TOL * 100}%`);
  return r.join(', ');
}

// ---------------------------------------------------------------------------------------------------- stud layout (same function as in tools/tests/lego3d-bricks.mjs)
/**
 * Stud rings of a mesh (positions: flat xyz): vertices that share a height (0.004) are linked (< 0.25 apart); a cluster of >= 6 vertices with a stud-sized extent (0.42 .. 0.56 on both axes) is a stud
 * top; the highest ring per position is kept. Returns [[x, y, z], ...].
 */
export function studTops(positions) {
  const by = new Map(), n = positions.length / 3;
  for (let i = 0; i < n; i++) { const k = Math.round(positions[i * 3 + 1] / 0.004); if (!by.has(k)) by.set(k, []); by.get(k).push([positions[i * 3], positions[i * 3 + 2], positions[i * 3 + 1]]); }
  const out = [];
  for (const pts of by.values()) {
    if (pts.length < 6) continue;
    const par = pts.map((_, i) => i), find = (i) => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < 0.25) par[find(i)] = find(j);
    const cl = new Map();
    pts.forEach((p, i) => { const r = find(i); if (!cl.has(r)) cl.set(r, []); cl.get(r).push(p); });
    for (const c of cl.values()) {
      if (c.length < 6) continue;
      const xs = c.map((p) => p[0]), zs = c.map((p) => p[1]), dx = Math.max(...xs) - Math.min(...xs), dz = Math.max(...zs) - Math.min(...zs);
      if (dx >= 0.42 && dx <= 0.56 && dz >= 0.42 && dz <= 0.56) out.push([(Math.max(...xs) + Math.min(...xs)) / 2, c[0][2], (Math.max(...zs) + Math.min(...zs)) / 2]);
    }
  }
  out.sort((p, q) => q[1] - p[1]);
  const tops = [];
  for (const r of out) if (!tops.some((t) => Math.hypot(t[0] - r[0], t[2] - r[2]) < 0.12)) tops.push(r);
  return tops;
}
/** the rings on the 0.8 grid of the lattice phase ph = [x, z] */
export const studsOnGrid = (rings, ph) => rings.filter((r) => [0, 2].every((k, i) => { const d = Math.abs((((r[k] - ph[i]) % 0.8) + 0.8) % 0.8); return Math.min(d, 0.8 - d) < 0.09; }));
/** stud layout of a built mesh against the game's: { nGame, nNew, worst } (worst = largest nearest-neighbour distance either way, horizontal and vertical); null when the game's brick has no studs on the grid */
export function studDiff(posNew, posGame) {
  const so0 = studTops(posGame);
  if (!so0.length) return null;
  const ph = [so0[0][0], so0[0][2]], so = studsOnGrid(so0, ph), sn = studsOnGrid(studTops(posNew), ph);
  const dist = (s, q) => Math.max(Math.hypot(q[0] - s[0], q[2] - s[2]), Math.abs(q[1] - s[1]));
  let w = 0;
  for (const s of so) w = Math.max(w, Math.min(...sn.map((q) => dist(s, q)), 9));
  for (const s of sn) w = Math.max(w, Math.min(...so.map((q) => dist(s, q)), 9));
  return { nGame: so.length, nNew: sn.length, worst: w };
}
