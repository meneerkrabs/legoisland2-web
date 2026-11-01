// Fitting of LDraw parts onto the game's hair / headgear / accessory meshes (builder only): the candidate pool, outer-surface samples, the box fit under all rotations, chamfer scores.
// Nothing of the game's vertices ends up in the pack: only the chosen part, its rotation / mirror and the per-axis fit (numbers measured from the mesh's bounding box).
import fs from 'node:fs';
import path from 'node:path';
import { LDRAW } from '../lib.mjs';
import { LDrawLib } from '../ldraw.mjs';
import { ldrawToGame } from './chars-core.mjs';
import { fixTJunctions } from './chars-geom.mjs';
import { rotations24 } from '../geom.mjs';

export const UNIT = 0.04;
export const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
export const HEAD_RE = /Hair|Cap\b|Hat\b|Helmet|Headdress|Crown|Hood|Mask|Visor|Wig|Turban|Headgear|Beard|Tiara|Bonnet/i;
const BAD_RE = /^Minifig (Arm|Leg|Torso|Hips|Head\b|Hand|Neck|Body|Foot|Shoe|Skirt|Armour|Armor|Apron|Collar|Vest|Bowtie|Sticker)|Obsolete|Needs Work|Sticker|Duplo|Fabuland/i;

let titles = null;
/** [{ name, title }] of the candidate pool: minifig accessories of the library (no prints, stickers, obsolete or alias files) */
export function poolNames() {
  if (titles) return titles;
  const dir = path.join(LDRAW, 'lib/ldraw/parts'), out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const m = f.match(/^(\d+[a-z]?(?:c0\d)?)\.dat$/); if (!m) continue;
    const fd = fs.openSync(path.join(dir, f), 'r'); const buf = Buffer.alloc(160); fs.readSync(fd, buf, 0, 160, 0); fs.closeSync(fd);
    const title = buf.toString('utf8').split(/\r?\n/)[0].replace(/^0\s*/, '').trim();
    if (!/^Minifig /.test(title) || BAD_RE.test(title)) continue;
    out.push({ name: m[1], title });
  }
  return (titles = out);
}

// ---- samples
/** n deterministic samples spread by area over a soup: Float32Array xyz + normals */
export function areaSamples(t, n) {
  const T = t.length / 9, cum = new Float64Array(T);
  let tot = 0;
  for (let i = 0; i < T; i++) {
    const o = i * 9, e1 = [t[o + 3] - t[o], t[o + 4] - t[o + 1], t[o + 5] - t[o + 2]], e2 = [t[o + 6] - t[o], t[o + 7] - t[o + 1], t[o + 8] - t[o + 2]];
    tot += 0.5 * Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]); cum[i] = tot;
  }
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
  let ti = 0;
  for (let k = 0; k < n; k++) {
    const target = ((k + 0.5) / n) * tot;
    while (ti < T - 1 && cum[ti] < target) ti++;
    const o = ti * 9, lo = ti ? cum[ti - 1] : 0, f = (target - lo) / ((cum[ti] - lo) || 1);
    // low-discrepancy point inside the triangle from (k golden) and f
    let u = (k * 0.7548776662466927) % 1, v = (k * 0.5698402909980532 + f * 0.37) % 1;
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    for (let c = 0; c < 3; c++) P[k * 3 + c] = t[o + c] * (1 - u - v) + t[o + 3 + c] * u + t[o + 6 + c] * v;
    const e1 = [t[o + 3] - t[o], t[o + 4] - t[o + 1], t[o + 5] - t[o + 2]], e2 = [t[o + 6] - t[o], t[o + 7] - t[o + 1], t[o + 8] - t[o + 2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0]; const l = Math.hypot(nx, ny, nz) || 1;
    N[k * 3] = nx / l; N[k * 3 + 1] = ny / l; N[k * 3 + 2] = nz / l;
  }
  return { P, N };
}
const DIRS = (() => { const d = []; for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) { const l = Math.hypot(x, y, z); d.push([x / l, y / l, z / l]); } return d; })();
/** keeps the samples that can be seen from outside (a z-buffer of the samples themselves from 26 directions, normals towards the viewer): cheap stand-in for visiblePrune */
export function outerSamples(P, N, res = 40) {
  const n = P.length / 3, keep = new Uint8Array(n);
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], P[i * 3 + c]); hi[c] = Math.max(hi[c], P[i * 3 + c]); }
  const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1, cell = ext / res, eps = ext * 0.03;
  for (const d of DIRS) {
    // basis
    const a = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let r = [a[1] * d[2] - a[2] * d[1], a[2] * d[0] - a[0] * d[2], a[0] * d[1] - a[1] * d[0]]; const rl = Math.hypot(...r); r = r.map((x) => x / rl);
    const u = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
    const W = res * 2 + 3, buf = new Float32Array(W * W).fill(-1e9), px = new Int32Array(n), py = new Int32Array(n), dz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      px[i] = Math.floor((x * r[0] + y * r[1] + z * r[2]) / cell) + res + 1; py[i] = Math.floor((x * u[0] + y * u[1] + z * u[2]) / cell) + res + 1; dz[i] = x * d[0] + y * d[1] + z * d[2];
      // splat to the 3x3 neighbourhood (closes the gaps between samples)
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const k = (py[i] + b) * W + px[i] + a; if (dz[i] > buf[k]) buf[k] = dz[i]; }
    }
    for (let i = 0; i < n; i++) if (!keep[i] && N[i * 3] * d[0] + N[i * 3 + 1] * d[1] + N[i * 3 + 2] * d[2] > 0.05 && dz[i] >= buf[py[i] * W + px[i]] - eps) keep[i] = 1;
  }
  const out = [], on = [];
  for (let i = 0; i < n; i++) if (keep[i]) { out.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); on.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); }
  return { P: Float32Array.from(out), N: Float32Array.from(on) };
}

// ---- pool
const poolCache = new Map();
/** a candidate part in game axes and game units (LDU x 0.04), T-junctions fixed; plus outer samples and its box */
export function loadPart(name, res = 'low') {
  const key = name + '|' + res;
  if (poolCache.has(key)) return poolCache.get(key);
  let r = null;
  try {
    const f = lib.flatten(name + '.dat', { res, skip: /stud/ });
    if (f.tris.length >= 9) {
      const t = ldrawToGame(f.tris); for (let i = 0; i < t.length; i++) t[i] *= UNIT;
      const box = bboxOf(t), s = areaSamples(t, 700), o = outerSamples(s.P, s.N);
      r = { name, tris: t, infos: f.infos, colors: f.colors, box, samples: o, ntris: t.length / 9 };
    }
  } catch (e) { r = null; }
  poolCache.set(key, r);
  return r;
}
export function bboxOf(t) { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < t.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], t[i + c]); hi[c] = Math.max(hi[c], t[i + c]); } return { lo, hi, size: hi.map((h, i) => h - lo[i]) }; }

// ---- transforms: a "pose" = { rot (3x3 row-major, may be a reflection), mirror }, then per-axis box fit
export const HEAD_ROTS = (() => { const o = []; for (const mir of [false, true]) for (let k = 0; k < 4; k++) { const c = Math.round(Math.cos(k * Math.PI / 2)), s = Math.round(Math.sin(k * Math.PI / 2)); const m = [c, 0, s, 0, 1, 0, -s, 0, c]; if (mir) { m[0] = -m[0]; m[3] = -m[3]; m[6] = -m[6]; } o.push({ rot: m, mirror: mir, yaw: k * 90 }); } return o; })();
export const ALL_ROTS = (() => { const o = []; for (const m of rotations24()) for (const mir of [false, true]) { const r = m.slice(); if (mir) { r[0] = -r[0]; r[3] = -r[3]; r[6] = -r[6]; } o.push({ rot: r, mirror: mir, yaw: -1 }); } return o; })();
const rotPt = (m, x, y, z) => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
/** box of the rotated box (exact for axis-aligned rotations) */
export function rotBox(box, m) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let k = 0; k < 8; k++) { const p = rotPt(m, k & 1 ? box.hi[0] : box.lo[0], k & 2 ? box.hi[1] : box.lo[1], k & 4 ? box.hi[2] : box.lo[2]); for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], p[c]); hi[c] = Math.max(hi[c], p[c]); } }
  return { lo, hi, size: hi.map((h, i) => h - lo[i]) };
}
/** per-axis fit of the rotated part box to the target box: scale + offset (applied after the rotation) */
export function fitOf(rbox, dst) {
  const s = [0, 1, 2].map((c) => (dst.hi[c] - dst.lo[c]) / (rbox.hi[c] - rbox.lo[c] || 1e-6));
  return { s, o: [0, 1, 2].map((c) => dst.lo[c] - rbox.lo[c] * s[c]) };
}
export const scaleOk = (s, lo = 0.55, hi = 1.8, ratio = 1.7) => { const mn = Math.min(...s), mx = Math.max(...s); return mn >= lo && mx <= hi && mx / mn <= ratio; };
export function applyPose(pose, fit, pts) {
  const out = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i += 3) { const p = rotPt(pose.rot, pts[i], pts[i + 1], pts[i + 2]); out[i] = p[0] * fit.s[0] + fit.o[0]; out[i + 1] = p[1] * fit.s[1] + fit.o[1]; out[i + 2] = p[2] * fit.s[2] + fit.o[2]; }
  return out;
}
/** triangles through the pose + fit; a reflection (det < 0 of rot x scale) flips the winding back */
export function poseTris(pose, fit, t) {
  const r = pose.rot, det = r[0] * (r[4] * r[8] - r[5] * r[7]) - r[1] * (r[3] * r[8] - r[5] * r[6]) + r[2] * (r[3] * r[7] - r[4] * r[6]);
  const o = applyPose(pose, fit, t);
  if (det < 0) for (let i = 0; i < o.length; i += 9) for (let c = 0; c < 3; c++) { const a = o[i + 3 + c]; o[i + 3 + c] = o[i + 6 + c]; o[i + 6 + c] = a; }
  return o;
}

// ---- chamfer (mean nearest distance, symmetric) between sample sets, with an early-out grid
export function makeGrid(P, cell) {
  const g = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  for (let i = 0; i < P.length / 3; i++) { const k = key(Math.floor(P[i * 3] / cell), Math.floor(P[i * 3 + 1] / cell), Math.floor(P[i * 3 + 2] / cell)); (g.get(k) ?? g.set(k, []).get(k)).push(i); }
  return { g, cell, P };
}
export function nearestDist(grid, x, y, z, cap = 1e9) {
  const { g, cell, P } = grid; let best = cap * cap;
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
  for (let r = 0; r < 12; r++) {
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
      if (Math.max(Math.abs(a), Math.abs(b), Math.abs(c)) !== r) continue;
      const l = g.get(`${cx + a},${cy + b},${cz + c}`); if (!l) continue;
      for (const i of l) { const d = (P[i * 3] - x) ** 2 + (P[i * 3 + 1] - y) ** 2 + (P[i * 3 + 2] - z) ** 2; if (d < best) best = d; }
    }
    if (best <= (r * cell) * (r * cell)) break;
  }
  return Math.sqrt(best);
}
export function chamferGrids(A, gridB, B, gridA) {
  let s = 0; const na = A.length / 3, nb = B.length / 3;
  for (let i = 0; i < na; i++) s += nearestDist(gridB, A[i * 3], A[i * 3 + 1], A[i * 3 + 2]);
  let s2 = 0;
  for (let i = 0; i < nb; i++) s2 += nearestDist(gridA, B[i * 3], B[i * 3 + 1], B[i * 3 + 2]);
  return { ab: s / na, ba: s2 / nb, mean: (s / na + s2 / nb) / 2 };
}

// ---- silhouettes: filled projections along the three axes, IoU of two soups over the same box
function fillTri(buf, R, ax, ay, bx, by, cx, cy) {
  const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxx = Math.min(R - 1, Math.ceil(Math.max(ax, bx, cx)));
  const miny = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxy = Math.min(R - 1, Math.ceil(Math.max(ay, by, cy)));
  const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(den) < 1e-12) return;
  for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
    const px = x + 0.5, py = y + 0.5, l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, l3 = 1 - l1 - l2;
    if (l1 >= -0.02 && l2 >= -0.02 && l3 >= -0.02) buf[y * R + x] = 1;
  }
}
export function silhouettes(t, box, R = 48) {
  const ext = Math.max(...box.size) * 1.1, ctr = box.lo.map((l, i) => (l + box.hi[i]) / 2), k = R / ext;
  const views = [[0, 1], [2, 1], [0, 2]], out = [];
  for (const [u, v] of views) {
    const buf = new Uint8Array(R * R);
    for (let i = 0; i < t.length; i += 9) fillTri(buf, R, (t[i + u] - ctr[u]) * k + R / 2, (t[i + v] - ctr[v]) * k + R / 2, (t[i + 3 + u] - ctr[u]) * k + R / 2, (t[i + 3 + v] - ctr[v]) * k + R / 2, (t[i + 6 + u] - ctr[u]) * k + R / 2, (t[i + 6 + v] - ctr[v]) * k + R / 2);
    out.push(buf);
  }
  return out;
}
export function iou(A, B) { let i = 0, u = 0; for (let v = 0; v < A.length; v++) { const a = A[v] | B[v] ? 1 : 0; u += a; i += A[v] & B[v]; } return u ? i / u : 1; }
/** mean IoU over the 3 views (and the min) */
export function silIoU(sa, sb) { const v = sa.map((a, i) => iou(a, sb[i])); return { mean: (v[0] + v[1] + v[2]) / 3, min: Math.min(...v), v }; }
/** p-th percentile (0..1) of the nearest distances of the points `P` to `grid` */
export function nearestPct(P, grid, p = 0.9) { const d = []; for (let i = 0; i < P.length / 3; i++) d.push(nearestDist(grid, P[i * 3], P[i * 3 + 1], P[i * 3 + 2])); d.sort((a, b) => a - b); return d[Math.min(d.length - 1, Math.floor(d.length * p))]; }

// ---- distance field of a point set over a padded box (trilinear lookups: the cheap first stage of the search)
export function distField(P, box, R = 36, pad = 0.35) {
  const ext = Math.max(...box.size) * (1 + pad), ctr = box.lo.map((l, i) => (l + box.hi[i]) / 2), cell = ext / (R - 1), o = ctr.map((c) => c - ext / 2);
  const D = new Float32Array(R * R * R), n = P.length / 3;
  for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    const px = o[0] + x * cell, py = o[1] + y * cell, pz = o[2] + z * cell; let best = 1e18;
    for (let i = 0; i < n; i++) { const d = (P[i * 3] - px) ** 2 + (P[i * 3 + 1] - py) ** 2 + (P[i * 3 + 2] - pz) ** 2; if (d < best) best = d; }
    D[(z * R + y) * R + x] = Math.sqrt(best);
  }
  return { D, R, o, cell, ext };
}
export function dfAt(f, x, y, z) {
  const { D, R, o, cell } = f; let over = 0;
  const q = [(x - o[0]) / cell, (y - o[1]) / cell, (z - o[2]) / cell];
  for (let c = 0; c < 3; c++) { if (q[c] < 0) { over += (-q[c] * cell) ** 2; q[c] = 0; } else if (q[c] > R - 1.001) { over += ((q[c] - (R - 1.001)) * cell) ** 2; q[c] = R - 1.001; } }
  const x0 = Math.floor(q[0]), y0 = Math.floor(q[1]), z0 = Math.floor(q[2]), fx = q[0] - x0, fy = q[1] - y0, fz = q[2] - z0;
  const at = (a, b, c) => D[((z0 + c) * R + y0 + b) * R + x0 + a];
  const v = (at(0, 0, 0) * (1 - fx) + at(1, 0, 0) * fx) * (1 - fy) * (1 - fz) + (at(0, 1, 0) * (1 - fx) + at(1, 1, 0) * fx) * fy * (1 - fz) + (at(0, 0, 1) * (1 - fx) + at(1, 0, 1) * fx) * (1 - fy) * fz + (at(0, 1, 1) * (1 - fx) + at(1, 1, 1) * fx) * fy * fz;
  return Math.sqrt(v * v + over);
}

// ---- the search: best parts for one game mesh (a triangle soup in its own coordinates)
let poolAll = null;
const poolFor = (re) => {
  if (!poolAll) poolAll = poolNames().map((p) => ({ ...p, part: loadPart(p.name) })).filter((p) => p.part).map((p) => {
    const sp = p.part.samples.P, step = Math.max(1, Math.floor(sp.length / 3 / 200)), a = [];
    for (let i = 0; i < sp.length / 3; i += step) a.push(sp[i * 3], sp[i * 3 + 1], sp[i * 3 + 2]);
    p.part.sub = Float32Array.from(a); return p;
  });
  return poolAll.filter((p) => (typeof re === 'function' ? re(p) : re.test(p.title)));
};
/**
 * @param t soup of the game mesh; @param re title filter of the candidate pool; @param rots HEAD_ROTS | ALL_ROTS; @param top how many candidates get the full scores
 * @returns [{ part, title, pose, fit, score (mean chamfer / bbox diagonal), iou (mean silhouette IoU, 3 views), iouMin, p90 }] best first (ranked by score + 0.08 (1 - iou))
 */
export function searchFit(t, re, rots, { top = 10, box = bboxOf(t), limits = [0.55, 1.8, 1.7] } = {}) {
  const s0 = areaSamples(t, 400), os = outerSamples(s0.P, s0.N), grid = makeGrid(os.P, 0.08), df = distField(os.P, box), silG = silhouettes(t, box), diag = Math.hypot(...box.size);
  const found = [];
  for (const c of poolFor(re)) for (const pose of rots) {
    const fit = fitOf(rotBox(c.part.box, pose.rot), box);
    if (!scaleOk(fit.s, ...limits)) continue;
    const pp = applyPose(pose, fit, c.part.sub); let s = 0; const n = pp.length / 3;
    for (let i = 0; i < n; i++) s += dfAt(df, pp[i * 3], pp[i * 3 + 1], pp[i * 3 + 2]);
    found.push({ c, pose, fit, a: s / n });
  }
  found.sort((x, y) => x.a - y.a);
  const res = [], seen = new Set();
  for (const o of found) {
    const key = o.c.name + '|' + o.pose.mirror + o.pose.rot.join(',');
    if (seen.has(key)) continue; seen.add(key);
    if (res.length >= top * 2) break;
    const pp = applyPose(o.pose, o.fit, o.c.part.samples.P), gp = makeGrid(pp, 0.08), ch = chamferGrids(os.P, gp, pp, grid);
    const ft = poseTris(o.pose, o.fit, o.c.part.tris), io = silIoU(silG, silhouettes(ft, box));
    res.push({ part: o.c.name, title: o.c.title, pose: o.pose, fit: o.fit, score: ch.mean / diag, iou: io.mean, iouMin: io.min, p90: Math.max(nearestPct(os.P, gp, 0.9), nearestPct(pp, grid, 0.9)) / diag });
  }
  res.sort((a, b) => (a.score + 0.08 * (1 - a.iou)) - (b.score + 0.08 * (1 - b.iou)));
  // one entry per part (its best pose)
  const out = []; for (const r of res) if (!out.find((u) => u.part === r.part)) out.push(r);
  return out.slice(0, top);
}
/** the title filters per kind of gear (by member name), or null = not a candidate (cloth, rotor blades ...) */
export const KINDS = [
  [/rotablades|tutu|skirt|cape|hanky|scorecard|booster|page$|meppe|leppe|reppe|stick$|turban|fez/i, null],
  [/hair|head$/i, /Hair/],
  [/hat|cap$|crown/i, /Hat\b|Cap\b|Crown|Hood|Headdress|Helmet|Beanie/],
  [/helm|visor|space_/i, /Helmet|Hat\b|Cap\b|Visor|Hood|Headdress|Crown/],
  [/sword|claymore|dagger/i, /Sword|Dagger|Cutlass|Saber|Katana|Rapier|Scimitar|Blade/],
  [/axe/i, /Axe|Pickaxe/],
  [/broom/i, /Broom/],
  [/chalice|tankard/i, /Goblet|Cup\b|Mug|Stein|Tankard/],
  [/pistol|rifle/i, /Gun|Pistol|Blaster|Revolver|Flintlock|Musket|Rifle/],
  [/lance/i, /Lance|Spear|Polearm|Halberd|Harpoon/],
  [/drill|hammer|spanner|wrench|screwdriver/i, /Tool|Hammer|Wrench|Spanner|Screw|Drill|Gavel|Mallet|Saw|Pickaxe|Shovel|Axe/],
  [/bugle/i, /Bugle|Trumpet|Horn/],
  [/bow$/i, /Bow\b/], [/arrow/i, /Arrow|Bow\b|Spear/],
  [/quiver|bag/i, /Quiver|Backpack|Bag\b/],
  [/shield/i, /Shield/],
  [/torch/i, /Torch|Lantern|Candle/],
];
export function kindOf(name) { for (const [re, pool] of KINDS) if (re.test(name)) return pool; return /./; }
