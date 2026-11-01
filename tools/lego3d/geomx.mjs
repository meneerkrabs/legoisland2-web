// Geometry helpers for measuring fits (bricks, sets): uniform-grid nearest triangle distance, deterministic area-weighted surface samples, distance statistics between two triangle soups.
// Triangle soups are Float32Array with 9 floats per triangle (like geom.mjs).
import { distSqPointTri } from '../../src/mods/lego3d/geom/measure.ts';

/** deterministic area-weighted samples (low-discrepancy) of a triangle soup: Float32Array of n points */
export function areaSample(t, n, withNormals = false) {
  const nt = t.length / 9, cum = new Float64Array(nt);
  let A = 0;
  for (let i = 0; i < nt; i++) {
    const o = i * 9, ux = t[o + 3] - t[o], uy = t[o + 4] - t[o + 1], uz = t[o + 5] - t[o + 2], vx = t[o + 6] - t[o], vy = t[o + 7] - t[o + 1], vz = t[o + 8] - t[o + 2];
    A += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); cum[i] = A;
  }
  const out = new Float32Array(n * 3), nr = withNormals ? new Float32Array(n * 3) : null;
  let ti = 0;
  for (let k = 0; k < n; k++) {
    const target = ((k + 0.5) / n) * A;
    while (ti < nt - 1 && cum[ti] < target) ti++;
    const o = ti * 9;
    let u = (k * 0.6180339887) % 1, v = (k * 0.7548776662) % 1;
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    for (let c = 0; c < 3; c++) out[k * 3 + c] = t[o + c] + u * (t[o + 3 + c] - t[o + c]) + v * (t[o + 6 + c] - t[o + c]);
    if (nr) { const ux = t[o + 3] - t[o], uy = t[o + 4] - t[o + 1], uz = t[o + 5] - t[o + 2], vx = t[o + 6] - t[o], vy = t[o + 7] - t[o + 1], vz = t[o + 8] - t[o + 2]; const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, l = Math.hypot(cx, cy, cz) || 1; nr[k * 3] = cx / l; nr[k * 3 + 1] = cy / l; nr[k * 3 + 2] = cz / l; }
  }
  return withNormals ? { pts: out, nrm: nr } : out;
}

export class TriGrid {
  constructor(tris, cell = 0.1) {
    this.t = tris; this.cell = cell;
    const nt = tris.length / 9;
    let lo = [1e30, 1e30, 1e30], hi = [-1e30, -1e30, -1e30];
    for (let i = 0; i < tris.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], tris[i + c]); hi[c] = Math.max(hi[c], tris[i + c]); }
    this.lo = lo;
    this.dim = [0, 1, 2].map((c) => Math.max(1, Math.ceil((hi[c] - lo[c]) / cell) + 1));
    this.cells = new Map();
    for (let k = 0; k < nt; k++) {
      const o = k * 9, a = [0, 1, 2].map((c) => Math.min(tris[o + c], tris[o + 3 + c], tris[o + 6 + c])), b = [0, 1, 2].map((c) => Math.max(tris[o + c], tris[o + 3 + c], tris[o + 6 + c]));
      const i0 = a.map((v, c) => Math.floor((v - lo[c]) / cell)), i1 = b.map((v, c) => Math.floor((v - lo[c]) / cell));
      for (let x = i0[0]; x <= i1[0]; x++) for (let y = i0[1]; y <= i1[1]; y++) for (let z = i0[2]; z <= i1[2]; z++) { const key = (x * this.dim[1] + y) * this.dim[2] + z; let l = this.cells.get(key); if (!l) this.cells.set(key, (l = [])); l.push(k); }
    }
    this.seen = new Int32Array(nt); this.stamp = 0;
  }
  /** distance from p to the nearest triangle (<= maxD, else maxD) */
  dist(p, maxD = 1e9) {
    const { t, cell, lo, dim } = this;
    const ci = [0, 1, 2].map((c) => Math.floor((p[c] - lo[c]) / cell));
    const maxK = Math.max(dim[0], dim[1], dim[2]) + 2;
    let best = maxD * maxD;
    this.stamp++;
    for (let k = 0; k <= maxK; k++) {
      if (k > 0 && best <= ((k - 1) * cell) ** 2) break;
      for (let x = ci[0] - k; x <= ci[0] + k; x++) for (let y = ci[1] - k; y <= ci[1] + k; y++) for (let z = ci[2] - k; z <= ci[2] + k; z++) {
        if (Math.max(Math.abs(x - ci[0]), Math.abs(y - ci[1]), Math.abs(z - ci[2])) !== k) continue;
        if (x < 0 || y < 0 || z < 0 || x >= dim[0] || y >= dim[1] || z >= dim[2]) continue;
        const l = this.cells.get((x * dim[1] + y) * dim[2] + z);
        if (!l) continue;
        for (const q of l) {
          if (this.seen[q] === this.stamp) continue;
          this.seen[q] = this.stamp;
          const o = q * 9, d = distSqPointTri(p, [t[o], t[o + 1], t[o + 2]], [t[o + 3], t[o + 4], t[o + 5]], [t[o + 6], t[o + 7], t[o + 8]]);
          if (d < best) best = d;
        }
      }
    }
    return Math.sqrt(best);
  }
}

/** distances of the points `pts` (flat) to the grid: { mean, p95, max } */
export function pointStats(pts, grid, maxD = 1e9, nrm = null, skip = null) {
  const d = [];
  for (let i = 0; i < pts.length; i += 3) { if (skip && skip(pts[i + 1], nrm[i + 1])) continue; d.push(grid.dist([pts[i], pts[i + 1], pts[i + 2]], maxD)); }   // skip(y, ny): samples to leave out (the undersides of bricks)
  d.sort((a, b) => a - b);
  return { mean: d.reduce((s, v) => s + v, 0) / (d.length || 1), p95: d[Math.floor(d.length * 0.95)] ?? 0, max: d[d.length - 1] ?? 0, far: d.filter((v) => v > 0.1).length / (d.length || 1) };   // far: fraction of the samples more than 0.1 (2.5 LDU) off
}

/** symmetric deviation between soups a and b: { ab: stats of a's samples to b, ba: ..., mean } (grids may be passed to reuse them) */
export function soupDeviation(a, b, n = 1500, ga = null, gb = null) {
  ga ??= new TriGrid(a); gb ??= new TriGrid(b);
  const ab = pointStats(areaSample(a, n), gb), ba = pointStats(areaSample(b, n), ga);
  return { ab, ba, mean: (ab.mean + ba.mean) / 2, p95: Math.max(ab.p95, ba.p95), max: Math.max(ab.max, ba.max) };
}

// ---------------------------------------------------------------------------------------------------- ray queries (visibility / hidden-face tests)

/** uniform grid for ray / triangle-soup queries: `blocked(o, d, maxT)` = does a ray hit any triangle within (tMin, maxT]? (3D-DDA through the cells; used for the hidden-face tests of bricks and sets) */
export class RayGrid {
  constructor(tris, cellsPerAxis = 0) {
    this.t = tris;
    const nt = tris.length / 9;
    const lo = [1e30, 1e30, 1e30], hi = [-1e30, -1e30, -1e30];
    for (let i = 0; i < tris.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], tris[i + c]); hi[c] = Math.max(hi[c], tris[i + c]); }
    this.lo = lo; this.hi = hi;
    const ext = [0, 1, 2].map((c) => Math.max(hi[c] - lo[c], 1e-6));
    const n = cellsPerAxis || Math.max(2, Math.min(96, Math.round(Math.cbrt(nt / 3))));
    const cell = Math.max(...ext) / n;
    this.cell = cell;
    this.dim = ext.map((e) => Math.max(1, Math.ceil(e / cell)));
    const cells = new Map();
    for (let k = 0; k < nt; k++) {
      const o = k * 9;
      const a = [0, 1, 2].map((c) => Math.min(tris[o + c], tris[o + 3 + c], tris[o + 6 + c])), b = [0, 1, 2].map((c) => Math.max(tris[o + c], tris[o + 3 + c], tris[o + 6 + c]));
      const i0 = a.map((v, c) => Math.min(this.dim[c] - 1, Math.floor((v - lo[c]) / cell))), i1 = b.map((v, c) => Math.min(this.dim[c] - 1, Math.floor((v - lo[c]) / cell)));
      for (let x = i0[0]; x <= i1[0]; x++) for (let y = i0[1]; y <= i1[1]; y++) for (let z = i0[2]; z <= i1[2]; z++) { const key = (x * this.dim[1] + y) * this.dim[2] + z; let l = cells.get(key); if (!l) cells.set(key, (l = [])); l.push(k); }
    }
    this.cells = cells;
    this.mark = new Int32Array(nt); this.stamp = 0;
  }
  /** a ray from o along the unit vector d hits a triangle at a distance in (1e-4, maxT]; `skip` = a triangle index to ignore */
  blocked(o, d, maxT, skip = -1) {
    const { lo, cell, dim, t } = this;
    // clip the ray to the grid box
    let t0 = 0, t1 = maxT;
    for (let c = 0; c < 3; c++) {
      const minC = lo[c], maxC = lo[c] + dim[c] * cell;
      if (Math.abs(d[c]) < 1e-12) { if (o[c] < minC || o[c] > maxC) return false; continue; }
      let a = (minC - o[c]) / d[c], b = (maxC - o[c]) / d[c];
      if (a > b) { const x = a; a = b; b = x; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return false;
    }
    const p = [o[0] + d[0] * (t0 + 1e-9), o[1] + d[1] * (t0 + 1e-9), o[2] + d[2] * (t0 + 1e-9)];
    const ix = [0, 1, 2].map((c) => Math.max(0, Math.min(dim[c] - 1, Math.floor((p[c] - lo[c]) / cell))));
    const step = [0, 1, 2].map((c) => (d[c] > 0 ? 1 : -1)), tMax = [0, 1, 2].map((c) => (Math.abs(d[c]) < 1e-12 ? 1e30 : ((d[c] > 0 ? lo[c] + (ix[c] + 1) * cell : lo[c] + ix[c] * cell) - o[c]) / d[c]));
    const tDelta = [0, 1, 2].map((c) => (Math.abs(d[c]) < 1e-12 ? 1e30 : cell / Math.abs(d[c])));
    this.stamp++;
    for (let guard = 0; guard < 4000; guard++) {
      const l = this.cells.get((ix[0] * dim[1] + ix[1]) * dim[2] + ix[2]);
      if (l) for (const k of l) {
        if (k === skip || this.mark[k] === this.stamp) continue;
        this.mark[k] = this.stamp;
        const q = k * 9, a0 = t[q], a1 = t[q + 1], a2 = t[q + 2];
        const e1x = t[q + 3] - a0, e1y = t[q + 4] - a1, e1z = t[q + 5] - a2, e2x = t[q + 6] - a0, e2y = t[q + 7] - a1, e2z = t[q + 8] - a2;
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-14) continue;
        const inv = 1 / det, sx = o[0] - a0, sy = o[1] - a1, sz = o[2] - a2, u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (tt > 1e-4 && tt <= maxT) return true;
      }
      const m = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
      if (tMax[m] > t1) return false;
      ix[m] += step[m]; tMax[m] += tDelta[m];
      if (ix[m] < 0 || ix[m] >= dim[m]) return false;
    }
    return false;
  }
}

/**
 * Drops the triangles nobody can see from outside: a face is hidden when a ray from its centroid is blocked along the face normal AND along `ring` directions tilted `tilt` degrees around it
 * (an overhang, a handle, an arch hides the floor under it from straight above only; from the side it is visible and stays). tris: soup; against: a RayGrid (default: of tris itself).
 */
export function pruneHiddenCone(tris, against = null, { maxT = 1e9, ring = 6, tilt = 55, eps = 1e-3, multi = true } = {}) {
  const grid = against ?? new RayGrid(tris);
  const out = [], T = (tilt * Math.PI) / 180;
  let kept = 0;
  const dirs = [];
  for (let k = 0; k < ring; k++) dirs.push([Math.sin(T) * Math.cos((k / ring) * 2 * Math.PI), Math.cos(T), Math.sin(T) * Math.sin((k / ring) * 2 * Math.PI)]);
  for (let i = 0; i < tris.length; i += 9) {
    const ux = tris[i + 3] - tris[i], uy = tris[i + 4] - tris[i + 1], uz = tris[i + 5] - tris[i + 2], vx = tris[i + 6] - tris[i], vy = tris[i + 7] - tris[i + 1], vz = tris[i + 8] - tris[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-18) continue;
    nx /= l; ny /= l; nz /= l;
    const cx = (tris[i] + tris[i + 3] + tris[i + 6]) / 3, cy = (tris[i + 1] + tris[i + 4] + tris[i + 7]) / 3, cz = (tris[i + 2] + tris[i + 5] + tris[i + 8]) / 3;
    // sample points: the centroid and a point near each corner (a face is hidden only when ALL of them are: a stud covers the middle of a top face, not its corners)
    const pts = [[cx + nx * eps, cy + ny * eps, cz + nz * eps]];
    if (multi) for (let k = 0; k < 3; k++) pts.push([cx + (tris[i + k * 3] - cx) * 0.75 + nx * eps, cy + (tris[i + k * 3 + 1] - cy) * 0.75 + ny * eps, cz + (tris[i + k * 3 + 2] - cz) * 0.75 + nz * eps]);
    const a = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let t1x = ny * a[2] - nz * a[1], t1y = nz * a[0] - nx * a[2], t1z = nx * a[1] - ny * a[0];
    const tl = Math.hypot(t1x, t1y, t1z); t1x /= tl; t1y /= tl; t1z /= tl;
    const t2x = ny * t1z - nz * t1y, t2y = nz * t1x - nx * t1z, t2z = nx * t1y - ny * t1x;
    const dd = [[nx, ny, nz]];
    if (ring) for (const d of dirs) dd.push([t1x * d[0] + nx * d[1] + t2x * d[2], t1y * d[0] + ny * d[1] + t2y * d[2], t1z * d[0] + nz * d[1] + t2z * d[2]]);
    let hidden = true;
    for (const c of pts) {
      for (const d of dd) if (!grid.blocked(c, d, maxT)) { hidden = false; break; }
      if (!hidden) break;
    }
    if (!hidden) { for (let k = 0; k < 9; k++) out.push(tris[i + k]); kept++; }
  }
  return Float32Array.from(out);
}
