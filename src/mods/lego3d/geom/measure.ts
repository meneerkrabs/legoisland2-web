// Measurements on indexed triangle meshes for the LEGO 3D mod's tests and pack builders (pure TS): symmetric surface deviation (how far a decimated / fitted mesh is from
// its source), signed volume, bounding box, edge manifoldness. Brute force (fine for the part sizes used here: up to a few thousand triangles per side).
type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** closest point of triangle abc to p (Ericson, Real-Time Collision Detection), squared distance only */
export function distSqPointTri(p: V3, a: V3, b: V3, c: V3): number {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  let q: V3;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) q = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); q = [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]; }
      else {
        const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) q = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q = [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); q = [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]; }
            else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]; }
          }
        }
      }
    }
  }
  const d = sub(p, q);
  return dot(d, d);
}

/** sample points of a mesh: the vertices, the triangle centroids and (for larger triangles) an edge-midpoint grid */
export function samplePoints(pos: ArrayLike<number>, idx: ArrayLike<number>): V3[] {
  const out: V3[] = [];
  for (let t = 0; t < idx.length / 3; t++) {
    const P = [0, 1, 2].map((k) => [pos[idx[t * 3 + k] * 3], pos[idx[t * 3 + k] * 3 + 1], pos[idx[t * 3 + k] * 3 + 2]] as V3);
    for (const p of P) out.push(p);
    out.push([(P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][1] + P[1][1] + P[2][1]) / 3, (P[0][2] + P[1][2] + P[2][2]) / 3]);
    for (let k = 0; k < 3; k++) { const a = P[k], b = P[(k + 1) % 3]; out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]); }
  }
  return out;
}

/** one-sided: max and mean distance from sample points of A to the surface of B */
export function oneSided(posA: ArrayLike<number>, idxA: ArrayLike<number>, posB: ArrayLike<number>, idxB: ArrayLike<number>): { max: number; mean: number } {
  const pts = samplePoints(posA, idxA), nT = idxB.length / 3;
  const tb: Float64Array = new Float64Array(nT * 9);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) tb[t * 9 + k * 3 + c] = posB[idxB[t * 3 + k] * 3 + c];
  let max = 0, sum = 0;
  for (const p of pts) {
    let best = Infinity;
    for (let t = 0; t < nT; t++) {
      const o = t * 9;
      const d = distSqPointTri(p, [tb[o], tb[o + 1], tb[o + 2]], [tb[o + 3], tb[o + 4], tb[o + 5]], [tb[o + 6], tb[o + 7], tb[o + 8]]);
      if (d < best) { best = d; if (d < 1e-14) break; }
    }
    const d = Math.sqrt(best);
    if (d > max) max = d;
    sum += d;
  }
  return { max, mean: sum / pts.length };
}
/** symmetric deviation: the larger of both one-sided maxima (Hausdorff) and means */
export function deviation(posA: ArrayLike<number>, idxA: ArrayLike<number>, posB: ArrayLike<number>, idxB: ArrayLike<number>) {
  const a = oneSided(posA, idxA, posB, idxB), b = oneSided(posB, idxB, posA, idxA);
  return { hausdorff: Math.max(a.max, b.max), mean: (a.mean + b.mean) / 2 };
}
export function bounds(pos: ArrayLike<number>) {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let c = 0; c < 3; c++) { if (pos[i + c] < lo[c]) lo[c] = pos[i + c]; if (pos[i + c] > hi[c]) hi[c] = pos[i + c]; }
  return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] as V3 };
}
/** signed volume (positive for outward counter-clockwise triangles in a right-handed frame, negative in the game's left-handed frame with its winding: compare magnitudes) */
export function signedVolume(pos: ArrayLike<number>, idx: ArrayLike<number>): number {
  let v = 0;
  for (let t = 0; t < idx.length / 3; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    v += (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) / 6;
  }
  return v;
}
/** edge statistics of a welded mesh (vertices at equal positions are merged first): open edges (one face), edges with more than two faces, and edges whose two faces run the same way (inconsistent winding) */
export function edgeReport(pos: ArrayLike<number>, idx: ArrayLike<number>, eps = 1e-5) {
  const map = new Map<string, number>(), w = new Int32Array(pos.length / 3);
  for (let i = 0; i < w.length; i++) {
    const k = `${Math.round(pos[i * 3] / eps)},${Math.round(pos[i * 3 + 1] / eps)},${Math.round(pos[i * 3 + 2] / eps)}`;
    let id = map.get(k); if (id === undefined) { id = map.size; map.set(k, id); } w[i] = id;
  }
  const n = map.size, edges = new Map<number, number[]>();
  for (let t = 0; t < idx.length / 3; t++) for (let k = 0; k < 3; k++) {
    const a = w[idx[t * 3 + k]], b = w[idx[t * 3 + (k + 1) % 3]];
    if (a === b) continue;
    const key = a < b ? a * n + b : b * n + a, dir = a < b ? 1 : -1;
    const l = edges.get(key); if (l) l.push(dir); else edges.set(key, [dir]);
  }
  let open = 0, over = 0, inconsistent = 0;
  for (const l of edges.values()) { if (l.length === 1) open++; else if (l.length > 2) over++; else if (l[0] === l[1]) inconsistent++; }
  return { edges: edges.size, open, over, inconsistent };
}
