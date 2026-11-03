// Grips: where a hand holds a tool. Builder only (docs/re/lego3d.md section 9, "Round 11").
//
// The LDraw claw 3820 holds a bar in its C-shaped ring: the ring is a cylinder hole (axis = the claw's y axis, radius 4 LDU = the radius of every handle bar of the library's
// minifig tools, opening toward +z). A tool that is meant for the claw has a cylindrical handle of that radius, and by LDraw convention the part's origin sits in the middle of
// that handle (exceptions in the table: the goblet's stem, the mug's handle). The game's own tools are authored the same way: a handle bar through the game's hand.
// This module measures both ends from the geometry (nothing is typed in by hand but the exceptions):
//   clawRing()        the ring hole of the std claw: centre, axis, radius, in the claw's own LDU frame (game axes)
//   handGrip(fit)     the same line in the game hand's coordinate system (= the bone's), through the fit that places the claw on the game's hand mesh (chars-hand.mjs fitHand)
//   partGrip(name)    the handle of an LDraw tool part: point + axis in game axes and game units (UNIT), from the cylinder vote below or the table's `grips` exceptions
// and the algebra that moves a fitted part so that its handle lies in the claw's ring.
import { cleanHand, fitHand } from './chars-hand.mjs';
import { lib, UNIT, areaSamples } from './chars-gear-fit.mjs';
import { archive } from '../lib.mjs';
import { applyRot } from '../geom.mjs';
import { groupMatrices, parseMsh } from '../../../src/formats/msh.ts';
import GEAR_TABLE from './chars-gear-table.json' with { type: 'json' };

const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** triangles of a soup as { n (unit normal), a (area), c (centroid), v (corners) } */
function faces(t) {
  const out = [];
  for (let i = 0; i < t.length; i += 9) {
    const e1 = [t[i + 3] - t[i], t[i + 4] - t[i + 1], t[i + 5] - t[i + 2]], e2 = [t[i + 6] - t[i], t[i + 7] - t[i + 1], t[i + 8] - t[i + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = len(n);
    if (l < 1e-9) continue;
    out.push({ n: [n[0] / l, n[1] / l, n[2] / l], a: l / 2, c: [(t[i] + t[i + 3] + t[i + 6]) / 3, (t[i + 1] + t[i + 4] + t[i + 7]) / 3, (t[i + 2] + t[i + 5] + t[i + 8]) / 3], v: [t.subarray(i, i + 3), t.subarray(i + 3, i + 6), t.subarray(i + 6, i + 9)] });
  }
  return out;
}
/**
 * The cylinder of radius `rMin..rMax` along axis `ax` that most area of the soup lies on (faces whose normal is radial and perpendicular to the axis), by voting over the centre positions
 * (grid `step`, centres within `reach` of `near`). Returns { ax, c (3D, the axial coordinate = the middle of the voting faces), r, lo, hi (axial extent), w (area) } or null.
 */
function voteCylinder(F, ax, { rMin = 3.3, rMax = 4.5, near = [0, 0], reach = 40, step = 0.25, concave = false } = {}) {
  const u = (ax + 1) % 3, v = (ax + 2) % 3, H = F.filter((f) => Math.abs(f.n[ax]) < 0.12);
  let best = null;
  for (let cu = near[0] - reach; cu <= near[0] + reach; cu += step) for (let cv = near[1] - reach; cv <= near[1] + reach; cv += step) {
    let w = 0, s = 0, lo = 1e9, hi = -1e9;
    const iv = [];
    for (const f of H) {
      const du = f.c[u] - cu, dv = f.c[v] - cv, d = Math.hypot(du, dv);
      if (d < rMin || d > rMax) continue;
      const radial = (f.n[u] * du + f.n[v] * dv) / d / Math.hypot(f.n[u], f.n[v]);
      if (concave ? -radial < 0.97 : Math.abs(radial) < 0.97) continue;   // concave: the wall of a hole (its normal looks at the axis)
      w += f.a; s += f.a * d;
      let a0 = 1e9, a1 = -1e9;
      for (const p of f.v) { a0 = Math.min(a0, p[ax]); a1 = Math.max(a1, p[ax]); }
      lo = Math.min(lo, a0); hi = Math.max(hi, a1); iv.push([a0, a1, f.c[ax], f.a]);
    }
    if (w > 0 && (!best || w > best.w)) best = { ax, cu, cv, w, r: s / w, lo, hi, iv };
  }
  if (!best) return null;
  const c = [0, 0, 0]; c[u] = best.cu; c[v] = best.cv; c[ax] = (best.lo + best.hi) / 2;
  return { ax, c, r: best.r, lo: best.lo, hi: best.hi, w: best.w, iv: best.iv };
}

let ring = null;
/** the ring hole of the std claw, in the claw's own frame (LDU, game axes): { c, a (unit), r } */
export function clawRing() {
  if (ring) return ring;
  const F = faces(cleanHand('std').tris);
  let best = null;
  for (const ax of [0, 1, 2]) { const r = voteCylinder(F, ax, { rMin: 3.3, rMax: 4.6, near: [0, 0], reach: 14, step: 0.1, concave: true }); if (r && (!best || r.w > best.w)) best = r; }
  // the vote's axial extent includes the bevels: the middle of it is the ring's middle
  return (ring = { c: best.c, a: AXES[best.ax], r: best.r });
}
/** the claw ring in the coordinate system of the game's hand mesh, through the fit { rot, s, o } of chars-hand.mjs: { c, a, r } (game units) */
export function handGrip(fit) {
  const R = clawRing(), p = applyRot(fit.rot, R.c);
  return { c: [fit.s * p[0] + fit.o[0], fit.s * p[1] + fit.o[1], fit.s * p[2] + fit.o[2]], a: unit(applyRot(fit.rot, R.a)), r: R.r * fit.s };
}

/** a handle bar up to this long (LDU) is gripped in its middle */
const BAR_SHORT = 24;
/** the merged axial run of the voting faces that holds (or is nearest to) the part's origin: [lo, hi] */
function barRun(iv) {
  const s = [...iv].sort((a, b) => a[0] - b[0]), runs = [];
  for (const [a, b] of s) { const last = runs[runs.length - 1]; if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b); else runs.push([a, b]); }
  runs.sort((x, y) => Math.max(x[0] - 0, 0 - x[1], 0) - Math.max(y[0] - 0, 0 - y[1], 0));
  const run = runs[0];
  if (!run) return null;
  // the middle of the run by area (a guard's few faces at one end do not pull it)
  const inside = iv.filter(([a, b]) => a >= run[0] - 1e-6 && b <= run[1] + 1e-6).sort((x, y) => x[2] - y[2]), tot = inside.reduce((q, f) => q + f[3], 0);
  let acc = 0, med = (run[0] + run[1]) / 2;
  for (const f of inside) { acc += f[3]; if (acc >= tot / 2) { med = f[2]; break; } }
  return { lo: run[0], hi: run[1], med };
}
const gripCache = new Map();
/**
 * The handle of the LDraw part `name`: { p (point on the axis, game axes, game units), a (unit axis), r (game units), lo, hi (the bar's extent along the axis, game units, along `a`), why }.
 * Table exceptions (`grips`: native LDraw LDU point + axis letter) first, else the cylinder vote around the part's origin (LDraw convention: the origin is in the handle).
 */
export function partGrip(name) {
  if (gripCache.has(name)) return gripCache.get(name);
  let g = null;
  const ex = GEAR_TABLE.grips?.[name];
  if (ex) g = { p: ex.p.map((x) => -x * UNIT), a: AXES['xyz'.indexOf(ex.a)], r: 4 * UNIT, why: 'table' };
  else {
    const f = lib.flatten(name + '.dat', { res: 'std', skip: /stud/ });
    const F = faces(f.tris);   // native LDraw axes: negated to the game's below (ldrawToGame is p -> -p)
    let best = null;
    for (const ax of [0, 1, 2]) { const r = voteCylinder(F, ax, { rMin: 3.3, rMax: 4.5, near: [0, 0], reach: 0.5, step: 0.25 }); if (r && (!best || r.w > best.w)) best = r; }
    if (best) {
      // along the axis: the bar's own middle when the bar is short (a sword's grip between its guard and its pommel: the claw holds it there), else the part's origin (an axe's shaft, a lance: LDraw puts the origin where the hand goes)
      const run = barRun(best.iv), along = run && run.hi - run.lo >= 8 && run.hi - run.lo <= BAR_SHORT ? run.med : 0;
      const p = [-best.c[0], -best.c[1], -best.c[2]].map((x, i) => (i === best.ax ? 0 : Math.abs(x) < 0.5 ? 0 : x));
      p[best.ax] = -along;
      g = { p: p.map((x) => x * UNIT), a: AXES[best.ax], r: best.r * UNIT, why: along ? 'vote, middle of the bar' : 'vote, origin', run: run && [run.lo, run.hi] };
    }
  }
  gripCache.set(name, g);
  return g;
}

/** where the grip line of a part ends up through pose (rot, 3x3 row-major) and the per-axis fit { s, o }: { p, a } */
export function posedGrip(g, pose, fit) {
  const q = applyRot(pose.rot, g.p), p = [q[0] * fit.s[0] + fit.o[0], q[1] * fit.s[1] + fit.o[1], q[2] * fit.s[2] + fit.o[2]];
  const d = applyRot(pose.rot, g.a);
  return { p, a: unit([d[0] * fit.s[0], d[1] * fit.s[1], d[2] * fit.s[2]]), r: g.r };
}
/** the angle (degrees, 0..90: a bar has no direction) between two axes */
export const axisAngle = (a, b) => (Math.acos(Math.min(1, Math.abs(dot(unit(a), unit(b))))) * 180) / Math.PI;
/** error of a handle line `g` ({ p, a }) against the ring `h` ({ c, a }) at the ring's centre: lateral = distance of the line from the ring's axis at the ring's centre, axial = how far the handle point is from the centre along the ring's axis, angle in degrees */
export function gripError(g, h) {
  const d = sub(g.p, h.c), ax = unit(h.a), along = dot(d, ax), lat = len(sub(d, [ax[0] * along, ax[1] * along, ax[2] * along]));
  return { lateral: lat, axial: Math.abs(along), angle: axisAngle(g.a, h.a), dist: len(d) };
}

// ---- the mesh's own frame: the game draws a mesh as v * MATL * bone (group matrices, formats/msh.ts groupMatrices); the fit works on the raw vertices
const det3 = (m) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
const inv3 = (m) => { const d = det3(m), s = 1 / d; return [(m[4] * m[8] - m[5] * m[7]) * s, (m[2] * m[7] - m[1] * m[8]) * s, (m[1] * m[5] - m[2] * m[4]) * s, (m[5] * m[6] - m[3] * m[8]) * s, (m[0] * m[8] - m[2] * m[6]) * s, (m[2] * m[3] - m[0] * m[5]) * s, (m[3] * m[7] - m[4] * m[6]) * s, (m[1] * m[6] - m[0] * m[7]) * s, (m[0] * m[4] - m[1] * m[3]) * s]; };
const rowMul = (v, m) => [v[0] * m[0] + v[1] * m[3] + v[2] * m[6], v[0] * m[1] + v[1] * m[4] + v[2] * m[7], v[0] * m[2] + v[1] * m[5] + v[2] * m[8]];
/**
 * The matrix that takes the raw vertices of a parsed mesh into its bone's frame (`v' = v * M`), or null when its groups do not all share ONE matrix (the fit works on the raw vertices of
 * the whole mesh: a mesh whose groups sit in different frames has no single "raw" frame). The identity (no MATL) is { R: identity, t: 0 }.
 */
export function rawFrame(m) {
  const M = groupMatrices(m);
  const first = M.find((x) => x);
  if (first && M.some((x) => !x || x.some((v, i) => Math.abs(v - first[i]) > 1e-6))) return null;
  if (!first) return { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], k: 1 };
  const R = [first[0], first[1], first[2], first[4], first[5], first[6], first[8], first[9], first[10]];
  return { R, t: [first[12], first[13], first[14]], k: Math.cbrt(Math.abs(det3(R))) };
}
/** a line { c, a, r } in the bone's frame -> the mesh's raw frame */
export function boneToRaw(F, h) {
  const Ri = inv3(F.R), c = rowMul([h.c[0] - F.t[0], h.c[1] - F.t[1], h.c[2] - F.t[2]], Ri);
  return { c, a: unit(rowMul(h.a, Ri)), r: h.r / F.k };
}
/** a line { c, a, r } in a mesh's raw frame -> its bone's frame (the inverse of boneToRaw) */
export function rawToBone(F, h) {
  const c = rowMul(h.c, F.R);
  return { c: [c[0] + F.t[0], c[1] + F.t[1], c[2] + F.t[2]], a: unit(rowMul(h.a, F.R)), r: h.r * F.k };
}

// ---- the hand's turn: which way the game's tools run through it
/** a parsed mesh in its bone's frame (every group through its matrix, as the game draws it): flat triangle soup */
export function boneSoup(m) {
  const M = groupMatrices(m), out = [];
  m.groups.forEach((g, gi) => {
    const T = M[gi];
    for (let k = 0; k < g.indexCount; k++) {
      const v = m.indices[g.firstIndex + k] + g.firstVertex, x = m.positions[v * 3], y = m.positions[v * 3 + 1], z = m.positions[v * 3 + 2];
      if (T) out.push(x * T[0] + y * T[4] + z * T[8] + T[12], x * T[1] + y * T[5] + z * T[9] + T[13], x * T[2] + y * T[6] + z * T[10] + T[14]); else out.push(x, y, z);
    }
  });
  return Float32Array.from(out);
}
/** principal axis of 3D points: { c (centroid), a (unit), ratio (largest / second eigenvalue) } */
function pca(pts) {
  const mu = [0, 1, 2].map((k) => pts.reduce((q, p) => q + p[k], 0) / pts.length), C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += (p[i] - mu[i]) * (p[j] - mu[j]);
  const top = (M, v) => { let l = 0; for (let it = 0; it < 80; it++) { const w = [0, 1, 2].map((i) => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]); l = Math.hypot(...w) || 1; v = w.map((x) => x / l); } return { v, l }; };
  const a = top(C, [1, 0.7, 0.4]);
  const D = C.map((r, i) => r.map((x, j) => x - a.l * a.v[i] * a.v[j])), b = top(D, [0.3, 1, 0.5]);
  return { c: mu, a: a.v, ratio: a.l / (b.l || 1e-12) };
}
const heldCache = new Map();
/**
 * The directions (unit vectors in the HAND MESH's own frame) along which the game's tools run through the hand mesh `hm` of this LOD: for every tool the models hand `handHash` hold, the
 * principal axis of its surface in a ball of 0.4 around the hand's centre (the handle bar, the shaft), when it is clearly one direction (ratio >= 2.5) within 25 degrees of a coordinate axis (snapped
 * to it). Empty when no tool is held.
 */
export function heldAxes(inv, handHash, li, hm) {
  const key = `${handHash}|${li}`;
  if (heldCache.has(key)) return heldCache.get(key);
  const F = rawFrame(hm), out = [];
  if (F) {
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let i = 0; i < hm.positions.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], hm.positions[i + c]); hi[c] = Math.max(hi[c], hm.positions[i + c]); }
    const cb = rawToBone(F, { c: [0, 1, 2].map((c) => (lo[c] + hi[c]) / 2), a: [0, 0, 1], r: 0 }).c, seen = new Set(), Ri = inv3(F.R);
    for (const o of inv.models) for (const [hs, as] of [[6, 7], [8, 9]]) {
      const h = o.attach.find((x) => x?.slot === hs), a = o.attach.find((x) => x?.slot === as), hp = h?.parts[Math.min(li, h.parts.length - 1)], ap = a?.parts[Math.min(li, a.parts.length - 1)];
      if (hp?.hash !== handHash || !ap?.hash || seen.has(ap.hash)) continue;
      seen.add(ap.hash);
      const A = archive(o.zone), e = A.find(ap.member); if (!e) continue;
      const tm = parseMsh(A.read(e));
      if (tm.indices.length / 3 < 40) continue;   // a card (the skeleton's score card, 12 triangles) has no handle bar
      const soup = boneSoup(tm), s = areaSamples(soup, 6000), pts = [];
      for (let i = 0; i < s.P.length; i += 3) if (Math.hypot(s.P[i] - cb[0], s.P[i + 1] - cb[1], s.P[i + 2] - cb[2]) <= 0.4) pts.push([s.P[i], s.P[i + 1], s.P[i + 2]]);
      if (pts.length < 30) continue;
      const q = pca(pts); if (q.ratio < 2.5) continue;
      const k = [0, 1, 2].sort((x, y) => Math.abs(q.a[y]) - Math.abs(q.a[x]))[0];
      if (Math.abs(q.a[k]) < Math.cos((25 * Math.PI) / 180)) continue;
      const ax = [0, 0, 0]; ax[k] = 1;
      const raw = unit(rowMul(ax, Ri));
      if (!out.some((r) => Math.abs(r[0] * raw[0] + r[1] * raw[1] + r[2] * raw[2]) > 0.99)) out.push(raw);
    }
  }
  heldCache.set(key, out);
  return out;
}
/** the claw fit of a game hand (`hp` = the inventory part, `li` its LOD, `hm` the parsed hand mesh), turned so that the tools the models hold go through the ring (heldAxes + chars-hand.mjs fitHand) */
export function fitHandHeld(inv, hp, li, hm) {
  return fitHand(hm.positions, Array.from(hm.indices), li === 0 ? 'std' : 'low', { ringAxes: heldAxes(inv, hp.hash, li, hm) });
}
