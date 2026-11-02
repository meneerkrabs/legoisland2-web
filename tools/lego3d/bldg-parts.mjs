// Real LDraw parts on the voxel grid of the brick-built reconstructions (docs/re/lego3d.md section 16.6): slope bricks where the game's surface slopes, window / door frames where the game has an opening,
// and their emission. The voxel model (tools/lego3d/bldg.mjs) stays the base: a part CLAIMS the cells its body fills (`vox.claim`, the cells leave `label`), cuts away the stair cells it replaces, and
// brings its own triangles (tools/lego3d/parts.mjs); faces between a part and solid neighbours are not emitted. Node only.
import { loadPart, orient, PITCH, fillCount } from './parts.mjs';
import { distSqPointTri } from '../../src/mods/lego3d/geom/measure.ts';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** the slope bricks tried, biggest / steepest first. `d`: the depth along the fall line. All are 3 plates high (65 / 75 degree bricks 6 / 9). */
export const SLOPES = ['4445', '3037', '3038', '3039', '3040b', '3298', '4286', '3041', '3042', '3043', '3044b', '3300', '3299', '3045', '3046', '3678b', '3684a', '4460a'];

/** per column (i, k): the exposed top cells (solid cell with no solid cell above): ascending exclusive tops */
function exposedTops(vox) {
  const [nx, ny, nz] = vox.dims, { label, filler, idx } = vox, claim = vox.claim;
  const solid = (i, j, k) => j >= 0 && j < ny && (label[idx(i, j, k)] >= 0 || filler[idx(i, j, k)] === 1 || (claim && claim[idx(i, j, k)] > 0));
  const tops = new Array(nx * nz);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const l = [];
    for (let j = 0; j < ny; j++) if (label[idx(i, j, k)] >= 0 && !solid(i, j + 1, k)) l.push(j + 1);
    tops[k * nx + i] = l;
  }
  return tops;
}

/**
 * Slope bricks by surface: a part (any of 4 turns) fits where, in each of its columns, the model's exposed top lies within one plate of the part's top surface at the column centre (and the steps between
 * neighbouring columns agree within one plate, and a part step of 2 or more plates is a step of at least 1 in the model), the colour is one group, nothing foreign stands in the part's body, and the part
 * does not have to invent more than `addMax` of its body / throw away more than `dropMax` of what stands there. Accepted greedily (bigger parts first, fewer mismatching cells first), non-overlapping.
 * The cells the part's body fills leave `vox.label` and go to `vox.claim`; model cells in the part's box that the body does not fill are removed. Returns [{ part, r, i, j, k, g, w, d, h, add, drop }].
 */
export function fitSlopes(vox, { parts = SLOPES, addMax = 0.8, dropMax = 0.6, tol = 1, meanMax = 0.5, surf = null, support = 0.6, log = null, dbg = null } = {}) {
  const [nx, ny, nz] = vox.dims, { label, idx } = vox;
  vox.claim ??= new Int32Array(label.length);
  const claim = vox.claim, tops = exposedTops(vox);
  const cands = [];
  for (const id of parts) {
    const p0 = loadPart(id);
    const seen = new Set();
    for (let r = 0; r < 4; r++) {
      const op = orient(p0, r), key = Array.from(op.top).map((v) => v.toFixed(1)).join(',') + `|${op.w}x${op.d}`;
      if (seen.has(key)) continue;   // a part that looks the same turned (the doubles)
      seen.add(key);
      const { w, d, h } = op;
      const rnd = Array.from(op.top, (v) => Math.round(v));
      const sl = []; for (let c = 0; c < w * d; c++) if (rnd[c] >= 1 && rnd[c] < h) sl.push(c);   // the sloped columns (below the part's full height)
      if (!sl.length) continue;
      const a = sl[0], ai = a % w, ak = (a / w) | 0, ra = rnd[a];   // anchor column: the first sloped one
      const fc = fillCount(op);
      for (let k0 = -ak; k0 + ak < nz; k0++) for (let i0 = -ai; i0 + ai < nx; i0++) {
        if (i0 < 0 || k0 < 0 || i0 + w > nx || k0 + d > nz) continue;
        for (const T of tops[(k0 + ak) * nx + (i0 + ai)]) {
          const j0 = T - ra;
          if (j0 < 0 || j0 + h > ny) continue;
          const ev = evaluate(vox, tops, op, rnd, i0, j0, k0, { addMax, dropMax, tol, meanMax, surf, support, dbg });
          if (ev) cands.push({ id, r, op, i: i0, j: j0, k: k0, fc, ...ev });
        }
      }
    }
  }
  cands.sort((x, y) => y.fc - x.fc || (x.add + x.drop) - (y.add + y.drop) || x.devSum - y.devSum || x.j - y.j || x.k - y.k || x.i - y.i);
  const out = [];
  for (const c of cands) {
    const { op } = c, { w, d, h } = op;
    let free = true;
    for (let jj = 0; jj < h && free; jj++) for (let kk = 0; kk < d && free; kk++) for (let ii = 0; ii < w; ii++) {
      const cell = idx(c.i + ii, c.j + jj, c.k + kk);
      if (claim[cell] > 0 || (label[cell] >= 0 && label[cell] !== c.g)) { free = false; break; }
    }
    if (!free) continue;
    if (partContacts(vox, [{ i: c.i, j: c.j, k: c.k, w, d, h }]).loose > 0) continue;   // would float: nothing solid touches the box
    out.push(apply(vox, c, out.length + 1));
  }
  log?.(`slopes: ${cands.length} candidates, ${out.length} placed`);
  return out;
}

function evaluate(vox, tops, op, rnd, i0, j0, k0, { addMax, dropMax, tol, meanMax, surf, support, dbg }) {
  const no = (why) => { dbg?.(why, op, i0, j0, k0); return null; };
  const [nx, ny, nz] = vox.dims, { label, idx } = vox, claim = vox.claim;
  const { w, d, h } = op;
  const found = new Array(w * d).fill(-1);
  let g = -2, devSum = 0, n = 0;
  for (let ck = 0; ck < d; ck++) for (let ci = 0; ci < w; ci++) {
    const c = ck * w + ci, r = rnd[c];
    if (r < 1 || r >= op.h) continue;   // only the sloped columns are matched against the model's tops; the full-height columns (the stud row) carry the next part of the chain or the end of the roof
    const E = j0 + r;
    let best = -1, bd = 99;
    for (const T of tops[(k0 + ck) * nx + (i0 + ci)]) { const dv = Math.abs(T - E); if (dv < bd) { bd = dv; best = T; } }
    if (best < 0 || bd > tol) return no('top');
    const lg = label[idx(i0 + ci, best - 1, k0 + ck)];
    if (g === -2) g = lg; else if (g !== lg) return no('group');
    found[c] = best; devSum += bd; n++;
  }
  if (g < 0 || n === 0 || devSum / n > meanMax) return no('mean');
  // the body: foreign material / claimed cells make it fail; count what is invented / thrown away
  let add = 0, drop = 0, both = 0;
  for (let jj = 0; jj < op.h; jj++) for (let kk = 0; kk < d; kk++) for (let ii = 0; ii < w; ii++) {
    const cell = idx(i0 + ii, j0 + jj, k0 + kk), f = op.fill[(jj * d + kk) * w + ii], l = label[cell];
    if (claim[cell] > 0) return no('claim');
    if (l >= 0 && l !== g) return no('foreign');
    if (f && l === g) both++; else if (f) add++; else if (l === g) drop++;
  }
  const nP = both + add;
  if (add > addMax * nP || drop > dropMax * (both + drop + 1e-9) || both < 1) return no(`fill add ${add} drop ${drop} both ${both}`);
  // the evidence: the part's sloped faces must lie on the game's own slanted triangles (a cliff edge of the voxel model has none)
  let sup = 1;
  if (surf) { sup = surf.supportOf(vox, op, i0, j0, k0); if (sup < support) return no(`support ${sup.toFixed(2)}`); }
  return { g, add, drop, both, devSum, sup };
}

/** claims the body's cells, removes the stair cells of the box that the body does not fill */
function apply(vox, c, id) {
  const { op } = c, { w, d, h } = op, { label, idx } = vox, claim = vox.claim;
  for (let jj = 0; jj < h; jj++) for (let kk = 0; kk < d; kk++) for (let ii = 0; ii < w; ii++) {
    const cell = idx(c.i + ii, c.j + jj, c.k + kk);
    if (op.fill[(jj * d + kk) * w + ii]) { label[cell] = -1; claim[cell] = id; }
    else if (label[cell] === c.g) label[cell] = -1;
  }
  return { part: c.id, r: c.r, i: c.i, j: c.j, k: c.k, g: c.g, w, d, h, add: c.add, drop: c.drop, devSum: c.devSum, sup: c.sup };
}

/** the part's triangles on the grid (soup, world), the faces on the box that lie against solid cells left out (all four sample points of a triangle must lie against solid cells) */
export function placedTriangles(vox, pl) {
  const part = orient(loadPart(pl.part), pl.r), t = part.tris;
  const { origin, pitch, dims, label, filler, idx } = vox, claim = vox.claim;
  const [nx, ny, nz] = dims;
  const ox = origin[0] + pl.i * pitch[0], oy = origin[1] + pl.j * pitch[1], oz = origin[2] + pl.k * pitch[2];
  const W = part.w * pitch[0], D = part.d * pitch[2];
  const solidCell = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && (label[idx(i, j, k)] >= 0 || filler[idx(i, j, k)] === 1 || claim[idx(i, j, k)] > 0);
  const out = [];
  for (let o = 0; o < t.length; o += 9) {
    const P = [0, 1, 2].map((k) => [t[o + k * 3], t[o + k * 3 + 1], t[o + k * 3 + 2]]);
    const e = 1e-5;
    let face = -1;
    if (P.every((p) => Math.abs(p[0]) < e)) face = 0; else if (P.every((p) => Math.abs(p[0] - W) < e)) face = 1;
    else if (P.every((p) => Math.abs(p[2]) < e)) face = 2; else if (P.every((p) => Math.abs(p[2] - D) < e)) face = 3;
    else if (P.every((p) => Math.abs(p[1]) < e)) face = 4;
    let cull = false;
    if (face >= 0) {
      const c = [(P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][1] + P[1][1] + P[2][1]) / 3, (P[0][2] + P[1][2] + P[2][2]) / 3];
      const pts = [c, ...P.map((p) => [c[0] + (p[0] - c[0]) * 0.8, c[1] + (p[1] - c[1]) * 0.8, c[2] + (p[2] - c[2]) * 0.8])];
      cull = pts.every((p) => {
        let i = pl.i + Math.floor(p[0] / pitch[0] + 1e-6), j = pl.j + Math.floor(p[1] / pitch[1] + 1e-6), k = pl.k + Math.floor(p[2] / pitch[2] + 1e-6);
        if (face === 0) i = pl.i - 1; else if (face === 1) i = pl.i + part.w; else if (face === 2) k = pl.k - 1; else if (face === 3) k = pl.k + part.d; else j = pl.j - 1;
        return solidCell(i, j, k);
      });
    }
    if (cull) continue;
    for (const p of P) out.push(p[0] + ox, p[1] + oy, p[2] + oz);
  }
  return Float32Array.from(out);
}

/** world positions of the part's studs [[x, y, z]] (y = the surface the stud stands on) */
export function placedStuds(vox, pl) {
  const part = orient(loadPart(pl.part), pl.r), { origin, pitch } = vox;
  return part.studs.map(([x, z, y]) => [origin[0] + pl.i * pitch[0] + x, origin[1] + pl.j * pitch[1] + y, origin[2] + pl.k * pitch[2] + z]);
}

// ---------------------------------------------------------------------------------------------------- the game's slanted surfaces as evidence

/**
 * Index of the slanted triangles (|n.y| between `lo` and `hi`: not a wall, not a floor / flat top) of the game's mass groups. `supportOf(vox, part, i, j, k)`: the fraction (by area) of the part's sloped faces
 * (up-facing, or down-facing for an inverted part) whose sample points lie within `tol` of a game triangle with about the same normal (dot >= `dotMin`).
 */
export function surfaceIndex(soups, { lo = 0.2, hi = 0.97, tol = 0.1, dotMin = 0.85, cell = 0.5 } = {}) {
  const tris = [];
  for (const soup of soups) for (let o = 0; o < soup.length; o += 9) {
    const a = [soup[o], soup[o + 1], soup[o + 2]], b = [soup[o + 3], soup[o + 4], soup[o + 5]], c = [soup[o + 6], soup[o + 7], soup[o + 8]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-9) continue;
    const nn = [n[0] / l, n[1] / l, n[2] / l];
    if (Math.abs(nn[1]) < lo || Math.abs(nn[1]) > hi) continue;
    tris.push({ a, b, c, n: nn });
  }
  const grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  tris.forEach((t, id) => {
    const mn = [0, 1, 2].map((q) => Math.min(t.a[q], t.b[q], t.c[q]) - tol), mx = [0, 1, 2].map((q) => Math.max(t.a[q], t.b[q], t.c[q]) + tol);
    for (let x = Math.floor(mn[0] / cell); x <= Math.floor(mx[0] / cell); x++) for (let y = Math.floor(mn[1] / cell); y <= Math.floor(mx[1] / cell); y++) for (let z = Math.floor(mn[2] / cell); z <= Math.floor(mx[2] / cell); z++) {
      const k = key(x, y, z); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(id);
    }
  });
  const near = (p, n) => {
    const l = grid.get(key(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell)));
    if (!l) return false;
    for (const id of l) { const t = tris[id]; if (dot(t.n, n) >= dotMin && distSqPointTri(p, t.a, t.b, t.c) <= tol * tol) return true; }
    return false;
  };
  const memo = new Map();
  /** sloped faces of the oriented part: [{ pts: 4 local sample points, n, area }] */
  const faces = (op, inverted) => {
    const k = `${op.id}:${op.w}x${op.d}:${op.tris.length}:${op.tris[0]}:${op.tris[2]}:${inverted}`;
    let f = memo.get(k);
    if (f) return f;
    f = [];
    const t = op.tris;
    for (let o = 0; o < t.length; o += 9) {
      const a = [t[o], t[o + 1], t[o + 2]], b = [t[o + 3], t[o + 4], t[o + 5]], c = [t[o + 6], t[o + 7], t[o + 8]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(n[0], n[1], n[2]);
      if (l < 1e-9) continue;
      const nn = [n[0] / l, n[1] / l, n[2] / l], ny = inverted ? -nn[1] : nn[1];
      if (ny < lo || ny > hi) continue;
      const m = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      f.push({ pts: [m, ...[a, b, c].map((p) => [m[0] + (p[0] - m[0]) * 0.7, m[1] + (p[1] - m[1]) * 0.7, m[2] + (p[2] - m[2]) * 0.7])], n: nn, area: l / 2 });
    }
    memo.set(k, f);
    return f;
  };
  return {
    count: tris.length,
    supportOf(vox, op, i, j, k, inverted = false) {
      const ox = vox.origin[0] + i * vox.pitch[0], oy = vox.origin[1] + j * vox.pitch[1], oz = vox.origin[2] + k * vox.pitch[2];
      let tot = 0, ok = 0;
      for (const f of faces(op, inverted)) for (const p of f.pts) { tot += f.area; if (near([p[0] + ox, p[1] + oy, p[2] + oz], f.n)) ok += f.area; }
      return tot > 0 ? ok / tot : 0;
    },
  };
}

// ---------------------------------------------------------------------------------------------------- window / door frames

/** the frames tried in a rectangular opening (thickness 1 stud; w studs wide, h plates high), biggest area first */
export const FRAMES = [['60596', 4, 18], ['60594', 4, 9], ['60593', 2, 9], ['60592', 2, 6]];

/**
 * The flat rectangular panes of the game's translucent groups: axis-aligned vertical sheets { axis (0 = x, 2 = z: the normal), coord, u0, u1 (along the other horizontal axis), y0, y1 }.
 * `soups`: the world triangle soups of the pane components (components() of the translucent groups). Sloped / horizontal / curved ones are returned in `other`.
 */
export function paneRects(comps) {
  const rects = [], other = [];
  for (const c of comps) {
    const t = c.soup, n = [0, 0, 0];
    let planar = true;
    for (let o = 0; o < t.length; o += 9) {
      const u = [t[o + 3] - t[o], t[o + 4] - t[o + 1], t[o + 5] - t[o + 2]], v = [t[o + 6] - t[o], t[o + 7] - t[o + 1], t[o + 8] - t[o + 2]];
      const q = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(q[0], q[1], q[2]);
      if (l < 1e-9) continue;
      for (let a = 0; a < 3; a++) n[a] += Math.abs(q[a]) / l;
    }
    const tot = n[0] + n[1] + n[2];
    const axis = n[0] > n[2] ? 0 : 2;
    if (n[axis] < 0.97 * tot || c.size[axis] > 0.06) planar = false;
    if (!planar) { other.push(c); continue; }
    const ua = axis === 0 ? 2 : 0;
    rects.push({ axis, coord: (c.lo[axis] + c.hi[axis]) / 2, u0: c.lo[ua], u1: c.hi[ua], y0: c.lo[1], y1: c.hi[1] });
  }
  return { rects, other };
}

/**
 * Frames in the openings the panes sit in: per pane the largest rectangle of empty cells (in the wall's layer, cells whose centres lie within the pane's rectangle) is tiled with frames (greedy, biggest area
 * first, from the bottom-left); a frame is placed only where all its cells are empty. The frame claims its box, takes the colour group of the solid cells around the opening.
 */
export function fitFrames(vox, rects, { frames = FRAMES, minCells = 12, log = null } = {}) {
  const [nx, ny, nz] = vox.dims, { label, filler, idx, origin, pitch } = vox;
  vox.claim ??= new Int32Array(label.length);
  const claim = vox.claim;
  const out = [];
  const empty = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && label[idx(i, j, k)] < 0 && filler[idx(i, j, k)] === 0 && claim[idx(i, j, k)] === 0;
  const solid = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && label[idx(i, j, k)] >= 0;
  for (const rc of rects) {
    const ua = rc.axis === 0 ? 2 : 0, nCell = Math.floor((rc.coord - origin[rc.axis]) / pitch[rc.axis]);
    // layers: the cell the pane lies in; (a pane on a cell boundary is ambiguous: take the layer with more solid neighbours in plane)
    const cellOf = (n, u, j) => { const c = [0, 0, 0]; c[rc.axis] = n; c[ua] = u; c[1] = j; return c; };
    const uLo = Math.ceil((rc.u0 - origin[ua]) / pitch[ua] - 0.5), uHi = Math.floor((rc.u1 - origin[ua]) / pitch[ua] - 0.5);
    const jLo = Math.ceil((rc.y0 - origin[1]) / pitch[1] - 0.5), jHi = Math.floor((rc.y1 - origin[1]) / pitch[1] - 0.5);
    if (uHi < uLo || jHi < jLo) continue;
    // maximal empty rectangle in (u, j)
    let best = null;
    for (let u = uLo; u <= uHi; u++) for (let j = jLo; j <= jHi; j++) {
      if (!empty(...cellOf(nCell, u, j))) continue;
      let maxU = uHi;
      for (let j2 = j; j2 <= jHi; j2++) {
        let u2 = u;
        while (u2 <= maxU && empty(...cellOf(nCell, u2, j2))) u2++;
        maxU = Math.min(maxU, u2 - 1);
        if (maxU < u) break;
        const area = (maxU - u + 1) * (j2 - j + 1);
        if (!best || area > best.area) best = { area, u0: u, u1: maxU, j0: j, j1: j2 };
      }
    }
    if (!best || best.area < minCells) { log?.(`pane (axis ${rc.axis}, ${rc.coord.toFixed(2)}): no opening of >= ${minCells} cells`); continue; }
    const Wc = best.u1 - best.u0 + 1, Hc = best.j1 - best.j0 + 1;
    // colour: the groups of the solid cells around the opening (one layer out), majority
    const votes = new Map();
    for (let u = best.u0 - 1; u <= best.u1 + 1; u++) for (let j = best.j0 - 1; j <= best.j1 + 1; j++) {
      if (u >= best.u0 && u <= best.u1 && j >= best.j0 && j <= best.j1) continue;
      const c = cellOf(nCell, u, j);
      if (solid(...c)) { const g = label[idx(...c)]; votes.set(g, (votes.get(g) ?? 0) + 1); }
    }
    if (!votes.size) continue;
    const g = [...votes].sort((a, b) => b[1] - a[1])[0][0];
    // greedy tiling from the bottom-left
    const taken = new Uint8Array(Wc * Hc), placed = [];
    const list = [...frames].sort((a, b) => b[1] * b[2] - a[1] * a[2]);
    for (let hh = 0; hh < Hc; hh++) for (let uu = 0; uu < Wc; uu++) {
      if (taken[hh * Wc + uu]) continue;
      for (const [id, w, h] of list) {
        if (uu + w > Wc || hh + h > Hc) continue;
        let ok = true;
        for (let a = 0; a < h && ok; a++) for (let b = 0; b < w; b++) if (taken[(hh + a) * Wc + uu + b]) { ok = false; break; }
        if (!ok) continue;
        for (let a = 0; a < h; a++) for (let b = 0; b < w; b++) taken[(hh + a) * Wc + uu + b] = 1;
        placed.push({ id, w, h, u: best.u0 + uu, j: best.j0 + hh });
        break;
      }
    }
    const covered = placed.reduce((s, p) => s + p.w * p.h, 0);
    if (covered < 0.6 * Wc * Hc) { log?.(`opening ${Wc} x ${Hc} cells (axis ${rc.axis}): frames cover only ${covered}`); continue; }
    for (const p of placed) {
      const part = loadPart(p.id), r = rc.axis === 2 ? 0 : 1, op = orient(part, r);
      const c = cellOf(nCell, p.u, p.j), ci = [c[0], c[1], c[2]];
      const id = out.length + 1000;
      for (let jj = 0; jj < op.h; jj++) for (let kk = 0; kk < op.d; kk++) for (let ii = 0; ii < op.w; ii++) {
        const cell = idx(ci[0] + ii, ci[1] + jj, ci[2] + kk);
        claim[cell] = id;
      }
      out.push({ part: p.id, r, i: ci[0], j: ci[1], k: ci[2], g, w: op.w, d: op.d, h: op.h, frame: true });
    }
    log?.(`opening ${Wc} x ${Hc} cells (axis ${rc.axis}): ${placed.map((p) => p.id).join(' ')}${covered < Wc * Hc ? ` (+${Wc * Hc - covered} cells left open)` : ''}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- assembly check

/** 6-connected components of the solid cells (bricks + claimed part cells + filler); returns { components, sizes } */
export function components6(vox) {
  const [nx, ny, nz] = vox.dims, { label, filler, claim } = vox, N = label.length;
  const solid = (c) => label[c] >= 0 || filler[c] === 1 || (claim && claim[c] > 0);
  const seen = new Uint8Array(N), sizes = [], stack = [];
  const sx = 1, sz = nx, sy = nx * nz;
  for (let c0 = 0; c0 < N; c0++) {
    if (seen[c0] || !solid(c0)) continue;
    let n = 0; stack.push(c0); seen[c0] = 1;
    while (stack.length) {
      const c = stack.pop(); n++;
      const i = c % nx, k = ((c / nx) | 0) % nz, j = (c / (nx * nz)) | 0;
      if (i > 0 && !seen[c - sx] && solid(c - sx)) { seen[c - sx] = 1; stack.push(c - sx); }
      if (i < nx - 1 && !seen[c + sx] && solid(c + sx)) { seen[c + sx] = 1; stack.push(c + sx); }
      if (k > 0 && !seen[c - sz] && solid(c - sz)) { seen[c - sz] = 1; stack.push(c - sz); }
      if (k < nz - 1 && !seen[c + sz] && solid(c + sz)) { seen[c + sz] = 1; stack.push(c + sz); }
      if (j > 0 && !seen[c - sy] && solid(c - sy)) { seen[c - sy] = 1; stack.push(c - sy); }
      if (j < ny - 1 && !seen[c + sy] && solid(c + sy)) { seen[c + sy] = 1; stack.push(c + sy); }
    }
    sizes.push(n);
  }
  return { components: sizes.length, sizes };
}

/** a part rests on / hangs from something: a solid cell under, or beside, or above the box footprint (any of its box cells' neighbours outside the box that is solid and not the part's own) */
export function partContacts(vox, placements) {
  const [nx, ny, nz] = vox.dims, { label, filler, idx, claim } = vox;
  const solid = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && (label[idx(i, j, k)] >= 0 || filler[idx(i, j, k)] === 1 || claim[idx(i, j, k)] > 0);
  let loose = 0, below = 0;
  const list = [];
  for (const pl of placements) {
    let under = false, any = false;
    for (let kk = 0; kk < pl.d; kk++) for (let ii = 0; ii < pl.w; ii++) if (solid(pl.i + ii, pl.j - 1, pl.k + kk)) under = true;
    const own = (i, j, k) => i >= pl.i && i < pl.i + pl.w && j >= pl.j && j < pl.j + pl.h && k >= pl.k && k < pl.k + pl.d;
    for (let jj = -1; jj <= pl.h; jj++) for (let kk = -1; kk <= pl.d; kk++) for (let ii = -1; ii <= pl.w; ii++) {
      const i = pl.i + ii, j = pl.j + jj, k = pl.k + kk;
      if (own(i, j, k)) continue;
      const faceAdj = (ii < 0 || ii >= pl.w ? 1 : 0) + (jj < 0 || jj >= pl.h ? 1 : 0) + (kk < 0 || kk >= pl.d ? 1 : 0) === 1;
      if (faceAdj && solid(i, j, k)) any = true;
    }
    if (under) below++;
    if (!any) { loose++; list.push(pl); }
  }
  return { loose, below, list };
}
