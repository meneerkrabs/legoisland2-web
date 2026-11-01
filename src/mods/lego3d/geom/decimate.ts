// Quadric-error edge-collapse decimation for the LEGO 3D mod (docs/re/lego3d.md). Pure TypeScript, no DOM / fs: runs in node (pack builders, tests) and in the browser.
//
// Input is an indexed triangle mesh with an optional "group" per triangle (a colour / material / texture slot). The decimator
//   * welds vertices that sit at the same position (LDraw output is a triangle soup),
//   * never moves or removes the borders between groups, and keeps open borders (a hard constraint quadric: those edges stay where they are),
//   * keeps creases (sharp edges: a constraint plane per edge whose two faces differ by more than `crease` degrees), so flat LEGO surfaces merge ("coplanar merge", cost 0)
//     while the silhouette of a stud, a hinge or a slope edge stays,
//   * refuses collapses that flip a face or create a non-manifold edge,
//   * collapses an edge to one of its two end points or to the optimum of the summed quadric (never invents a position outside the neighbourhood).
// `targetTris` is the stop condition (the original's triangle count of the LOD that is replaced); `maxCost` stops earlier when everything left costs more than that.
// Vertex attributes (normals, UVs, skin weights) are NOT carried: callers compute them on the decimated mesh (flat / crease-weld normals, planar UVs, position rules).
export interface DecimateInput {
  /** x,y,z per vertex */
  pos: ArrayLike<number>;
  /** 3 per triangle */
  idx: ArrayLike<number>;
  /** one id per triangle (colour / group); borders between different ids are preserved */
  group?: ArrayLike<number> | null;
  /** vertices (before welding) that may not move or vanish */
  lock?: ArrayLike<number> | null;
}
export interface DecimateOptions {
  targetTris: number;
  /** stop when the cheapest collapse costs more than this (squared distance in model units); default: no limit */
  maxCost?: number;
  /** degrees: faces meeting at a larger angle make a crease that is protected (default 35) */
  crease?: number;
  /** weight of the border / crease constraint planes (default 50) */
  borderWeight?: number;
  /** weld tolerance in model units (default 1e-5 of the bounding diagonal) */
  weld?: number;
  /**
   * cut planes (axis = value) whose edge loops must survive: a vertex that lies on a plane stays on it, and only merges into vertices that lie on it too (so the loop may lose vertices but
   * keeps its plane). Used for the skin band planes of the characters: a skin blend needs vertices at its edges. At most 30 planes.
   */
  planes?: { axis: 0 | 1 | 2; value: number }[];
}
export interface DecimateResult {
  pos: Float32Array;
  idx: Uint32Array;
  group: Uint32Array;
  /** triangles before / after, collapses done, the cost of the last collapse */
  stats: { before: number; after: number; collapses: number; lastCost: number };
}

type V3 = [number, number, number];

function cross(a: V3, b: V3): V3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** symmetric 4x4 quadric as 10 numbers: a2 ab ac ad b2 bc bd c2 cd d2 */
function planeQ(n: V3, d: number, w: number, q: Float64Array, o: number) {
  q[o] += w * n[0] * n[0]; q[o + 1] += w * n[0] * n[1]; q[o + 2] += w * n[0] * n[2]; q[o + 3] += w * n[0] * d;
  q[o + 4] += w * n[1] * n[1]; q[o + 5] += w * n[1] * n[2]; q[o + 6] += w * n[1] * d;
  q[o + 7] += w * n[2] * n[2]; q[o + 8] += w * n[2] * d; q[o + 9] += w * d * d;
}
function evalQ(q: Float64Array, o: number, x: number, y: number, z: number): number {
  return q[o] * x * x + 2 * q[o + 1] * x * y + 2 * q[o + 2] * x * z + 2 * q[o + 3] * x + q[o + 4] * y * y + 2 * q[o + 5] * y * z + 2 * q[o + 6] * y + q[o + 7] * z * z + 2 * q[o + 8] * z + q[o + 9];
}

class MinHeap {
  keys: number[] = [];
  a: number[] = [];   // payload: edge id
  push(k: number, v: number) {
    const keys = this.keys, a = this.a;
    let i = keys.length;
    keys.push(k); a.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (keys[p] <= k) break; keys[i] = keys[p]; a[i] = a[p]; i = p; }
    keys[i] = k; a[i] = v;
  }
  get size() { return this.keys.length; }
  pop(): [number, number] {
    const keys = this.keys, a = this.a, k0 = keys[0], v0 = a[0];
    const k = keys.pop() as number, v = a.pop() as number;
    const n = keys.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= k) break;
        keys[i] = keys[c]; a[i] = a[c]; i = c;
      }
      keys[i] = k; a[i] = v;
    }
    return [k0, v0];
  }
}

export function decimate(input: DecimateInput, opt: DecimateOptions): DecimateResult {
  const nIn = input.pos.length / 3, tIn = input.idx.length / 3;
  // ---- weld
  let lo = [1e30, 1e30, 1e30], hi = [-1e30, -1e30, -1e30];
  for (let i = 0; i < nIn; i++) for (let c = 0; c < 3; c++) { const v = input.pos[i * 3 + c]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
  const diag = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  const eps = opt.weld ?? diag * 1e-5;
  const map = new Map<string, number>();
  const wmap = new Int32Array(nIn);
  const P: number[] = [];
  const locked: number[] = [];
  for (let i = 0; i < nIn; i++) {
    const x = input.pos[i * 3], y = input.pos[i * 3 + 1], z = input.pos[i * 3 + 2];
    const key = `${Math.round(x / eps)},${Math.round(y / eps)},${Math.round(z / eps)}`;
    let id = map.get(key);
    if (id === undefined) { id = P.length / 3; map.set(key, id); P.push(x, y, z); locked.push(0); }
    wmap[i] = id;
    if (input.lock && input.lock[i]) locked[id] = 1;
  }
  const nV = P.length / 3;
  const pos = Float64Array.from(P);
  const planes = (opt.planes ?? []).slice(0, 30), ptol = diag * 2e-4;
  const pmask = new Uint32Array(nV);
  planes.forEach((pl, j) => { for (let v = 0; v < nV; v++) if (Math.abs(pos[v * 3 + pl.axis] - pl.value) <= ptol) pmask[v] |= 1 << j; });
  // ---- triangles (drop degenerate ones)
  const tri: number[] = [], grp: number[] = [];
  for (let t = 0; t < tIn; t++) {
    const a = wmap[input.idx[t * 3]], b = wmap[input.idx[t * 3 + 1]], c = wmap[input.idx[t * 3 + 2]];
    if (a === b || b === c || a === c) continue;
    tri.push(a, b, c); grp.push(input.group ? input.group[t] : 0);
  }
  const nT = tri.length / 3;
  const T = Int32Array.from(tri), G = Uint32Array.from(grp), alive = new Uint8Array(nT).fill(1);
  const p3 = (v: number): V3 => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  const faceN = (t: number): V3 => { const a = p3(T[t * 3]), b = p3(T[t * 3 + 1]), c = p3(T[t * 3 + 2]); return cross(sub(b, a), sub(c, a)); };
  // ---- adjacency
  const vt: number[][] = Array.from({ length: nV }, () => []);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) vt[T[t * 3 + k]].push(t);
  const Q = new Float64Array(nV * 10);
  const bw = opt.borderWeight ?? 50;
  const cosCrease = Math.cos(((opt.crease ?? 35) * Math.PI) / 180);
  // face quadrics (area weighted)
  for (let t = 0; t < nT; t++) {
    const n = faceN(t), len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-18) continue;
    const u: V3 = [n[0] / len, n[1] / len, n[2] / len], a = p3(T[t * 3]), d = -dot(u, a);
    for (let k = 0; k < 3; k++) planeQ(u, d, len / 2, Q, T[t * 3 + k] * 10);
  }
  // border / crease constraints: per undirected edge, the faces on it
  const edgeFaces = new Map<number, number[]>();
  const ekey = (a: number, b: number) => (a < b ? a * nV + b : b * nV + a);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const key = ekey(T[t * 3 + k], T[t * 3 + (k + 1) % 3]);
    const l = edgeFaces.get(key);
    if (l) l.push(t); else edgeFaces.set(key, [t]);
  }
  const addConstraint = (t: number, a: number, b: number, w: number) => {
    // a plane through edge (a, b) perpendicular to face t
    const n = faceN(t), nl = Math.hypot(n[0], n[1], n[2]);
    if (nl < 1e-18) return;
    const e = sub(p3(b), p3(a)), el = Math.hypot(e[0], e[1], e[2]);
    if (el < 1e-18) return;
    const pl = cross(e, [n[0] / nl, n[1] / nl, n[2] / nl]), pll = Math.hypot(pl[0], pl[1], pl[2]);
    if (pll < 1e-18) return;
    const u: V3 = [pl[0] / pll, pl[1] / pll, pl[2] / pll], d = -dot(u, p3(a));
    planeQ(u, d, w * el * el, Q, a * 10); planeQ(u, d, w * el * el, Q, b * 10);
  };
  const hardEdge = new Set<number>();   // edges that are open or between groups: the vertices on them are "border" vertices
  const borderV = new Uint8Array(nV);
  for (const [key, fs] of edgeFaces) {
    const a = Math.floor(key / nV), b = key % nV;
    if (fs.length === 1 || fs.length > 2 || G[fs[0]] !== G[fs[1]]) {
      hardEdge.add(key); borderV[a] = borderV[b] = 1;
      for (const f of fs) addConstraint(f, a, b, bw);
    } else {
      const n1 = faceN(fs[0]), n2 = faceN(fs[1]), l1 = Math.hypot(n1[0], n1[1], n1[2]), l2 = Math.hypot(n2[0], n2[1], n2[2]);
      if (l1 > 1e-18 && l2 > 1e-18 && dot(n1, n2) / (l1 * l2) < cosCrease) { for (const f of fs) addConstraint(f, a, b, bw * 0.5); borderV[a] |= 2; borderV[b] |= 2; }
    }
  }
  // ---- collapse candidates
  const version = new Int32Array(nV);   // bumps whenever a vertex changes: stale heap entries are skipped
  const heap = new MinHeap();
  const edgeInfo: { a: number; b: number; va: number; vb: number; x: number; y: number; z: number }[] = [];
  const nbrs = (v: number): number[] => {
    const s = new Set<number>();
    for (const t of vt[v]) for (let k = 0; k < 3; k++) { const o = T[t * 3 + k]; if (o !== v) s.add(o); }
    return [...s];
  };
  const cost = (a: number, b: number): { c: number; x: number; y: number; z: number } => {
    const q = new Float64Array(10);
    for (let i = 0; i < 10; i++) q[i] = Q[a * 10 + i] + Q[b * 10 + i];
    const pa = p3(a), pb = p3(b);
    let best = Infinity, bx = 0, by = 0, bz = 0;
    const lockA = locked[a], lockB = locked[b];
    if (lockA && lockB) return { c: Infinity, x: 0, y: 0, z: 0 };
    const tryP = (x: number, y: number, z: number) => { const c = evalQ(q, 0, x, y, z); if (c < best) { best = c; bx = x; by = y; bz = z; } };
    const ma = pmask[a], mb = pmask[b];
    if (!lockB && (mb & ~ma) === 0) tryP(pa[0], pa[1], pa[2]);
    if (!lockA && (ma & ~mb) === 0) tryP(pb[0], pb[1], pb[2]);
    if (!lockA && !lockB && ma === mb && !(borderV[a] & 1) && !(borderV[b] & 1)) {
      tryP((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2);
      // optimum of the quadric (3x3 solve), accepted when it stays near the edge
      const m00 = q[0], m01 = q[1], m02 = q[2], m11 = q[4], m12 = q[5], m22 = q[7];
      const det = m00 * (m11 * m22 - m12 * m12) - m01 * (m01 * m22 - m12 * m02) + m02 * (m01 * m12 - m11 * m02);
      if (Math.abs(det) > 1e-14) {
        const r0 = -q[3], r1 = -q[6], r2 = -q[8];
        const x = (r0 * (m11 * m22 - m12 * m12) - m01 * (r1 * m22 - m12 * r2) + m02 * (r1 * m12 - m11 * r2)) / det;
        const y = (m00 * (r1 * m22 - m12 * r2) - r0 * (m01 * m22 - m12 * m02) + m02 * (m01 * r2 - r1 * m02)) / det;
        const z = (m00 * (m11 * r2 - r1 * m12) - m01 * (m01 * r2 - r1 * m02) + r0 * (m01 * m12 - m11 * m02)) / det;
        const el = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
        const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2, mz = (pa[2] + pb[2]) / 2;
        if (Math.hypot(x - mx, y - my, z - mz) < el * 0.75) {
          const c: V3 = [x, y, z];
          if (ma) planes.forEach((pl, j) => { if (ma & (1 << j)) c[pl.axis] = pl.value; });   // a vertex of a cut loop stays on its plane
          tryP(c[0], c[1], c[2]);
        }
      }
    }
    // a vertex on a hard border may only move along that border: take the candidate that is a border end (the endpoint with the border flag); interior midpoint of a border edge is allowed (on the edge)
    return { c: best, x: bx, y: by, z: bz };
  };
  const pushEdge = (a: number, b: number) => {
    const { c, x, y, z } = cost(a, b);
    if (!Number.isFinite(c)) return;
    const id = edgeInfo.length;
    edgeInfo.push({ a, b, va: version[a], vb: version[b], x, y, z });
    heap.push(Math.max(0, c), id);
  };
  for (const key of edgeFaces.keys()) pushEdge(Math.floor(key / nV), key % nV);

  let liveT = nT, collapses = 0, lastCost = 0;
  const target = Math.max(4, opt.targetTris);
  const maxCost = opt.maxCost ?? Infinity;
  // does moving a and b to (x,y,z) keep the surrounding faces valid? (no flip, no collapse of a neighbour into nothing)
  const valid = (a: number, b: number, x: number, y: number, z: number): boolean => {
    const np: V3 = [x, y, z];
    for (const v of [a, b]) {
      for (const t of vt[v]) {
        if (!alive[t]) continue;
        const i0 = T[t * 3], i1 = T[t * 3 + 1], i2 = T[t * 3 + 2];
        if ((i0 === a || i1 === a || i2 === a) && (i0 === b || i1 === b || i2 === b)) continue;   // the faces that vanish
        const A = i0 === a || i0 === b ? np : p3(i0), B = i1 === a || i1 === b ? np : p3(i1), C = i2 === a || i2 === b ? np : p3(i2);
        const before = faceN(t), after = cross(sub(B, A), sub(C, A));
        const lb = Math.hypot(before[0], before[1], before[2]), la = Math.hypot(after[0], after[1], after[2]);
        if (la < 1e-18) return false;
        if (lb > 1e-18 && dot(before, after) / (lb * la) < 0.1) return false;
      }
    }
    // link condition: the common neighbours of a and b must be exactly the third vertices of the faces on the edge
    const na = new Set(nbrs(a)), common: number[] = [];
    for (const o of nbrs(b)) if (na.has(o)) common.push(o);
    let shared = 0;
    for (const t of vt[a]) { if (!alive[t]) continue; const i0 = T[t * 3], i1 = T[t * 3 + 1], i2 = T[t * 3 + 2]; if (i0 === b || i1 === b || i2 === b) shared++; }
    return common.length === shared && shared >= 1 && shared <= 2;
  };

  while (liveT > target && heap.size) {
    const [c, id] = heap.pop();
    const e = edgeInfo[id];
    if (version[e.a] !== e.va || version[e.b] !== e.vb) continue;
    if (c > maxCost) break;
    if (!valid(e.a, e.b, e.x, e.y, e.z)) continue;
    // collapse b into a at (x,y,z)
    const { a, b } = e;
    pos[a * 3] = e.x; pos[a * 3 + 1] = e.y; pos[a * 3 + 2] = e.z;
    for (let i = 0; i < 10; i++) Q[a * 10 + i] += Q[b * 10 + i];
    borderV[a] |= borderV[b];
    pmask[a] |= pmask[b];
    if (locked[b]) locked[a] = 1;
    const keep: number[] = [];
    for (const t of vt[a]) if (alive[t]) keep.push(t);
    for (const t of vt[b]) {
      if (!alive[t]) continue;
      const hasA = T[t * 3] === a || T[t * 3 + 1] === a || T[t * 3 + 2] === a;
      if (hasA) { alive[t] = 0; liveT--; continue; }
      for (let k = 0; k < 3; k++) if (T[t * 3 + k] === b) T[t * 3 + k] = a;
      keep.push(t);
    }
    vt[a] = keep.filter((t) => alive[t]);
    vt[b] = [];
    version[a]++; version[b]++;
    collapses++; lastCost = c;
    // only edges at `a` changed (their quadric / position); the entries of edges at the dead `b` are dropped by the version check
    for (const o of nbrs(a)) pushEdge(a, o);
  }
  // ---- compact
  const remap = new Int32Array(nV).fill(-1);
  const outPos: number[] = [], outIdx: number[] = [], outGrp: number[] = [];
  for (let t = 0; t < nT; t++) {
    if (!alive[t]) continue;
    const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
    if (a === b || b === c || a === c) continue;
    for (const v of [a, b, c]) { if (remap[v] < 0) { remap[v] = outPos.length / 3; outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); } outIdx.push(remap[v]); }
    outGrp.push(G[t]);
  }
  return { pos: Float32Array.from(outPos), idx: Uint32Array.from(outIdx), group: Uint32Array.from(outGrp), stats: { before: nT, after: outIdx.length / 3, collapses, lastCost } };
}

/** area-weighted vertex normals with a crease angle: splits vertices where the faces differ by more than `crease` degrees. Returns a mesh with one normal per vertex (flat surfaces stay flat, cylinders round). */
export function creaseNormals(pos: ArrayLike<number>, idx: ArrayLike<number>, crease = 35): { pos: Float32Array; nrm: Float32Array; idx: Uint32Array; src: Uint32Array } {
  const nT = idx.length / 3, cosC = Math.cos((crease * Math.PI) / 180);
  const fn: V3[] = [], area: number[] = [];
  for (let t = 0; t < nT; t++) {
    const a: V3 = [pos[idx[t * 3] * 3], pos[idx[t * 3] * 3 + 1], pos[idx[t * 3] * 3 + 2]], b: V3 = [pos[idx[t * 3 + 1] * 3], pos[idx[t * 3 + 1] * 3 + 1], pos[idx[t * 3 + 1] * 3 + 2]], c: V3 = [pos[idx[t * 3 + 2] * 3], pos[idx[t * 3 + 2] * 3 + 1], pos[idx[t * 3 + 2] * 3 + 2]];
    const n = cross(sub(b, a), sub(c, a)), l = Math.hypot(n[0], n[1], n[2]) || 1;
    fn.push([n[0] / l, n[1] / l, n[2] / l]); area.push(l);
  }
  const nV = pos.length / 3, at: number[][] = Array.from({ length: nV }, () => []);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) at[idx[t * 3 + k]].push(t);
  const outPos: number[] = [], outN: number[] = [], outIdx: number[] = [], src: number[] = [], seen = new Map<string, number>();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const v = idx[t * 3 + k], f = fn[t];
    let s: V3 = [0, 0, 0];
    for (const o of at[v]) if (dot(f, fn[o]) >= cosC) { s[0] += fn[o][0] * area[o]; s[1] += fn[o][1] * area[o]; s[2] += fn[o][2] * area[o]; }
    const l = Math.hypot(s[0], s[1], s[2]) || 1;
    s = [s[0] / l, s[1] / l, s[2] / l];
    const key = `${v}|${Math.round(s[0] * 200)},${Math.round(s[1] * 200)},${Math.round(s[2] * 200)}`;
    let id = seen.get(key);
    if (id === undefined) { id = outPos.length / 3; seen.set(key, id); outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); outN.push(s[0], s[1], s[2]); src.push(v); }
    outIdx.push(id);
  }
  return { pos: Float32Array.from(outPos), nrm: Float32Array.from(outN), idx: Uint32Array.from(outIdx), src: Uint32Array.from(src) };
}
