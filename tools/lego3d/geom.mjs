// Small geometry helpers of the LEGO 3D pilot (triangle soups as Float32Array, 9 floats per triangle).
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function bboxPts(pts) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < pts.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], pts[i + c]); hi[c] = Math.max(hi[c], pts[i + c]); }
  return { lo, hi, size: hi.map((h, i) => h - lo[i]) };
}

/** the 24 proper rotation matrices (3x3 row-major, signed permutations with det +1) */
export function rotations24() {
  const out = [], perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const p of perms) for (let s = 0; s < 8; s++) {
    const sg = [s & 1 ? -1 : 1, s & 2 ? -1 : 1, s & 4 ? -1 : 1];
    const m = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let r = 0; r < 3; r++) m[r * 3 + p[r]] = sg[r];
    const d = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
    if (d > 0) out.push(m);
  }
  return out;
}
export const applyRot = (m, p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[3] * p[0] + m[4] * p[1] + m[5] * p[2], m[6] * p[0] + m[7] * p[1] + m[8] * p[2]];

/** mean nearest-neighbour distance (symmetric) between two point sets (flat arrays) */
export function chamfer(a, b) {
  const one = (x, y) => { let s = 0; const n = x.length / 3; for (let i = 0; i < x.length; i += 3) { let best = 1e18; for (let j = 0; j < y.length; j += 3) { const d = (x[i] - y[j]) ** 2 + (x[i + 1] - y[j + 1]) ** 2 + (x[i + 2] - y[j + 2]) ** 2; if (d < best) best = d; } s += Math.sqrt(best); } return s / n; };
  return (one(a, b) + one(b, a)) / 2;
}

/** sample points of a triangle soup: vertices + centroids */
export function samplePts(tris) {
  const o = [];
  for (let i = 0; i < tris.length; i += 9) {
    for (let k = 0; k < 3; k++) o.push(tris[i + k * 3], tris[i + k * 3 + 1], tris[i + k * 3 + 2]);
    o.push((tris[i] + tris[i + 3] + tris[i + 6]) / 3, (tris[i + 1] + tris[i + 4] + tris[i + 7]) / 3, (tris[i + 2] + tris[i + 5] + tris[i + 8]) / 3);
  }
  return Float32Array.from(o);
}

/** vertex-clustering decimation: snaps vertices to a grid of `cell`, drops collapsed triangles and duplicates (far LODs) */
export function decimate(tris, cell) {
  const q = (v) => Math.round(v / cell) * cell;
  const seen = new Set(), out = [];
  for (let i = 0; i < tris.length; i += 9) {
    const P = [0, 1, 2].map((k) => [q(tris[i + k * 3]), q(tris[i + k * 3 + 1]), q(tris[i + k * 3 + 2])]);
    const key = P.map((p) => p.map((v) => Math.round(v / cell)).join(',')).join('|');
    const [a, b, c] = P;
    if (key.split('|').some((s, j, arr) => arr.indexOf(s) !== j)) continue;
    const kk = [0, 1, 2].map((j) => P[j].map((v) => Math.round(v / cell)).join(',')).sort().join('|');
    if (seen.has(kk)) continue;
    seen.add(kk);
    out.push(...a, ...b, ...c);
  }
  return Float32Array.from(out);
}

/**
 * Welds a triangle soup into an indexed mesh with crease-angle smoothing: vertices at the same position share a normal when the faces meeting there are within `crease` degrees
 * of each other (flat boxes stay sharp, cylinders (studs, heads) look round). Returns { pos, nrm, idx } (idx as one list into the welded vertices, 3 per triangle).
 */
export function weldSmooth(tris, crease = 35, eps = 1e-4) {
  const nT = tris.length / 9, cosC = Math.cos((crease * Math.PI) / 180);
  const fn = [];
  for (let t = 0; t < nT; t++) {
    const a = [tris[t * 9], tris[t * 9 + 1], tris[t * 9 + 2]], b = [tris[t * 9 + 3], tris[t * 9 + 4], tris[t * 9 + 5]], c = [tris[t * 9 + 6], tris[t * 9 + 7], tris[t * 9 + 8]];
    const n = cross(sub(b, a), sub(c, a));
    fn.push(norm(n));
  }
  const key = (x, y, z) => `${Math.round(x / eps)},${Math.round(y / eps)},${Math.round(z / eps)}`;
  const at = new Map(); // position -> list of { t, k }
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) { const kk = key(tris[t * 9 + k * 3], tris[t * 9 + k * 3 + 1], tris[t * 9 + k * 3 + 2]); if (!at.has(kk)) at.set(kk, []); at.get(kk).push({ t, k }); }
  const pos = [], nrm = [], idx = [], vmap = new Map();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const x = tris[t * 9 + k * 3], y = tris[t * 9 + k * 3 + 1], z = tris[t * 9 + k * 3 + 2];
    const f = fn[t];
    // average the normals of the faces at this position that are within the crease angle of this face (area-less average: fine for these meshes)
    let s = [0, 0, 0];
    for (const o of at.get(key(x, y, z))) { const g = fn[o.t]; if (dot(f, g) >= cosC) { s[0] += g[0]; s[1] += g[1]; s[2] += g[2]; } }
    const n = norm(s);
    const vk = `${key(x, y, z)}|${n.map((v) => Math.round(v * 200)).join(',')}`;
    let id = vmap.get(vk);
    if (id === undefined) { id = pos.length / 3; vmap.set(vk, id); pos.push(x, y, z); nrm.push(...n); }
    idx.push(id);
  }
  return { pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), idx };
}

/** Moeller-Trumbore ray / triangle soup: nearest hit { t, tri } with |t| <= maxT in either direction along d (d unit), or null */
export function rayTris(o, d, tris, maxT) {
  let best = null;
  for (let i = 0; i < tris.length; i += 9) {
    const a = [tris[i], tris[i + 1], tris[i + 2]], e1 = [tris[i + 3] - a[0], tris[i + 4] - a[1], tris[i + 5] - a[2]], e2 = [tris[i + 6] - a[0], tris[i + 7] - a[1], tris[i + 8] - a[2]];
    const p = cross(d, e2), det = dot(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det, s = sub(o, a), u = dot(s, p) * inv;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1), v = dot(d, q) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = dot(e2, q) * inv;
    if (Math.abs(t) <= maxT && (!best || Math.abs(t) < Math.abs(best.t))) best = { t, tri: i / 9 };
  }
  return best;
}

/** closest point of a triangle (Ericson, Real-Time Collision Detection) */
function closestOnTri(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]; }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + d5 - d6); const bc = sub(c, b); return [b[0] + bc[0] * w, b[1] + bc[1] * w, b[2] + bc[2] * w]; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}
/** closest point on the triangles of `tris` whose face normal agrees with `n` (dot > minDot); { q, n, d } or null when none within maxD */
export function closestFacing(p, n, tris, minDot, maxD) {
  let best = null;
  for (let i = 0; i < tris.length; i += 9) {
    const a = [tris[i], tris[i + 1], tris[i + 2]], b = [tris[i + 3], tris[i + 4], tris[i + 5]], c = [tris[i + 6], tris[i + 7], tris[i + 8]];
    const fn = norm(cross(sub(b, a), sub(c, a)));
    if (dot(fn, n) < minDot) continue;
    const q = closestOnTri(p, a, b, c), d = len(sub(q, p));
    if (d <= maxD && (!best || d < best.d)) best = { q, n: fn, d };
  }
  return best;
}

/** splits every triangle that crosses the plane axis = value (axis 0/1/2) into pieces on each side (fan triangulation of the clipped polygons) */
export function splitAtPlane(tris, axis, value) {
  const out = [];
  for (let i = 0; i < tris.length; i += 9) {
    const P = [0, 1, 2].map((k) => [tris[i + k * 3], tris[i + k * 3 + 1], tris[i + k * 3 + 2]]);
    const d = P.map((p) => p[axis] - value);
    if (d.every((x) => x >= -1e-9) || d.every((x) => x <= 1e-9)) { out.push(...tris.subarray(i, i + 9)); continue; }
    for (const side of [1, -1]) {
      const poly = [];
      for (let k = 0; k < 3; k++) {
        const a = P[k], b = P[(k + 1) % 3], da = d[k] * side, db = d[(k + 1) % 3] * side;
        if (da >= 0) poly.push(a);
        if ((da > 0 && db < 0) || (da < 0 && db > 0)) { const t = da / (da - db); poly.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
      }
      for (let k = 1; k + 1 < poly.length; k++) out.push(...poly[0], ...poly[k], ...poly[k + 1]);
    }
  }
  return Float32Array.from(out);
}

/** true when a ray from o along d hits a triangle of `tris` within (eps, maxT] (forward only) */
export function rayBlocked(o, d, tris, maxT, skip = -1) {
  for (let i = 0; i < tris.length; i += 9) {
    if (i / 9 === skip) continue;
    const a0 = tris[i], a1 = tris[i + 1], a2 = tris[i + 2];
    const e1 = [tris[i + 3] - a0, tris[i + 4] - a1, tris[i + 5] - a2], e2 = [tris[i + 6] - a0, tris[i + 7] - a1, tris[i + 8] - a2];
    const p = cross(d, e2), det = dot(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det, s = [o[0] - a0, o[1] - a1, o[2] - a2], u = dot(s, p) * inv;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1), v = dot(d, q) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = dot(e2, q) * inv;
    if (t > 1e-4 && t <= maxT) return true;
  }
  return false;
}
/** drops the triangles that cannot be seen from outside: a ray from the centroid along the face normal runs into another face (inner walls, tubes, sockets, parts overlapping each other) */
export function pruneHidden(tris, all, maxT = 3) {
  const out = [];
  for (let i = 0; i < tris.length; i += 9) {
    const a = [tris[i], tris[i + 1], tris[i + 2]], b = [tris[i + 3], tris[i + 4], tris[i + 5]], c = [tris[i + 6], tris[i + 7], tris[i + 8]];
    const n = norm(cross(sub(b, a), sub(c, a)));
    const cen = [(a[0] + b[0] + c[0]) / 3 + n[0] * 1e-3, (a[1] + b[1] + c[1]) / 3 + n[1] * 1e-3, (a[2] + b[2] + c[2]) / 3 + n[2] * 1e-3];
    if (!rayBlocked(cen, n, all, maxT)) out.push(...tris.subarray(i, i + 9));
  }
  return Float32Array.from(out);
}

/**
 * Caps the small holes of a triangle soup (the socket of an arm in a torso: invisible while the arm sits in it, a black hole once the game's animation swings the arm out of it): boundary edges (used by one
 * triangle only) are linked into loops, loops of at most `maxEdges` edges and `maxPerimeter` length get a triangle fan around their centre, wound to close the surface. Returns { tris, capped }.
 */
export function capSmallHoles(tris, maxPerimeter = 2.6, maxEdges = 48, eps = 1e-4) {
  const key = (x, y, z) => `${Math.round(x / eps)},${Math.round(y / eps)},${Math.round(z / eps)}`;
  const pts = new Map(), edges = new Map();
  const vk = (i, k) => { const x = tris[i + k * 3], y = tris[i + k * 3 + 1], z = tris[i + k * 3 + 2], kk = key(x, y, z); if (!pts.has(kk)) pts.set(kk, [x, y, z]); return kk; };
  for (let i = 0; i < tris.length; i += 9) for (let k = 0; k < 3; k++) { const a = vk(i, k), b = vk(i, (k + 1) % 3); edges.set(`${a}>${b}`, [a, b]); }
  const boundary = [...edges.values()].filter(([a, b]) => !edges.has(`${b}>${a}`));
  const next = new Map();
  for (const [a, b] of boundary) { if (!next.has(a)) next.set(a, []); next.get(a).push(b); }
  const used = new Set(), out = Array.from(tris);
  let capped = 0;
  for (const [a0, b0] of boundary) {
    if (used.has(`${a0}>${b0}`)) continue;
    const loop = [a0]; let cur = b0, ok = true;
    used.add(`${a0}>${b0}`);
    while (cur !== a0) {
      loop.push(cur);
      const nx = (next.get(cur) ?? []).find((n) => !used.has(`${cur}>${n}`));
      if (nx === undefined || loop.length > maxEdges) { ok = false; break; }
      used.add(`${cur}>${nx}`); cur = nx;
    }
    if (!ok || loop.length < 3) continue;
    const P = loop.map((k) => pts.get(k));
    let per = 0; for (let i = 0; i < P.length; i++) { const q = P[(i + 1) % P.length]; per += Math.hypot(q[0] - P[i][0], q[1] - P[i][1], q[2] - P[i][2]); }
    if (per > maxPerimeter) continue;
    const c = [0, 1, 2].map((d) => P.reduce((s, p) => s + p[d], 0) / P.length);
    for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; out.push(q[0], q[1], q[2], p[0], p[1], p[2], c[0], c[1], c[2]); }
    capped++;
  }
  return { tris: Float32Array.from(out), capped };
}
