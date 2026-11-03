// Cut-corner plates on the 45-degree vertical walls of the brick-built reconstructions (docs/re/lego3d.md section 16.10, round 9): where the game's surface is a vertical wall at 45 degrees to the grid
// (the Res-Q rotunda: the bay's roof plate and the roof deck's four corners), the voxel model has a staircase of one-stud steps. LDraw has plates whose own edge is a true 45-degree line between stud
// corners: 26601 (2 x 2, run 1), 2450 (3 x 3, run 2), 30503 (4 x 4, run 3), 6106 (6 x 6, run 4), 2639 (4 x 4 corner, run 2), 30504 (8 x 8, run 7); and, as tiles, 5091 / 5092 (1 x 2 with a 45-degree end).
// A part is placed where its full cells are solid cells of one colour group, the cells its cut leaves outside are the stair's overshoot (they are removed), and its diagonal edge lies on the game's own wall
// triangles. The parts take cells like every other placement (`vox.claim`): a cell the part covers by half or more is claimed (its neighbours see it as solid), the part brings its own triangles.
// Wedge plates 43722 / 43723 / 6564 / 6565 / 41767 / 41768 are NOT 45 degrees (18.4 degrees: a 1 : 3 flank), the 'Wing' 2 x 2 / 2 x 4 / 3 x 6 plates are round or 22.5 degrees: not candidates.
import { loadPart, orient, PITCH } from './parts.mjs';
import { partContacts } from './bldg-parts.mjs';
import { distSqPointTri } from '../../src/mods/lego3d/geom/measure.ts';

/** cut-corner plates: { id, tile } ; a tile has no studs (a stack of them is not buildable: only used when `tiles` is on) */
export const WEDGE_PLATES = ['30504', '6106', '30503', '2639', '2450', '26601'];
export const WEDGE_TILES = ['5091', '5092'];

const hull = (P) => {
  P = [...P].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const p of P) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 1e-9) lo.pop(); lo.push(p); }
  const up = []; for (const p of [...P].reverse()) { while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 1e-9) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
};
/** area of the convex polygon `poly` clipped to the box [x0, x1] x [z0, z1] (Sutherland-Hodgman) */
function clipArea(poly, x0, x1, z0, z1) {
  let p = poly;
  const cut = (inside, inter) => { const o = []; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length], ia = inside(a), ib = inside(b); if (ia) o.push(a); if (ia !== ib) o.push(inter(a, b)); } p = o; };
  cut((q) => q[0] >= x0, (a, b) => [x0, a[1] + ((x0 - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]);
  if (p.length) cut((q) => q[0] <= x1, (a, b) => [x1, a[1] + ((x1 - a[0]) / (b[0] - a[0])) * (b[1] - a[1])]);
  if (p.length) cut((q) => q[1] >= z0, (a, b) => [a[0] + ((z0 - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), z0]);
  if (p.length) cut((q) => q[1] <= z1, (a, b) => [a[0] + ((z1 - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), z1]);
  let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}

const shapes = new Map();
/** the oriented part's plan footprint in cell units: { op, cells: [[di, dk, coverage]], diag: [[ax, az, bx, bz, nx, nz]] (the 45-degree hull edges, cell units, outward normal) } */
function shapeOf(id, r) {
  const key = `${id}:${r}`;
  if (shapes.has(key)) return shapes.get(key);
  const op = orient(loadPart(id), r), t = op.tris, pts = [];
  const tol = WEDGE_TILES.includes(String(id)) ? 0.25 : 0.12, snap = (v) => { const q = Math.round(v * 2) / 2; return Math.abs(v - q) < tol ? q : v; };
  for (let o = 0; o < t.length; o += 3) pts.push([+snap(t[o] / PITCH[0]).toFixed(4), +snap(t[o + 2] / PITCH[2]).toFixed(4)]);
  const poly = hull(pts), cells = [], diag = [];
  for (let k = 0; k < op.d; k++) for (let i = 0; i < op.w; i++) { const c = clipArea(poly, i, i + 1, k, k + 1); if (c > 1e-3) cells.push([i, k, c]); }
  for (let q = 0; q < poly.length; q++) {
    const a = poly[q], b = poly[(q + 1) % poly.length], dx = b[0] - a[0], dz = b[1] - a[1];
    if (Math.abs(Math.abs(dx) - Math.abs(dz)) < 0.06 && Math.abs(dx) > 0.9) {
      const l = Math.hypot(dx, dz); // hull is counter-clockwise in (x, z): the outward normal is (dz, -dx)
      diag.push([a[0], a[1], b[0], b[1], dz / l, -dx / l]);
    }
  }
  const s = { op, cells, diag, poly };
  shapes.set(key, s);
  return s;
}

/** the game's vertical 45-degree wall triangles of the mass groups: [{ a, b, c, n: [nx, nz] }] */
export function wallTriangles(massSoups) {
  const tris = [];
  for (const soup of massSoups) for (let o = 0; o < soup.length; o += 9) {
    const a = [soup[o], soup[o + 1], soup[o + 2]], b = [soup[o + 3], soup[o + 4], soup[o + 5]], c = [soup[o + 6], soup[o + 7], soup[o + 8]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n);
    if (l < 1e-9) continue;
    const q = n.map((x) => x / l);
    if (Math.abs(q[1]) < 0.1 && Math.abs(Math.abs(q[0]) - 0.7071) < 0.12 && Math.abs(Math.abs(q[2]) - 0.7071) < 0.12) tris.push({ a, b, c, n: [q[0], q[2]] });
  }
  return tris;
}

/**
 * Places cut-corner plates (and, with `tiles`, cut tiles) on the staircase edges of 45-degree walls. `wall`: wallTriangles(massSoups). `tol`: how far (units) the part's diagonal may lie from the game's wall
 * (the grid line is at most half a diagonal step, 0.14, from the true line). `addMax` / `dropMax`: cell areas the part may add where the model is empty / remove of the stair beyond its cut.
 * Returns [{ part, r, i, j, k, g, w, d, h, add, drop, run, err, frame: 'wedge' }].
 */
export function fitWedges(vox, wall, { parts = WEDGE_PLATES, tiles = false, tol = 0.2, addMax = 1.6, dropMax = 3, minRun = 1, log = null, dbg = null } = {}) {
  if (!wall.length) return [];
  const [nx, ny, nz] = vox.dims, { label, idx, origin, pitch } = vox;
  vox.claim ??= new Int32Array(label.length);
  const claim = vox.claim, ids = tiles ? [...parts, ...WEDGE_TILES] : parts;
  const cands = [];
  for (const id of ids) {
    for (let r = 0; r < 4; r++) {
      const sh = shapeOf(id, r), { op } = sh, { w, d, h } = op;
      if (!sh.diag.length) continue;
      const full = sh.cells.filter((c) => c[2] > 0.98), part = sh.cells.filter((c) => c[2] <= 0.98);
      const run = Math.max(...sh.diag.map((e) => Math.abs(e[2] - e[0])));
      if (run < minRun) continue;
      for (let j = 0; j + h <= ny; j++) for (let k0 = 0; k0 + d <= nz; k0++) for (let i0 = 0; i0 + w <= nx; i0++) {
        // all full cells solid, one group, unclaimed
        let g = -2, ok = true;
        for (const [di, dk] of full) { const c = idx(i0 + di, j, k0 + dk), L = label[c]; if (L < 0 || claim[c] > 0 || (g !== -2 && L !== g)) { ok = false; break; } g = L; }
        if (!ok || g < 0) { dbg?.('full', id, r, i0, j, k0); continue; }
        let add = 0, drop = 0;
        for (const [di, dk, cv] of part) {
          const c = idx(i0 + di, j, k0 + dk), L = label[c];
          if (claim[c] > 0 || (L >= 0 && L !== g)) { ok = false; break; }
          if (L < 0) add += cv;
        }
        if (!ok || add > addMax) { dbg?.('part', id, r, i0, j, k0); continue; }
        // the stair beyond the cut (the box cells the part does not reach at all) leaves
        const inPart = new Set(sh.cells.map((c) => c[1] * w + c[0]));
        for (let dk = 0; dk < d; dk++) for (let di = 0; di < w; di++) if (!inPart.has(dk * w + di)) { const L = label[idx(i0 + di, j, k0 + dk)]; if (L === g) drop++; else if (L >= 0) { ok = false; } }
        if (!ok || drop > dropMax) { dbg?.('drop', id, r, i0, j, k0); continue; }
        // evidence: every sample of a diagonal edge lies on a wall triangle facing the same way
        const oy = origin[1] + (j + h / 2) * pitch[1];
        let err = 0, nE = 0;
        for (const e of sh.diag) {
          for (let s = 0; s <= 4; s++) {
            const f = s / 4, p = [origin[0] + (i0 + e[0] + (e[2] - e[0]) * f) * pitch[0], oy, origin[2] + (k0 + e[1] + (e[3] - e[1]) * f) * pitch[2]];
            let best = 9;
            for (const t of wall) { if (t.n[0] * e[4] + t.n[1] * e[5] < 0.85) continue; const dd = Math.sqrt(distSqPointTri(p, t.a, t.b, t.c)); if (dd < best) best = dd; }
            if (best > tol) { ok = false; break; }
            err += best; nE++;
          }
          if (!ok) break;
        }
        if (!ok) { dbg?.(`evidence`, id, r, i0, j, k0); continue; }
        cands.push({ id, r, op, i: i0, j, k: k0, g, w, d, h, add, drop, run, err: err / Math.max(1, nE), full: full.length });
      }
    }
  }
  // bigger cuts first, then the better fit (fewer cells invented / thrown away, nearer to the wall); the strip of a thin wall can be cut into pairs along x or along z: both orders are tried on copies and the one
  // that takes more cells of the staircase wins (a pair along the wrong axis leaves one stair cell at the end of the strip as a nub)
  const base = (x, y) => y.run - x.run || (x.add + x.drop) - (y.add + y.drop);
  const orders = [(x, y) => base(x, y) || (y.w - y.d) - (x.w - x.d) || x.err - y.err || x.j - y.j || x.k - y.k || x.i - y.i, (x, y) => base(x, y) || (x.w - x.d) - (y.w - y.d) || x.err - y.err || x.j - y.j || x.k - y.k || x.i - y.i];
  const run = (order, label, claim) => {
    const out = [];
    for (const c of [...cands].sort(order)) {
      const sh = shapeOf(c.id, c.r), { w, d, h } = c;
      let free = true;
      for (const [di, dk, cv] of sh.cells) { const cell = idx(c.i + di, c.j, c.k + dk); if (claim[cell] > 0 || (cv > 0.98 && label[cell] !== c.g)) { free = false; break; } }
      if (!free) continue;
      if (partContacts({ ...vox, label, claim }, [{ i: c.i, j: c.j, k: c.k, w, d, h }]).loose > 0) continue;
      const id = 8000 + out.length;
      const inPart = new Set();
      for (const [di, dk, cv] of sh.cells) {
        inPart.add(dk * w + di);
        const cell = idx(c.i + di, c.j, c.k + dk);
        if (cv >= 0.5 - 1e-6) { label[cell] = -1; claim[cell] = id; }   // half or more: the part's (its neighbours see solid)
        else if (label[cell] === c.g) label[cell] = -1;   // less than half: the stair cell goes, the part's sliver stays unclaimed
      }
      for (let dk = 0; dk < d; dk++) for (let di = 0; di < w; di++) if (!inPart.has(dk * w + di)) { const cell = idx(c.i + di, c.j, c.k + dk); if (label[cell] === c.g) label[cell] = -1; }
      out.push({ part: c.id, r: c.r, i: c.i, j: c.j, k: c.k, g: c.g, w, d, h, add: c.add, drop: c.drop, run: c.run, err: c.err, frame: 'wedge' });
    }
    return out;
  };
  // the cells of the staircase the plan left behind: solid cells of the part's colour that lie along one of its diagonal edges and at most half a cell inside it (an overshoot: a nub that sticks out of the smooth line)
  const nubs = (out, lb, cb) => {
    const seen = new Set();
    for (const p of out) {
      const sh = shapeOf(p.part, p.r);
      for (const e of sh.diag) {
        for (let dk = -1; dk <= p.d; dk++) for (let di = -1; di <= p.w; di++) {
          const i = p.i + di, k = p.k + dk; if (i < 0 || k < 0 || i >= nx || k >= nz) continue;
          const cell = idx(i, p.j, k); if (lb[cell] !== p.g || cb[cell] > 0 || seen.has(cell)) continue;
          const cx = i + 0.5 - p.i - e[0], cz = k + 0.5 - p.k - e[1], sdist = cx * e[4] + cz * e[5];   // signed distance (cells) of the cell centre from the edge's line, positive outside
          const tx = e[2] - e[0], tz = e[3] - e[1], tl = Math.hypot(tx, tz), along = (cx * tx + cz * tz) / tl;
          if (sdist > -0.4 && along > -0.6 && along < tl + 0.6) { seen.add(cell); }
        }
      }
    }
    return seen.size;
  };
  let best = null;
  for (const order of orders) {
    const lb = Int32Array.from(label), cb = Int32Array.from(claim), out = run(order, lb, cb);
    const score = out.reduce((s, p) => s + p.w * p.d, 0) - 6 * nubs(out, lb, cb);
    if (!best || score > best.score) best = { order, score };
  }
  const out = run(best.order, label, claim);
  log?.(`wedges: ${cands.length} candidates, ${out.length} placed (${[...new Set(out.map((p) => p.part))].map((id) => `${out.filter((p) => p.part === id).length} x ${id}`).join(', ')})`);
  return out;
}
