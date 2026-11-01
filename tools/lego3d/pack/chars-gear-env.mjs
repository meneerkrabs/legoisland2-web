// The outer envelope of a hollow, cracked, non-manifold LDraw part (hair, hat, helmet): voxelise the shell, flood-fill the outside, take the solid's surface (surface nets): a clean closed
// manifold mesh of what can be SEEN, ready for edge-collapse decimation. Inner walls, studs' holes, T-junction cracks and overlapping sub-parts all vanish. The wearer's head (a blocker)
// seals the opening of a cap: the cavity fills, and the envelope faces that lie on the head are dropped again. Builder only.

/** marks the voxels a triangle soup passes through (samples at half-voxel spacing over every triangle) */
function mark(grid, t, o, v, R) {
  const set = (x, y, z) => { const i = Math.floor((x - o[0]) / v), j = Math.floor((y - o[1]) / v), k = Math.floor((z - o[2]) / v); if (i >= 0 && j >= 0 && k >= 0 && i < R[0] && j < R[1] && k < R[2]) grid[(k * R[1] + j) * R[0] + i] = 1; };
  for (let a = 0; a < t.length; a += 9) {
    const A = [t[a], t[a + 1], t[a + 2]], B = [t[a + 3], t[a + 4], t[a + 5]], C = [t[a + 6], t[a + 7], t[a + 8]];
    const lab = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), lac = Math.hypot(C[0] - A[0], C[1] - A[1], C[2] - A[2]), lbc = Math.hypot(C[0] - B[0], C[1] - B[1], C[2] - B[2]);
    const n = Math.max(1, Math.ceil(Math.max(lab, lac, lbc) / (v * 0.5)));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, w = j / n, s = 1 - u - w;
      set(A[0] * s + B[0] * u + C[0] * w, A[1] * s + B[1] * u + C[1] * w, A[2] * s + B[2] * u + C[2] * w);
    }
  }
}
function dilate(g, R, r) {
  let cur = g;
  for (let it = 0; it < r; it++) {
    const nx = Uint8Array.from(cur);
    for (let k = 0; k < R[2]; k++) for (let j = 0; j < R[1]; j++) for (let i = 0; i < R[0]; i++) {
      if (!cur[(k * R[1] + j) * R[0] + i]) continue;
      for (let c = -1; c <= 1; c++) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
        const x = i + a, y = j + b, z = k + c; if (x < 0 || y < 0 || z < 0 || x >= R[0] || y >= R[1] || z >= R[2]) continue;
        nx[(z * R[1] + y) * R[0] + x] = 1;
      }
    }
    cur = nx;
  }
  return cur;
}
/** 6-neighbour erosion `r` times */
function erode(g, R, r) {
  let cur = g;
  for (let it = 0; it < r; it++) {
    const nx = new Uint8Array(cur.length);
    for (let k = 1; k < R[2] - 1; k++) for (let j = 1; j < R[1] - 1; j++) for (let i = 1; i < R[0] - 1; i++) {
      const q = (k * R[1] + j) * R[0] + i;
      if (cur[q] && cur[q - 1] && cur[q + 1] && cur[q - R[0]] && cur[q + R[0]] && cur[q - R[0] * R[1]] && cur[q + R[0] * R[1]]) nx[q] = 1;
    }
    cur = nx;
  }
  return cur;
}
/** the solid = every voxel the outside cannot reach without crossing a barrier voxel */
function solidOf(barrier, R) {
  const ext = new Uint8Array(barrier.length), stack = [0];
  ext[0] = 1;
  const N = R[0] * R[1] * R[2];
  while (stack.length) {
    const p = stack.pop(), i = p % R[0], j = Math.floor(p / R[0]) % R[1], k = Math.floor(p / (R[0] * R[1]));
    for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const x = i + a, y = j + b, z = k + c; if (x < 0 || y < 0 || z < 0 || x >= R[0] || y >= R[1] || z >= R[2]) continue;
      const q = (z * R[1] + y) * R[0] + x;
      if (!ext[q] && !barrier[q]) { ext[q] = 1; stack.push(q); }
    }
  }
  const out = new Uint8Array(N); for (let q = 0; q < N; q++) out[q] = ext[q] ? 0 : 1;
  return out;
}
/** surface nets of the (blurred) occupancy field at 0.5 -> triangle soup with outward winding of the game */
function surfaceNets(solid, R, o, v, blur) {
  let F = Float32Array.from(solid);
  for (let it = 0; it < blur; it++) {
    const G = new Float32Array(F.length);
    for (let k = 0; k < R[2]; k++) for (let j = 0; j < R[1]; j++) for (let i = 0; i < R[0]; i++) {
      let s = 0, n = 0;
      for (let c = -1; c <= 1; c++) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const x = i + a, y = j + b, z = k + c; if (x < 0 || y < 0 || z < 0 || x >= R[0] || y >= R[1] || z >= R[2]) { n++; continue; } s += F[(z * R[1] + y) * R[0] + x]; n++; }
      G[(k * R[1] + j) * R[0] + i] = s / n;
    }
    F = G;
  }
  const at = (i, j, k) => F[(k * R[1] + j) * R[0] + i];
  const cellId = new Int32Array(R[0] * R[1] * R[2]).fill(-1), verts = [];
  const cx = R[0] - 1, cy = R[1] - 1, cz = R[2] - 1;
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    const f = corner.map(([a, b, c]) => at(i + a, j + b, k + c));
    let mask = 0; for (let q = 0; q < 8; q++) if (f[q] > 0.5) mask |= 1 << q;
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((f[a] > 0.5) === (f[b] > 0.5)) continue;
      const t = (0.5 - f[a]) / (f[b] - f[a]);
      sx += corner[a][0] + (corner[b][0] - corner[a][0]) * t; sy += corner[a][1] + (corner[b][1] - corner[a][1]) * t; sz += corner[a][2] + (corner[b][2] - corner[a][2]) * t; n++;
    }
    cellId[(k * R[1] + j) * R[0] + i] = verts.length;
    verts.push([o[0] + (i + sx / n + 0.5) * v, o[1] + (j + sy / n + 0.5) * v, o[2] + (k + sz / n + 0.5) * v]);
  }
  const out = [];
  const cid = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= cx || j >= cy || k >= cz ? -1 : cellId[(k * R[1] + j) * R[0] + i]);
  const quad = (q, outward) => {
    if (q.some((x) => x < 0)) return;
    const P = q.map((x) => verts[x]);
    const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const ord = n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] >= 0 ? [0, 1, 2, 3] : [0, 3, 2, 1];
    const d = (a, b) => Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1], P[a][2] - P[b][2]);
    const [a, b, c, e] = ord.map((i) => P[i]);
    if (d(ord[0], ord[2]) <= d(ord[1], ord[3])) out.push(...a, ...b, ...c, ...a, ...c, ...e); else out.push(...a, ...b, ...e, ...b, ...c, ...e);
  };
  for (let k = 1; k < R[2] - 1; k++) for (let j = 1; j < R[1] - 1; j++) for (let i = 1; i < R[0] - 1; i++) {
    const s0 = at(i, j, k) > 0.5;
    if (s0 !== (at(i + 1, j, k) > 0.5) && j > 0 && k > 0) quad([cid(i, j - 1, k - 1), cid(i, j, k - 1), cid(i, j, k), cid(i, j - 1, k)], [s0 ? 1 : -1, 0, 0]);
    if (s0 !== (at(i, j + 1, k) > 0.5)) quad([cid(i - 1, j, k - 1), cid(i, j, k - 1), cid(i, j, k), cid(i - 1, j, k)], [0, s0 ? 1 : -1, 0]);
    if (s0 !== (at(i, j, k + 1) > 0.5)) quad([cid(i - 1, j - 1, k), cid(i, j - 1, k), cid(i, j, k), cid(i - 1, j, k)], [0, 0, s0 ? 1 : -1]);
  }
  return Float32Array.from(out);
}
/** winding: the game's outward triangles have (b-a)x(c-a) along the outward normal; surfaceNets orients by the field, so nothing to flip here */
/**
 * @param t soup of the part (model coordinates); @param voxel cell size; @param head optional blocker soup (a head: seals openings); @returns { tris, dims }
 */
export function envelope(t, { voxel = 0.03, head = null, headDrop = 0.09, blur = 1 } = {}) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const s of head ? [t, head] : [t]) for (let i = 0; i < s.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], s[i + c]); hi[c] = Math.max(hi[c], s[i + c]); }
  const pad = voxel * 4, o = lo.map((l) => l - pad), R = hi.map((h, c) => Math.ceil((h + pad - o[c]) / voxel) + 1);
  const N = R[0] * R[1] * R[2];
  let barrier = new Uint8Array(N);
  mark(barrier, t, o, voxel, R);
  barrier = dilate(barrier, R, 1);
  let headSolid = null, seal = null;
  const partBarrier = Uint8Array.from(barrier);
  if (head) {
    let hv = new Uint8Array(N); mark(hv, head, o, voxel, R);
    headSolid = erode(solidOf(dilate(hv, R, 1), R), R, 2);          // the head's volume, shrunk by two voxels: a hair that sits right on the skin keeps its wall
    seal = dilate(hv, R, Math.max(1, Math.round(0.05 / voxel)));
    for (let q = 0; q < N; q++) if (seal[q]) barrier[q] = 1;       // closes the gap between the cap and the head
  }
  let solid = solidOf(barrier, R);
  if (headSolid) for (let q = 0; q < N; q++) if (headSolid[q] || (seal[q] && !partBarrier[q])) solid[q] = 0;
  let tris = surfaceNets(solid, R, o, voxel, blur);
  if (head && tris.length) {   // faces that look at the head from close by are the underside of the part (hidden): dropped
    const cell = 0.1, g = new Map(), key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    const hp = [];
    for (let a = 0; a < head.length; a += 9) { const A = [head[a], head[a + 1], head[a + 2]], B = [head[a + 3], head[a + 4], head[a + 5]], C = [head[a + 6], head[a + 7], head[a + 8]]; const n = Math.max(1, Math.ceil(Math.max(Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), Math.hypot(C[0] - A[0], C[1] - A[1], C[2] - A[2])) / 0.02)); for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) { const u = i / n, w = j / n, s = 1 - u - w; hp.push([A[0] * s + B[0] * u + C[0] * w, A[1] * s + B[1] * u + C[1] * w, A[2] * s + B[2] * u + C[2] * w]); } }
    for (const p of hp) { const k = key(p[0], p[1], p[2]); (g.get(k) ?? g.set(k, []).get(k)).push(p); }
    const near = (x, y, z) => { let best = 1e9, bp = null; const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const p of g.get(`${cx + a},${cy + b},${cz + c}`) ?? []) { const d = Math.hypot(p[0] - x, p[1] - y, p[2] - z); if (d < best) { best = d; bp = p; } } return { d: best, p: bp }; };
    const keep = [];
    for (let a = 0; a < tris.length; a += 9) {
      const c = [(tris[a] + tris[a + 3] + tris[a + 6]) / 3, (tris[a + 1] + tris[a + 4] + tris[a + 7]) / 3, (tris[a + 2] + tris[a + 5] + tris[a + 8]) / 3];
      const e1 = [tris[a + 3] - tris[a], tris[a + 4] - tris[a + 1], tris[a + 5] - tris[a + 2]], e2 = [tris[a + 6] - tris[a], tris[a + 7] - tris[a + 1], tris[a + 8] - tris[a + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], nl = Math.hypot(...n) || 1;
      const h = near(c[0], c[1], c[2]);
      if (h.d <= headDrop) { const toward = [(h.p[0] - c[0]) / (h.d || 1), (h.p[1] - c[1]) / (h.d || 1), (h.p[2] - c[2]) / (h.d || 1)]; if ((n[0] * toward[0] + n[1] * toward[1] + n[2] * toward[2]) / nl > 0.2) continue; }
      keep.push(...tris.subarray(a, a + 9));
    }
    tris = Float32Array.from(keep);
  }
  return { tris, dims: R };
}

/** Taubin smoothing (lambda | mu) of a closed-ish soup: evens out the stair noise of the voxel surface without shrinking it; boundary vertices (open edges) stay */
export function smoothSoup(t, iters = 8, lambda = 0.5, mu = -0.53, eps = 1e-5) {
  const map = new Map(), pos = [], idx = [];
  for (let i = 0; i < t.length; i += 3) { const k = `${Math.round(t[i] / eps)},${Math.round(t[i + 1] / eps)},${Math.round(t[i + 2] / eps)}`; let id = map.get(k); if (id === undefined) { id = pos.length / 3; map.set(k, id); pos.push(t[i], t[i + 1], t[i + 2]); } idx.push(id); }
  const n = pos.length / 3, nb = Array.from({ length: n }, () => new Set()), edges = new Map();
  for (let i = 0; i < idx.length; i += 3) for (let k = 0; k < 3; k++) { const a = idx[i + k], b = idx[i + (k + 1) % 3]; nb[a].add(b); nb[b].add(a); const key = a < b ? a * n + b : b * n + a; edges.set(key, (edges.get(key) ?? 0) + 1); }
  const fixed = new Uint8Array(n);
  for (const [key, c] of edges) if (c === 1) { fixed[Math.floor(key / n)] = 1; fixed[key % n] = 1; }
  let P = Float64Array.from(pos);
  for (let it = 0; it < iters * 2; it++) {
    const f = it % 2 === 0 ? lambda : mu, Q = Float64Array.from(P);
    for (let v = 0; v < n; v++) {
      if (fixed[v] || !nb[v].size) continue;
      let x = 0, y = 0, z = 0; for (const u of nb[v]) { x += P[u * 3]; y += P[u * 3 + 1]; z += P[u * 3 + 2]; }
      const c = nb[v].size; Q[v * 3] = P[v * 3] + f * (x / c - P[v * 3]); Q[v * 3 + 1] = P[v * 3 + 1] + f * (y / c - P[v * 3 + 1]); Q[v * 3 + 2] = P[v * 3 + 2] + f * (z / c - P[v * 3 + 2]);
    }
    P = Q;
  }
  const out = new Float32Array(idx.length * 3);
  for (let i = 0; i < idx.length; i++) { out[i * 3] = P[idx[i] * 3]; out[i * 3 + 1] = P[idx[i] * 3 + 1]; out[i * 3 + 2] = P[idx[i] * 3 + 2]; }
  return out;
}
