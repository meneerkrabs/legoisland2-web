// Geometry helpers of the characters builder (builder only; the run-time assembler has its own, in src/mods/lego3d/chars/).
// Triangle soups = Float32Array, 9 floats per triangle.

/** the directions used for the visibility test: a fixed, deterministic set on the sphere (Fibonacci) */
export function sphereDirs(n) {
  const out = [], g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const y = 1 - (2 * i + 1) / n, r = Math.sqrt(1 - y * y), th = g * i; out.push([Math.cos(th) * r, y, Math.sin(th) * r]); }
  return out;
}
/** a rectangle blocker as two triangles: axis (0|1|2) fixed at `at`, the other two axes spanning [lo, hi] (pairs in axis order) */
export function quad(axis, at, a0, a1, b0, b1) {
  const [u, v] = [0, 1, 2].filter((c) => c !== axis);
  const P = (pu, pv) => { const p = [0, 0, 0]; p[axis] = at; p[u] = pu; p[v] = pv; return p; };
  const A = P(a0, b0), B = P(a1, b0), C = P(a1, b1), D = P(a0, b1);
  return Float32Array.from([...A, ...B, ...C, ...A, ...C, ...D]);
}
/** any ray hit (t > eps) against the soup `tris` (typed array), ray o + t d */
function anyHit(o, d, E1, E2, A, n) {
  for (let i = 0; i < n; i++) {
    const a = i * 3, e1x = E1[a], e1y = E1[a + 1], e1z = E1[a + 2], e2x = E2[a], e2y = E2[a + 1], e2z = E2[a + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-14 && det < 1e-14) continue;
    const inv = 1 / det, sx = o[0] - A[a], sy = o[1] - A[a + 1], sz = o[2] - A[a + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > 1e-6) return true;
  }
  return false;
}
/**
 * Keeps the triangles that can be seen from outside: from sample points of the triangle (centroid and three points inside) at least one of `dirs` (in the hemisphere of the face normal,
 * dot > 0.1) leaves the model without hitting `occluders` (the soup itself plus the `blockers`). Inner walls, tubes and cavities go; `scale` = model size (ray origin bias).
 */
export function visiblePrune(tris, { blockers = [], occluders = null, dirs = sphereDirs(40), bias = 1e-3, keepIf = null } = {}) {
  const all = [tris, ...blockers, ...(occluders ? [occluders] : [])];
  const n = all.reduce((s, t) => s + t.length / 9, 0);
  const A = new Float32Array(n * 3), E1 = new Float32Array(n * 3), E2 = new Float32Array(n * 3);
  let k = 0;
  for (const t of all) for (let i = 0; i < t.length; i += 9) {
    for (let c = 0; c < 3; c++) { A[k * 3 + c] = t[i + c]; E1[k * 3 + c] = t[i + 3 + c] - t[i + c]; E2[k * 3 + c] = t[i + 6 + c] - t[i + c]; }
    k++;
  }
  const out = [];
  for (let i = 0; i < tris.length; i += 9) {
    const a = [tris[i], tris[i + 1], tris[i + 2]], b = [tris[i + 3], tris[i + 4], tris[i + 5]], c = [tris[i + 6], tris[i + 7], tris[i + 8]];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-12) continue;
    nx /= nl; ny /= nl; nz /= nl;
    const pts = [[(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]];
    for (const [p, q, r] of [[a, b, c], [b, c, a], [c, a, b]]) pts.push([0.6 * p[0] + 0.2 * q[0] + 0.2 * r[0], 0.6 * p[1] + 0.2 * q[1] + 0.2 * r[1], 0.6 * p[2] + 0.2 * q[2] + 0.2 * r[2]]);
    let vis = false;
    for (const p of pts) {
      const o = [p[0] + nx * bias, p[1] + ny * bias, p[2] + nz * bias];
      for (const d of dirs) { if (d[0] * nx + d[1] * ny + d[2] * nz < 0.1) continue; if (!anyHit(o, d, E1, E2, A, n)) { vis = true; break; } }
      if (vis) break;
    }
    if (vis || (keepIf && keepIf(a, b, c))) out.push(...tris.subarray(i, i + 9));
  }
  return Float32Array.from(out);
}

import { capSmallHoles } from '../geom.mjs';
/** open boundary edges of a soup (edges used by one triangle only, positions welded) */
export function openEdges(t, eps = 1e-4) {
  const key = (i) => `${Math.round(t[i] / eps)},${Math.round(t[i + 1] / eps)},${Math.round(t[i + 2] / eps)}`;
  const e = new Map();
  for (let i = 0; i < t.length; i += 9) for (let k = 0; k < 3; k++) { const a = key(i + k * 3), b = key(i + ((k + 1) % 3) * 3); e.set(`${a}>${b}`, 1); }
  let open = 0; for (const k of e.keys()) { const [a, b] = k.split('>'); if (!e.has(`${b}>${a}`)) open++; }
  return open;
}
/** prune the inside, close the holes, prune again (what the caps made invisible goes too): a closed, outside-only shell */
export function shell(tris, { blockers = [], maxPerimeter = 1e6, maxEdges = 600 } = {}) {
  let t = visiblePrune(fixTJunctions(tris).tris, { blockers });
  for (let pass = 0; pass < 2; pass++) { const c = capSmallHoles(fixTJunctions(t).tris, maxPerimeter, maxEdges); if (!c.capped) break; t = visiblePrune(c.tris, { blockers }); }
  return t;
}

/** splits triangle edges at vertices of OTHER triangles that lie on them (T-junction cracks of LDraw primitives), so that boundary detection / capping sees real holes only */
export function fixTJunctions(t, eps = 2e-3) {
  const V = [], seen = new Map();
  const q = (x) => Math.round(x / eps);
  for (let i = 0; i < t.length; i += 3) { const k = `${q(t[i])},${q(t[i + 1])},${q(t[i + 2])}`; if (!seen.has(k)) { seen.set(k, V.length); V.push([t[i], t[i + 1], t[i + 2]]); } }
  const grid = new Map(), cell = 0.5;
  V.forEach((p, i) => { const k = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)},${Math.floor(p[2] / cell)}`; (grid.get(k) ?? grid.set(k, []).get(k)).push(i); });
  const near = (a, b) => { // vertices within the bbox of edge a-b (padded)
    const lo = [0, 1, 2].map((c) => Math.min(a[c], b[c]) - eps), hi = [0, 1, 2].map((c) => Math.max(a[c], b[c]) + eps), out = [];
    for (let x = Math.floor(lo[0] / cell); x <= Math.floor(hi[0] / cell); x++) for (let y = Math.floor(lo[1] / cell); y <= Math.floor(hi[1] / cell); y++) for (let z = Math.floor(lo[2] / cell); z <= Math.floor(hi[2] / cell); z++) for (const i of grid.get(`${x},${y},${z}`) ?? []) out.push(i);
    return out;
  };
  const out = [];
  let split = 0;
  for (let i = 0; i < t.length; i += 9) {
    const P = [0, 1, 2].map((k) => [t[i + k * 3], t[i + k * 3 + 1], t[i + k * 3 + 2]]);
    const poly = [];
    for (let k = 0; k < 3; k++) {
      const a = P[k], b = P[(k + 1) % 3];
      poly.push(a);
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2], extra = [];
      for (const vi of near(a, b)) {
        const p = V[vi], s = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / L2;
        if (s <= 1e-4 || s >= 1 - 1e-4) continue;
        const c = [a[0] + d[0] * s, a[1] + d[1] * s, a[2] + d[2] * s];
        if (Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]) < eps) extra.push({ s, p });
      }
      extra.sort((x, y) => x.s - y.s);
      for (const e of extra) poly.push(e.p);
    }
    if (poly.length === 3) { out.push(...poly[0], ...poly[1], ...poly[2]); continue; }
    split++;
    const c = [0, 1, 2].map((d) => poly.reduce((s, p) => s + p[d], 0) / poly.length);
    for (let k = 0; k < poly.length; k++) { const p = poly[k], r = poly[(k + 1) % poly.length]; out.push(...p, ...r, ...c); }
  }
  return { tris: Float32Array.from(out), split };
}

/** convex hull of 2D points (monotone chain), CCW */
function hull2(P) {
  const pts = [...P].sort((a, b) => a[0] - b[0] || a[1] - b[1]).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  if (pts.length < 3) return pts;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  const up = []; for (const p of [...pts].reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up);
}
/**
 * Replaces the faces that lie in the plane `axis = at` and look along `sign` (the rim of an opening) by one cap = the convex hull of the part's vertices on that plane, so the opening is closed
 * (a part whose bottom is open, a leg open at the top). The cap looks along `sign`.
 */
export function planeCap(t, axis, at, sign, tol = 1e-3) {
  const kept = [], onPlane = [];
  const [u, v] = [0, 1, 2].filter((c) => c !== axis);
  for (let i = 0; i < t.length; i += 9) {
    const on = [0, 1, 2].map((k) => Math.abs(t[i + k * 3 + axis] - at) < tol);
    if (on.every(Boolean)) {
      const a = [t[i], t[i + 1], t[i + 2]], b = [t[i + 3], t[i + 4], t[i + 5]], c = [t[i + 6], t[i + 7], t[i + 8]];
      const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
      if (n[axis] * sign > 0) { onPlane.push(a, b, c); continue; }   // the rim faces of the opening: replaced by the cap
    }
    kept.push(...t.subarray(i, i + 9));
  }
  const pts = [];
  for (let i = 0; i < kept.length; i += 3) if (Math.abs(kept[i + axis] - at) < tol) pts.push([kept[i + u], kept[i + v]]);
  for (const p of onPlane) pts.push([p[u], p[v]]);
  const H = hull2(pts);
  if (H.length < 3) return { tris: Float32Array.from(kept), cap: 0 };
  const c2 = [H.reduce((s, p) => s + p[0], 0) / H.length, H.reduce((s, p) => s + p[1], 0) / H.length];
  const P = (q) => { const p = [0, 0, 0]; p[axis] = at; p[u] = q[0]; p[v] = q[1]; return p; };
  const out = Array.from(kept);
  for (let k = 0; k < H.length; k++) {
    const a = P(c2), b = P(H[k]), c = P(H[(k + 1) % H.length]);
    // orientation: normal along sign*axis
    const n = (b[(axis + 1) % 3] - a[(axis + 1) % 3]) * (c[(axis + 2) % 3] - a[(axis + 2) % 3]) - (b[(axis + 2) % 3] - a[(axis + 2) % 3]) * (c[(axis + 1) % 3] - a[(axis + 1) % 3]);   // component along `axis` of (b-a)x(c-a) (cyclic axes)
    if (n * sign >= 0) out.push(...a, ...b, ...c); else out.push(...a, ...c, ...b);
  }
  return { tris: Float32Array.from(out), cap: H.length };
}

/**
 * Exact flat merge (builder only): repeatedly collapses a vertex v into a neighbour u when that changes NO geometry and no group border: every triangle around v that does not contain u keeps its
 * plane (u lies in it, to 1e-6) and its orientation, and v is either flat (all its edges are smooth: both faces of an edge coplanar and of the same group) or lies on a straight feature line
 * (exactly two feature edges - a crease, a group border, an open border - collinear with v, u being the end of one of them). The `planes` (axis, value) are kept: a vertex on such a plane only moves along it.
 * Cutting a part along the footprints of its prints leaves thousands of such vertices (the generic quadric decimator will not slide along a crease); this brings the part back to its real structure.
 * pos: flat xyz, idx: flat triangles, group: per triangle. Returns { pos, idx, group } compacted.
 */
const FLAT = 4e-5;   // 0.5 degrees: the cut vertices are only known to float precision, and short edges amplify that
export function mergeFlat(pos, idx, group, planes = []) {
  const P = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  const tri = []; for (let t = 0; t < idx.length; t += 3) tri.push([idx[t], idx[t + 1], idx[t + 2]]);
  const alive = tri.map(() => true), grp = Array.from(group);
  const faces = new Map(); // vertex -> Set of triangle ids
  const link = (t) => { for (const v of tri[t]) (faces.get(v) ?? faces.set(v, new Set()).get(v)).add(t); };
  tri.forEach((_, t) => link(t));
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const nrm = (a, b, c) => { const n = crs(sub(b, a), sub(c, a)), l = Math.hypot(...n); return { n, l }; };
  const onPlane = (v) => planes.filter((pl) => Math.abs(P(v)[pl.axis] - pl.value) < 1e-5);
  // edge -> faces
  const edgeFaces = (a, b) => [...(faces.get(a) ?? [])].filter((t) => alive[t] && tri[t].includes(b));
  const isFeature = (a, b) => {
    const f = edgeFaces(a, b);
    if (f.length !== 2) return true;                       // open border / non-manifold
    if (grp[f[0]] !== grp[f[1]]) return true;              // group border
    const n0 = nrm(...tri[f[0]].map(P)), n1 = nrm(...tri[f[1]].map(P));
    return dot(n0.n, n1.n) < (1 - FLAT) * n0.l * n1.l;     // crease (not coplanar)
  };
  const nbrs = (v) => { const s = new Set(); for (const t of faces.get(v) ?? []) if (alive[t]) for (const w of tri[t]) if (w !== v) s.add(w); return [...s]; };
  let changed = true, rounds = 0;
  while (changed && rounds++ < 50) {
    changed = false;
    for (const v of [...faces.keys()]) {
      const fs = [...(faces.get(v) ?? [])].filter((t) => alive[t]);
      if (!fs.length) continue;
      const ns = nbrs(v), feat = ns.filter((w) => isFeature(v, w));
      let cands;
      if (feat.length === 0) cands = ns;
      else if (feat.length === 2) {
        const d0 = sub(P(feat[0]), P(v)), d1 = sub(P(feat[1]), P(v)), l0 = Math.hypot(...d0), l1 = Math.hypot(...d1);
        if (!(l0 > 1e-9 && l1 > 1e-9) || dot(d0, d1) / (l0 * l1) > -(1 - FLAT)) continue;   // not straight through v
        cands = feat;
      } else continue;
      const pl = onPlane(v);
      for (const u of cands) {
        if (pl.length && !pl.every((q) => Math.abs(P(u)[q.axis] - q.value) < 1e-5)) continue;   // stay on the skin planes
        // every triangle around v without u: u must lie in its plane and the new triangle keeps its orientation
        let ok = true;
        const touched = [];
        for (const t of fs) {
          if (tri[t].includes(u)) continue;
          const old = nrm(...tri[t].map(P)), nt = tri[t].map((w) => (w === v ? u : w)), nw = nrm(...nt.map(P));
          if (old.l < 1e-12 || nw.l < 1e-12 || dot(old.n, nw.n) < (1 - FLAT) * old.l * nw.l) { ok = false; break; }
          touched.push([t, nt]);
        }
        if (!ok) continue;
        // no duplicate triangle may appear
        const key = (a) => [...a].sort((x, y) => x - y).join(',');
        const others = new Set(); for (const t of alive.keys()) if (alive[t] && !fs.includes(t)) others.add(key(tri[t]));
        if (touched.some(([, nt]) => others.has(key(nt)))) continue;
        for (const t of fs) if (tri[t].includes(u)) alive[t] = false;
        for (const [t, nt] of touched) { faces.get(v).delete(t); tri[t] = nt; (faces.get(u) ?? faces.set(u, new Set()).get(u)).add(t); }
        faces.delete(v); changed = true;
        break;
      }
    }
  }
  const map = new Map(), np = [], ni = [], ng = [];
  tri.forEach((t, i) => { if (!alive[i]) return; for (const v of t) { if (!map.has(v)) { map.set(v, np.length / 3); np.push(...P(v)); } ni.push(map.get(v)); } ng.push(grp[i]); });
  return { pos: Float32Array.from(np), idx: Uint32Array.from(ni), group: Uint32Array.from(ng) };
}

import { parseMsh } from '../../../src/formats/msh.ts';
import { TriSet } from '../../../src/mods/lego3d/chars/geo.ts';
/** how far two UNSKINNED meshes (.msh bytes) are apart: the symmetric mean nearest-surface distance of `n` area-weighted samples each way (game units) */
export function meshDeviation(bytesA, bytesB, n = 250) {
  const prep = (b) => { const m = parseMsh(b), idx = []; for (const g of m.groups) for (let k = 0; k < g.indexCount; k++) idx.push(m.indices[g.firstIndex + k] + g.firstVertex); return { pos: m.positions, idx }; };
  const A = prep(bytesA), B = prep(bytesB);
  const samples = (M) => {
    const tris = M.idx.length / 3, cum = []; let acc = 0;
    for (let t = 0; t < tris; t++) { const a = M.idx[t * 3] * 3, b = M.idx[t * 3 + 1] * 3, c = M.idx[t * 3 + 2] * 3, u = [M.pos[b] - M.pos[a], M.pos[b + 1] - M.pos[a + 1], M.pos[b + 2] - M.pos[a + 2]], w = [M.pos[c] - M.pos[a], M.pos[c + 1] - M.pos[a + 1], M.pos[c + 2] - M.pos[a + 2]]; acc += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]); cum.push(acc); }
    const pts = [];
    for (let i = 0; i < n; i++) { const r = ((i + 0.5) / n) * acc; let lo = 0, hi = tris - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; } const t = lo, a = M.idx[t * 3] * 3, b = M.idx[t * 3 + 1] * 3, c = M.idx[t * 3 + 2] * 3, u = (i * 0.6180339887) % 1, v = (i * 0.7548776662) % 1, s = u + v > 1 ? [1 - u, 1 - v] : [u, v]; pts.push([0, 1, 2].map((q) => M.pos[a + q] + (M.pos[b + q] - M.pos[a + q]) * s[0] + (M.pos[c + q] - M.pos[a + q]) * s[1])); }
    return pts;
  };
  const SA = new TriSet(A.pos, A.idx), SB = new TriSet(B.pos, B.idx);
  let s1 = 0, s2 = 0;
  for (const p of samples(A)) s1 += SB.closest(p)?.d ?? 0;
  for (const p of samples(B)) s2 += SA.closest(p)?.d ?? 0;
  return (s1 + s2) / (2 * n);
}
