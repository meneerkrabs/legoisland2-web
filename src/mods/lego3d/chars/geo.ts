// Small geometry kit of the characters assembler (isomorphic, no DOM / node): closest points with barycentric coordinates, nearest-vertex lookups, 3x3 helpers.
export type V3 = [number, number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function inv3(m: ArrayLike<number>): number[] {
  const [a, b, c, d, e, f, g, h, i] = m as number[];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g), s = 1 / det;
  return [(e * i - f * h) * s, (c * h - b * i) * s, (b * f - c * e) * s, (f * g - d * i) * s, (a * i - c * g) * s, (c * d - a * f) * s, (d * h - e * g) * s, (b * g - a * h) * s, (a * e - b * d) * s];
}
/** row-vector times 3x3 (row-major) */
export const rowMul = (v: V3, m: ArrayLike<number>): V3 => [v[0] * m[0] + v[1] * m[3] + v[2] * m[6], v[0] * m[1] + v[1] * m[4] + v[2] * m[7], v[0] * m[2] + v[1] * m[5] + v[2] * m[8]];

/** closest point of triangle abc to p: { q, u, v, w } with q = u*a + v*b + w*c (Ericson, Real-Time Collision Detection) */
export function closestOnTri(p: V3, a: V3, b: V3, c: V3): { q: V3; u: number; v: number; w: number } {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { q: a, u: 1, v: 0, w: 0 };
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return { q: b, u: 0, v: 1, w: 0 };
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); return { q: add(a, mul(ab, t)), u: 1 - t, v: t, w: 0 }; }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return { q: c, u: 0, v: 0, w: 1 };
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); return { q: add(a, mul(ac, t)), u: 1 - t, v: 0, w: t }; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / (d4 - d3 + (d5 - d6)); return { q: add(b, mul(sub(c, b), t)), u: 0, v: 1 - t, w: t }; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return { q: add(a, add(mul(ab, v), mul(ac, w))), u: 1 - v - w, v, w };
}

/** an indexed triangle set (positions flat, indices flat) with per-triangle face normals, for repeated closest-point queries */
export class TriSet {
  pos: ArrayLike<number>; idx: ArrayLike<number>; n: number; fn: Float32Array; tris: number[];
  constructor(pos: ArrayLike<number>, idx: ArrayLike<number>, tris?: number[]) {
    this.pos = pos; this.idx = idx;
    this.tris = tris ?? Array.from({ length: idx.length / 3 }, (_, i) => i);
    this.n = this.tris.length;
    this.fn = new Float32Array(this.n * 3);
    for (let k = 0; k < this.n; k++) {
      const [a, b, c] = this.corners(this.tris[k]);
      const n = norm(cross(sub(b, a), sub(c, a)));
      this.fn[k * 3] = n[0]; this.fn[k * 3 + 1] = n[1]; this.fn[k * 3 + 2] = n[2];
    }
  }
  corners(t: number): [V3, V3, V3] {
    const p = this.pos, i = this.idx;
    return [[p[i[t * 3] * 3], p[i[t * 3] * 3 + 1], p[i[t * 3] * 3 + 2]], [p[i[t * 3 + 1] * 3], p[i[t * 3 + 1] * 3 + 1], p[i[t * 3 + 1] * 3 + 2]], [p[i[t * 3 + 2] * 3], p[i[t * 3 + 2] * 3 + 1], p[i[t * 3 + 2] * 3 + 2]]];
  }
  /** nearest hit of the line p + t d (both directions, |t| <= maxT) with the triangles: { tri, q, u, v, w, t, n } (Moeller-Trumbore) */
  ray(p: V3, d: V3, maxT: number, accept: ((tri: number) => boolean) | null = null): { tri: number; q: V3; u: number; v: number; w: number; d: number; n: V3 } | null {
    let best: { tri: number; q: V3; u: number; v: number; w: number; d: number; n: V3 } | null = null;
    for (let k = 0; k < this.n; k++) {
      const t = this.tris[k];
      if (accept && !accept(t)) continue;
      const [a, b, c] = this.corners(t), e1 = sub(b, a), e2 = sub(c, a), pv = cross(d, e2), det = dot(e1, pv);
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, s = sub(p, a), u = dot(s, pv) * inv;
      if (u < -1e-6 || u > 1 + 1e-6) continue;
      const qv = cross(s, e1), v = dot(d, qv) * inv;
      if (v < -1e-6 || u + v > 1 + 1e-6) continue;
      const tt = dot(e2, qv) * inv;
      if (Math.abs(tt) > maxT || (best && Math.abs(tt) >= best.d)) continue;
      best = { tri: t, q: add(a, add(mul(e1, u), mul(e2, v))), u: 1 - u - v, v: u, w: v, d: Math.abs(tt), n: [this.fn[k * 3], this.fn[k * 3 + 1], this.fn[k * 3 + 2]] };
    }
    return best;
  }
  /** nearest triangle (optionally only faces whose normal agrees with `facing` by more than `minDot`), within maxD */
  closest(p: V3, facing: V3 | null = null, minDot = 0, maxD = Infinity, accept: ((tri: number) => boolean) | null = null): { tri: number; q: V3; u: number; v: number; w: number; d: number; n: V3 } | null {
    let best: { tri: number; q: V3; u: number; v: number; w: number; d: number; n: V3 } | null = null;
    for (let k = 0; k < this.n; k++) {
      const n: V3 = [this.fn[k * 3], this.fn[k * 3 + 1], this.fn[k * 3 + 2]];
      if (facing && dot(n, facing) < minDot) continue;
      const t = this.tris[k];
      if (accept && !accept(t)) continue;
      const [a, b, c] = this.corners(t);
      const r = closestOnTri(p, a, b, c), d = len(sub(r.q, p));
      if (d <= maxD && (!best || d < best.d)) best = { tri: t, q: r.q, u: r.u, v: r.v, w: r.w, d, n };
    }
    return best;
  }
}

/** the normal of the nearest `k` of the candidate vertices (inverse-distance mean), `cand` = vertex indices of `pos` / `nrm` */
export function nearestNormal(p: V3, pos: ArrayLike<number>, nrm: ArrayLike<number>, cand: ArrayLike<number>, k = 4, face: V3 | null = null, minDot = 0.3, strict = false): V3 {
  let best: { d: number; v: number }[] = [];
  for (let pass = 0; pass < (strict ? 1 : 2) && !best.length; pass++) for (let i = 0; i < cand.length; i++) {
    const v = cand[i];
    // the vertex must look the way the new surface looks (a shoulder corner next to the top face must not take the top face's normal); no such vertex: any
    if (face && pass === 0 && nrm[v * 3] * face[0] + nrm[v * 3 + 1] * face[1] + nrm[v * 3 + 2] * face[2] < minDot) continue;
    const d = (pos[v * 3] - p[0]) ** 2 + (pos[v * 3 + 1] - p[1]) ** 2 + (pos[v * 3 + 2] - p[2]) ** 2;
    if (best.length < k || d < best[best.length - 1].d) {
      let j = best.length; while (j > 0 && best[j - 1].d > d) j--;
      best.splice(j, 0, { d, v }); if (best.length > k) best.pop();
    }
  }
  if (strict && !best.length && face) return face;
  let x = 0, y = 0, z = 0;
  for (const { d, v } of best) { const w = 1 / (d + 1e-4); x += nrm[v * 3] * w; y += nrm[v * 3 + 1] * w; z += nrm[v * 3 + 2] * w; }
  return norm([x, y, z]);
}

/**
 * The shading normal of a rebuilt vertex: the ORIGINAL's smoothed normal field read at the closest point of the original group's surface (barycentric blend of its vertex normals), among the
 * triangles that face the way the new face does (the creased copy of a corner takes the normals of its own side). The game lights per vertex on the CPU, so a vertex that gets the original's
 * normal at its place is lit like the original surface there (the first version took the 4 nearest vertex normals: 50 degrees off on average, legs of the robots came out silver).
 * Falls back to the nearest vertex normals.
 */
export function surfaceNormal(p: V3, fn: V3, set: TriSet, gIdx: ArrayLike<number>, nrm: ArrayLike<number>, cand: ArrayLike<number>, pos: ArrayLike<number> | null = null): V3 {
  const c = set.closest(p, fn, 0.3, 0.35);
  if (!c) return nearestNormal(p, pos ?? set.pos, nrm, cand, 4, fn, 0.3, true);   // no original surface facing this way nearby (the bottom of a neck, the underside of a brim): the vertex normals that agree best, else the face's own
  const a = gIdx[c.tri * 3], b = gIdx[c.tri * 3 + 1], d = gIdx[c.tri * 3 + 2];
  const n: V3 = [nrm[a * 3] * c.u + nrm[b * 3] * c.v + nrm[d * 3] * c.w, nrm[a * 3 + 1] * c.u + nrm[b * 3 + 1] * c.v + nrm[d * 3 + 1] * c.w, nrm[a * 3 + 2] * c.u + nrm[b * 3 + 2] * c.v + nrm[d * 3 + 2] * c.w];
  return len(n) < 1e-6 ? fn : norm(n);
}

/** a triangle without area (its corners coincide or lie on a line to 1e-9): it has no normal and nothing to draw */
export function degenerateTri(pos: ArrayLike<number>, idx: ArrayLike<number>, t: number): boolean {
  const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
  const u: V3 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], w: V3 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
  return len(cross(u, w)) < 1e-9;
}
