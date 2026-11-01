// Brick-built reconstructions of the game's own massing (docs/re/lego3d.md section 16): the game's buildings and the train carriage are NOT versions of an OMR set model (measured: chamfer
// 0.33-0.46 against 0.10-0.17 for the vehicles, with the baseplate removed and a free per-axis scale), but their masses ARE made of the game's 0.4 x 0.16 x 0.4 stud / plate grid, so they are
// rebuilt from real bricks: the game's closed-or-open surfaces are voxelised onto an LDraw brick grid (stud pitch 20 LDU, plate 8 LDU, brick 24 LDU at the game's scale of 0.02 per LDU), every cell
// keeps the colour group of the surface it lies behind, the cells are covered with real LDraw bricks and plates (3001, 3010, 3022, 3020, ... in the sizes the library has), and the geometry of each
// brick (its outer box, its studs) is emitted in the game frame. Node only; reads the player's game files to MEASURE, the output is geometry made of LDraw part dimensions only.
//
//   const vox = voxelise(groups, { pitch: [0.4, 0.16, 0.4], thick: 0.42, offset })    // { origin, dims, label (Int16: group slot or -1), pitch }
//   const bricks = packBricks(vox)                                                      // [{ g, kind: 'brick' | 'plate', i, j, k, w, l, part }]  (cells i,k in x,z; j in y)
//   const geo = emitBricks(vox, bricks, { studSides: 6 })                               // per group slot: { pos, nrm, idx }
import { TriGrid } from './geomx.mjs';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** the triangles of a game group (world frame soup) with their unit normals ((b-a) x (c-a), outward); degenerate ones dropped */
export function triList(soup) {
  const out = [];
  for (let i = 0; i < soup.length; i += 9) {
    const a = [soup[i], soup[i + 1], soup[i + 2]], b = [soup[i + 3], soup[i + 4], soup[i + 5]], c = [soup[i + 6], soup[i + 7], soup[i + 8]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-9) continue;
    out.push({ a, b, c, n: [n[0] / l, n[1] / l, n[2] / l], area: l / 2 });
  }
  return out;
}

/** closest point of triangle abc to p: { q, inside (projection falls inside the triangle) , d2 } */
function closest(p, a, b, c, n) {
  // project on the plane first: when the projection lies inside, that is the closest point
  const dd = (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1] + (p[2] - a[2]) * n[2];
  const q = [p[0] - dd * n[0], p[1] - dd * n[1], p[2] - dd * n[2]];
  const v0 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], v1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v2 = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1), den = d00 * d11 - d01 * d01;
  const u = (d11 * d20 - d01 * d21) / den, v = (d00 * d21 - d01 * d20) / den, tol = 1e-4;
  return { dd, inside: u >= -tol && v >= -tol && u + v <= 1 + tol, q };
}

/**
 * Offset of the cell grid (per axis, in [0, pitch)) that puts the most surface on cell boundaries: every axis-aligned triangle votes (weight = area) for its plane coordinate modulo the pitch.
 */
export function alignGrid(lists, pitch) {
  const off = [0, 0, 0];
  for (let ax = 0; ax < 3; ax++) {
    const bins = 40, hist = new Float64Array(bins);
    for (const tris of lists) for (const t of tris) {
      if (Math.abs(t.n[ax]) < 0.97) continue;
      const m = ((t.a[ax] % pitch[ax]) + pitch[ax]) % pitch[ax];
      hist[Math.round((m / pitch[ax]) * bins) % bins] += t.area;
    }
    let best = 0;
    for (let b = 1; b < bins; b++) if (hist[b] > hist[best]) best = b;
    off[ax] = (best / bins) * pitch[ax];
  }
  return off;
}

/**
 * Voxelises the surfaces of the given groups. `groups`: [{ tris: soup (world) }]; a cell is claimed by the group whose surface it lies directly BEHIND (centre at most `thick` below the front face, projection
 * inside the triangle, the nearest triangle of that group has the centre on its back side). Cells behind an open surface edge are not claimed. Returns { origin, pitch, dims, label (Int16Array: group index or -1), filler (Uint8: enclosed hollow) }.
 */
export function voxelise(groups, { pitch = [0.4, 0.16, 0.4], thick = 0.42, offset = null, margin = 1, minY = -1e9 } = {}) {
  const lists = groups.map((g) => triList(g.tris));
  const off = offset ?? alignGrid(lists, pitch);
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const l of lists) for (const t of l) for (const p of [t.a, t.b, t.c]) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], p[c]); hi[c] = Math.max(hi[c], p[c]); }
  const origin = [0, 1, 2].map((c) => Math.floor((lo[c] - off[c]) / pitch[c]) * pitch[c] + off[c] - margin * pitch[c]);
  const dims = [0, 1, 2].map((c) => Math.ceil((hi[c] - origin[c]) / pitch[c]) + 1 + margin);
  const N = dims[0] * dims[1] * dims[2], idx = (i, j, k) => (j * dims[2] + k) * dims[0] + i;
  const label = new Int16Array(N).fill(-1), bestDepth = new Float32Array(N).fill(1e9);
  const R = thick + Math.max(...pitch);
  lists.forEach((tris, gi) => {
    const bestD = new Float32Array(N).fill(1e9), ok = new Uint8Array(N), dep = new Float32Array(N), touched = [];
    for (const t of tris) {
      const bl = [0, 1, 2].map((c) => Math.min(t.a[c], t.b[c], t.c[c]) - R), bh = [0, 1, 2].map((c) => Math.max(t.a[c], t.b[c], t.c[c]) + R);
      const i0 = [0, 1, 2].map((c) => Math.max(0, Math.floor((bl[c] - origin[c]) / pitch[c] - 0.5))), i1 = [0, 1, 2].map((c) => Math.min(dims[c] - 1, Math.ceil((bh[c] - origin[c]) / pitch[c] - 0.5)));
      for (let j = i0[1]; j <= i1[1]; j++) for (let k = i0[2]; k <= i1[2]; k++) for (let i = i0[0]; i <= i1[0]; i++) {
        const c = [origin[0] + (i + 0.5) * pitch[0], origin[1] + (j + 0.5) * pitch[1], origin[2] + (k + 0.5) * pitch[2]];
        const dd = (c[0] - t.a[0]) * t.n[0] + (c[1] - t.a[1]) * t.n[1] + (c[2] - t.a[2]) * t.n[2];
        if (dd > 0.02 || dd < -thick) continue;   // not behind this face within `thick`
        const r = closest(c, t.a, t.b, t.c, t.n);
        if (!r.inside) continue;
        const cell = idx(i, j, k), d = Math.abs(dd);
        if (d < bestD[cell]) { if (bestD[cell] === 1e9) touched.push(cell); bestD[cell] = d; ok[cell] = 1; dep[cell] = d; }
      }
    }
    for (const cell of touched) if (ok[cell] && dep[cell] < bestDepth[cell]) { bestDepth[cell] = dep[cell]; label[cell] = gi; }
  });
  // ground clamp
  if (minY > -1e8) for (let j = 0; j < dims[1]; j++) if (origin[1] + (j + 1) * pitch[1] <= minY + 1e-6) for (let k = 0; k < dims[2]; k++) for (let i = 0; i < dims[0]; i++) label[idx(i, j, k)] = -1;
  // enclosed hollow: empty cells that cannot be reached from outside (6-connected through empty cells)
  const outside = new Uint8Array(N), stack = [];
  const push = (i, j, k) => { const c = idx(i, j, k); if (!outside[c] && label[c] < 0) { outside[c] = 1; stack.push(i, j, k); } };
  for (let j = 0; j < dims[1]; j++) for (let k = 0; k < dims[2]; k++) { push(0, j, k); push(dims[0] - 1, j, k); }
  for (let j = 0; j < dims[1]; j++) for (let i = 0; i < dims[0]; i++) { push(i, j, 0); push(i, j, dims[2] - 1); }
  for (let k = 0; k < dims[2]; k++) for (let i = 0; i < dims[0]; i++) { push(i, 0, k); push(i, dims[1] - 1, k); }
  while (stack.length) {
    const k = stack.pop(), j = stack.pop(), i = stack.pop();
    if (i > 0) push(i - 1, j, k); if (i < dims[0] - 1) push(i + 1, j, k);
    if (j > 0) push(i, j - 1, k); if (j < dims[1] - 1) push(i, j + 1, k);
    if (k > 0) push(i, j, k - 1); if (k < dims[2] - 1) push(i, j, k + 1);
  }
  const filler = new Uint8Array(N);
  for (let c = 0; c < N; c++) if (label[c] < 0 && !outside[c]) filler[c] = 1;
  return { origin, pitch, dims, label, filler, idx, offset: off };
}

export const cellCentre = (v, i, j, k) => [v.origin[0] + (i + 0.5) * v.pitch[0], v.origin[1] + (j + 0.5) * v.pitch[1], v.origin[2] + (k + 0.5) * v.pitch[2]];

// ---------------------------------------------------------------------------------------------------- real bricks

// LDraw parts by footprint (studs) at the library's heights: bricks 3 plates (24 LDU), plates 1 (8 LDU). [w, l] with w <= l.
export const BRICKS = [[1, 1, '3005'], [1, 2, '3004'], [1, 3, '3622'], [1, 4, '3010'], [1, 6, '3009'], [1, 8, '3008'], [2, 2, '3003'], [2, 3, '3002'], [2, 4, '3001'], [2, 6, '2456'], [2, 8, '3007']];
export const PLATES = [[1, 1, '3024'], [1, 2, '3023'], [1, 3, '3623'], [1, 4, '3710'], [1, 6, '3666'], [1, 8, '3460'], [2, 2, '3022'], [2, 3, '3021'], [2, 4, '3020'], [2, 6, '3795'], [2, 8, '3034'],
  [4, 4, '3031'], [4, 6, '3032'], [4, 8, '3035'], [6, 6, '3958'], [6, 8, '3036'], [8, 8, '41539'], [6, 10, '3033'], [6, 12, '3028']];

/**
 * Covers the solid cells with bricks and plates. Per (i, k) column and group, a vertical run of cells is cut from the bottom into bricks (3 cells) and plates (the remainder). Per plate layer the cells
 * that start a brick, and the plate cells, are then covered by the largest rectangles the part lists have (greedy, row-major, the long side alternating with the layer so the joints run in bond).
 * Returns [{ g, kind, part, i, j, k, w (x cells), l (z cells), h (cells) }].
 */
export function packBricks(vox, { maxBrick = 8 } = {}) {
  const [nx, ny, nz] = vox.dims, { label, idx } = vox;
  // 1. cut the runs
  const type = new Uint8Array(label.length);   // 0 none, 1 brick start, 2 brick continuation, 3 plate
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    let j = 0;
    while (j < ny) {
      const g = label[idx(i, j, k)];
      if (g < 0) { j++; continue; }
      let e = j; while (e < ny && label[idx(i, e, k)] === g) e++;
      let r = j;
      while (e - r >= 3) { type[idx(i, r, k)] = 1; type[idx(i, r + 1, k)] = 2; type[idx(i, r + 2, k)] = 2; r += 3; }
      while (r < e) { type[idx(i, r, k)] = 3; r++; }
      j = e;
    }
  }
  const out = [];
  const used = new Uint8Array(label.length);
  const parts = (kind) => (kind === 'brick' ? BRICKS : PLATES);
  for (let j = 0; j < ny; j++) {
    for (const [kind, tcode] of [['brick', 1], ['plate', 3]]) {
      const list = parts(kind).filter(([w, l]) => w <= maxBrick && l <= (kind === 'brick' ? maxBrick : 12));
      // candidate sizes biggest area first, with the long side along x on even layers, along z on odd layers
      const sizes = [];
      for (const [w, l, part] of list) { sizes.push({ w: l, l: w, part, area: w * l }); if (w !== l) sizes.push({ w, l, part, area: w * l }); }
      sizes.sort((a, b) => b.area - a.area || (j % 2 ? b.l - a.l : b.w - a.w));
      const free = (i, k, g) => i >= 0 && k >= 0 && i < nx && k < nz && type[idx(i, j, k)] === tcode && !used[idx(i, j, k)] && label[idx(i, j, k)] === g;
      for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
        const c = idx(i, j, k);
        if (type[c] !== tcode || used[c]) continue;
        const g = label[c];
        let pick = null;
        for (const s of sizes) {   // s.w along x, s.l along z
          let ok = true;
          for (let dk = 0; dk < s.l && ok; dk++) for (let di = 0; di < s.w; di++) if (!free(i + di, k + dk, g)) { ok = false; break; }
          if (ok) { pick = s; break; }
        }
        pick ??= { w: 1, l: 1, part: parts(kind)[0][2] };
        for (let dk = 0; dk < pick.l; dk++) for (let di = 0; di < pick.w; di++) {
          used[idx(i + di, j, k + dk)] = 1;
          if (kind === 'brick') { used[idx(i + di, j + 1, k + dk)] = 1; used[idx(i + di, j + 2, k + dk)] = 1; }
        }
        out.push({ g, kind, part: pick.part, i, j, k, w: pick.w, l: pick.l, h: kind === 'brick' ? 3 : 1 });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- geometry

const STUD_R = 6 / 20, STUD_H = 4 / 8;   // LDraw stud: radius 6 LDU on a 20 LDU pitch, 4 LDU high on an 8 LDU plate: as fractions of pitch / plate height

/** quad with outward normal n: corners in CCW order seen from outside ((b-a) x (c-a) = n); appended to the buffers */
function quad(P, N, I, a, b, c, d, n) {
  const base = P.length / 3;
  for (const p of [a, b, c, d]) { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); }
  I.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** stud prism at (cx, y0, cz): radius r, height h, `sides` sides; outward normals, cap up */
function stud(P, N, I, cx, y0, cz, r, h, sides) {
  const base = P.length / 3;
  for (let s = 0; s < sides; s++) { const an = (s / sides) * 2 * Math.PI, c = Math.cos(an), sn = Math.sin(an); P.push(cx + r * c, y0, cz + r * sn); N.push(c, 0, sn); }
  for (let s = 0; s < sides; s++) { const an = (s / sides) * 2 * Math.PI, c = Math.cos(an), sn = Math.sin(an); P.push(cx + r * c, y0 + h, cz + r * sn); N.push(c, 0, sn); }
  const capBase = P.length / 3;
  for (let s = 0; s < sides; s++) { const an = (s / sides) * 2 * Math.PI; P.push(cx + r * Math.cos(an), y0 + h, cz + r * Math.sin(an)); N.push(0, 1, 0); }
  // winding: seen from outside, (b-a) x (c-a) outward. Ring goes x -> z with +angle: from above (+y looking down) that is clockwise in (x, z)? check by the sign of the first side quad
  for (let s = 0; s < sides; s++) { const t = (s + 1) % sides; I.push(base + s, base + sides + s, base + sides + t, base + s, base + sides + t, base + t); }
  for (let s = 1; s < sides - 1; s++) I.push(capBase, capBase + s + 1, capBase + s);
}

/**
 * Emits the outer surface of the brick model: per group, the faces of solid cells whose neighbour across the face is neither solid nor enclosed hollow, merged into maximal rectangles per plane
 * (the seams between the bricks of one colour are invisible at the game's scale, so the surface of a wall is one rectangle, as the union of the bricks' outer boxes is), plus a real stud (LDraw stud.dat:
 * radius 6 / height 4 LDU on the 20 / 8 LDU grid) on every exposed top cell except the interior of big flat areas (smooth tiles). Returns Map group -> { pos, nrm, idx } (outward winding).
 */
export function emitSurface(vox, { studSides = 6, studs = true, tileRadius = 1 } = {}) {
  const { origin, pitch, dims, label, filler, idx } = vox;
  const [nx, ny, nz] = dims;
  const solid = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && (label[idx(i, j, k)] >= 0 || filler[idx(i, j, k)] === 1);
  const X = (i) => origin[0] + i * pitch[0], Y = (j) => origin[1] + j * pitch[1], Z = (k) => origin[2] + k * pitch[2];
  const buf = new Map();
  const get = (g) => { let b = buf.get(g); if (!b) buf.set(g, b = { P: [], N: [], I: [] }); return b; };
  // faces[d][g]: Map plane -> Set of u * 65536 + v ; d: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z
  const faces = Array.from({ length: 6 }, () => new Map());
  const add = (d, g, plane, u, v) => { let m = faces[d].get(g); if (!m) faces[d].set(g, m = new Map()); let s = m.get(plane); if (!s) m.set(plane, s = new Set()); s.add(u * 65536 + v); };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const g = label[idx(i, j, k)];
    if (g < 0) continue;
    if (!solid(i + 1, j, k)) add(0, g, i + 1, k, j);
    if (!solid(i - 1, j, k)) add(1, g, i, k, j);
    if (!solid(i, j + 1, k)) add(2, g, j + 1, i, k);
    if (!solid(i, j - 1, k)) add(3, g, j, i, k);
    if (!solid(i, j, k + 1)) add(4, g, k + 1, i, j);
    if (!solid(i, j, k - 1)) add(5, g, k, i, j);
  }
  const quadOut = (P, N, I, a, b, c, d, n) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const base = P.length / 3;
    for (const p of [a, b, c, d]) { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); }
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0) I.push(base, base + 1, base + 2, base, base + 2, base + 3); else I.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  const NORM = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let d = 0; d < 6; d++) for (const [g, planes] of faces[d]) {
    const { P, N, I } = get(g);
    for (const [plane, set] of planes) {
      // greedy rectangles over (u, v)
      const cells = [...set].map((c) => [Math.floor(c / 65536), c % 65536]);
      let u0 = 1e9, u1 = -1, v0 = 1e9, v1 = -1;
      for (const [u, v] of cells) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const W = u1 - u0 + 1, H = v1 - v0 + 1, used = new Uint8Array(W * H), has = (u, v) => set.has(u * 65536 + v);
      for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) {
        if (!has(u, v) || used[(v - v0) * W + (u - u0)]) continue;
        let eu = u + 1; while (eu <= u1 && has(eu, v) && !used[(v - v0) * W + (eu - u0)]) eu++;
        let ev = v + 1;
        for (;;) { let ok = ev <= v1; for (let q = u; ok && q < eu; q++) if (!has(q, ev) || used[(ev - v0) * W + (q - u0)]) ok = false; if (!ok) break; ev++; }
        for (let b = v; b < ev; b++) for (let q = u; q < eu; q++) used[(b - v0) * W + (q - u0)] = 1;
        let A, B, C, D;
        if (d < 2) { const x = X(plane); A = [x, Y(v), Z(u)]; B = [x, Y(v), Z(eu)]; C = [x, Y(ev), Z(eu)]; D = [x, Y(ev), Z(u)]; }
        else if (d < 4) { const y = Y(plane); A = [X(u), y, Z(v)]; B = [X(eu), y, Z(v)]; C = [X(eu), y, Z(ev)]; D = [X(u), y, Z(ev)]; }
        else { const z = Z(plane); A = [X(u), Y(v), z]; B = [X(eu), Y(v), z]; C = [X(eu), Y(ev), z]; D = [X(u), Y(ev), z]; }
        quadOut(P, N, I, A, B, C, D, NORM[d]);
      }
    }
  }
  if (studs) {
    const r = pitch[0] * STUD_R, h = pitch[1] * STUD_H;
    const interior = (i, j, k, g) => {
      if (tileRadius <= 0) return false;
      for (let dk = -tileRadius; dk <= tileRadius; dk++) for (let di = -tileRadius; di <= tileRadius; di++) {
        const ii = i + di, kk = k + dk;
        if (ii < 0 || kk < 0 || ii >= nx || kk >= nz || label[idx(ii, j, kk)] !== g || solid(ii, j + 1, kk)) return false;
      }
      return true;
    };
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const g = label[idx(i, j, k)];
      if (g < 0 || solid(i, j + 1, k) || interior(i, j, k, g)) continue;
      const { P, N, I } = get(g);
      stud(P, N, I, (X(i) + X(i + 1)) / 2, Y(j + 1), (Z(k) + Z(k + 1)) / 2, r, h, studSides);
    }
  }
  const out = new Map();
  for (const [g, b] of buf) out.set(g, { pos: Float32Array.from(b.P), nrm: Float32Array.from(b.N), idx: Uint32Array.from(b.I) });
  return out;
}

/** signed volume of an indexed soup (positive when the triangles wind outward in the game's convention (b-a)x(c-a) = outward normal) */
export function signedVolume(pos, idx) {
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2], bx = pos[b], by = pos[b + 1], bz = pos[b + 2], cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

/** the soup (9 floats per triangle) of an indexed buffer set */
export function soupOfBuf(pos, idx) {
  const o = new Float32Array(idx.length * 3);
  for (let i = 0; i < idx.length; i++) { o[i * 3] = pos[idx[i] * 3]; o[i * 3 + 1] = pos[idx[i] * 3 + 1]; o[i * 3 + 2] = pos[idx[i] * 3 + 2]; }
  return o;
}

export { TriGrid };

/**
 * Grid offset by silhouette: the plane-alignment offset (alignGrid) is only a start; for every offset on a `steps`^3 lattice of fractions of the pitch (plus that start) the shell is voxelised and its silhouette
 * compared (IoU, 4 views at 256 px) with the game's own surface `gameSoups`; `keepSoups` (the groups that stay the game's) are drawn in both. Returns { offset, score, tried }.
 */
export async function searchOffset(massSoups, keepSoups, gameSoups, opt, { steps = 4, views = [[0, 0], [90, 0], [0, 90], [35, 25]], size = 256 } = {}) {
  const { silhouetteIoU } = await import('./iou.mjs');
  const start = alignGrid(massSoups.map(triList), opt.pitch), cands = [start];
  for (let a = 0; a < steps; a++) for (let b = 0; b < steps; b++) for (let c = 0; c < steps; c++) cands.push([(a / steps) * opt.pitch[0], (b / steps) * opt.pitch[1], (c / steps) * opt.pitch[2]]);
  let best = null;
  const box = silhouetteIoU([...massSoups, ...keepSoups], [...massSoups, ...keepSoups], { views: [[0, 0]], size: 8 }).box;
  for (const off of cands) {
    const vox = voxelise(massSoups.map((t) => ({ tris: t })), { ...opt, offset: off });
    const geo = emitSurface(vox, { studs: false });
    const mine = [...geo.values()].map((g) => soupOfBuf(g.pos, g.idx));
    const r = silhouetteIoU(gameSoups, [...mine, ...keepSoups], { views, size, box });
    const score = 0.5 * r.mean + 0.5 * r.min;
    if (!best || score > best.score) best = { offset: off, score, mean: r.mean, min: r.min };
  }
  return { ...best, tried: cands.length, start };
}
