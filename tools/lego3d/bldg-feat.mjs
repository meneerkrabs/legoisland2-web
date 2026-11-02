// Round 5 of the brick-built reconstructions (docs/re/lego3d.md section 16.7): features that are NOT in the game's massing as a surface to voxelise but that a builder would build from real parts: the doors
// (a brick-built leaf in the moving group's own frame, jambs / lintel / threshold in the wall), and the sloped roof windows / skylights (slope-brick frames around the game's translucent panes).
// Node only; reads the game's groups to MEASURE (leaf box, hinge, pane rectangle), the output is geometry made of LDraw part dimensions on the buildings' grid.
import { loadPart, orient } from './parts.mjs';
import { emitSurface, packBricks } from './bldg.mjs';

const identityRot = (m) => !m || [0, 1, 2].every((r) => [0, 1, 2].every((c) => Math.abs(m[r * 4 + c] - (r === c ? 1 : 0)) < 1e-5));
const boxOf = (soup) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < soup.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], soup[i + c]); hi[c] = Math.max(hi[c], soup[i + c]); } return { lo, hi }; };

/**
 * The door leaves of a mesh: flat-colour groups with a pure-translation MATL matrix (the game turns them about it), a thin slab of door size (2.4 .. 3.2 wide, 4.5 .. 6 high, <= 0.5 thick: the Res-Q door, the
 * garage's two car-wash doors). Returns [{ g (group index), pane (group index | null: a group with the same matrix whose box lies inside the leaf's x / y range), box, T, hinge: -1 | +1 }].
 */
export function findLeaves(gg, isFlat) {
  const out = [];
  for (const g of gg) {
    if (g.kind !== 'colour' || g.flags !== 0 || !g.matrix || !identityRot(g.matrix) || Math.hypot(g.matrix[12], g.matrix[13], g.matrix[14]) < 1e-6) continue;   // a pure translation: the hinge
    if (!isFlat(g) || g.nTris < 20) continue;
    const b = boxOf(g.tris), s = [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]];
    if (s[0] < 2.4 || s[0] > 3.2 || s[1] < 4.5 || s[1] > 6 || s[2] > 0.5) continue;
    const T = [g.matrix[12], g.matrix[13], g.matrix[14]];
    let pane = null;
    for (const p of gg) {
      if (p === g || !p.matrix || p.matrix[12] !== g.matrix[12] || p.matrix[13] !== g.matrix[13] || p.matrix[14] !== g.matrix[14]) continue;
      const pb = boxOf(p.tris);
      if (pb.lo[0] >= b.lo[0] - 1e-3 && pb.hi[0] <= b.hi[0] + 1e-3 && pb.lo[1] >= b.lo[1] - 1e-3 && pb.hi[1] <= b.hi[1] + 1e-3 && (pb.hi[0] - pb.lo[0]) > 1.5 && (pb.hi[1] - pb.lo[1]) > 3) { pane = { g: p.index, box: pb }; break; }
    }
    out.push({ g: g.index, pane, box: b, T, hinge: Math.abs(T[0] - b.hi[0]) < Math.abs(T[0] - b.lo[0]) ? 1 : -1 });
  }
  return out;
}

/** cell range [c0, c1) of the grid axis `ax` covered by the interval [a, b] (cells that lie wholly inside it, 1e-3 slack) */
const wholly = (vox, ax, a, b) => [Math.ceil((a - vox.origin[ax]) / vox.pitch[ax] - 1e-3 - 1e-9), Math.floor((b - vox.origin[ax]) / vox.pitch[ax] + 1e-3 + 1e-9)];

/**
 * The brick-built leaf, in the group's own frame (the game moves the group by its MATL matrix: the leaf is expressed relative to the hinge, so the animation turns it exactly as it turned the game's leaf).
 * Seven studs wide (2.8, the game's slab is 7.2 studs: not a whole number), as high as the game's (33 plates), one stud thick, in the wall's cell layer; a window opening where the game has its pane
 * (whole cells inside the pane's rectangle), a 1 x 1 brick with a side stud as the door handle at the free stile. Rails and stiles are bricks (the packer's 1 x 6 + 1 x 1 on the rails, 1 x 1 bricks up the stiles);
 * the leaf's top row carries no studs (it swings under the lintel).
 * Returns { vox (the leaf's own cell model in the group's frame), placements, geo (Map slot -> buffers), bricks, info }.
 */
export function buildLeaf(vox, leaf, { studSides = 6, handle = true } = {}) {
  const [px, py, pz] = vox.pitch, { box, T, hinge } = leaf;
  const W = Math.floor((box.hi[0] - box.lo[0]) / px + 1e-6), H = Math.round((box.hi[1] - box.lo[1]) / py);
  // the cell layer (along z) of the wall the leaf stands in: the layer that holds the leaf's centre; its base on the wall grid in y
  const zc = (box.lo[2] + box.hi[2]) / 2, kz = Math.floor((zc - vox.origin[2]) / pz), z0 = vox.origin[2] + kz * pz;
  const y0 = vox.origin[1] + Math.round((box.lo[1] - vox.origin[1]) / py) * py;
  const x0 = hinge > 0 ? T[0] - W * px : T[0];   // the hinge edge of the leaf is the hinge's axis
  const origin = [x0 - T[0], y0 - T[1], z0 - T[2]];
  const dims = [W, H, 1], N = W * H;
  const label = new Int16Array(N), filler = new Uint8Array(N), claim = new Int32Array(N);
  const idx = (i, j, k) => (j * 1 + k) * W + i;
  label.fill(0);
  // window opening: the cells wholly inside the pane's rectangle (world), in the leaf's own x / y
  let hole = null;
  if (leaf.pane) {
    const [a0, a1] = wholly({ origin: [x0, 0, 0], pitch: vox.pitch }, 0, leaf.pane.box.lo[0], leaf.pane.box.hi[0]);
    const [b0, b1] = wholly({ origin: [0, y0, 0], pitch: vox.pitch }, 1, leaf.pane.box.lo[1], leaf.pane.box.hi[1]);
    const i0 = Math.max(1, a0), i1 = Math.min(W - 2, a1 - 1), j0 = Math.max(3, b0), j1 = Math.min(H - 4, b1 - 1);
    if (i1 >= i0 && j1 >= j0) { hole = { i0, i1, j0, j1 }; for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) label[idx(i, j, 0)] = -1; }
  }
  const lv = { origin, pitch: vox.pitch, dims, label, filler, idx, claim, offset: [0, 0, 0] };
  const placements = [];
  // the handle: a 1 x 1 brick with a stud on one side (87087) in the free stile, the stud on the outer face (the face away from the building's inside: the side the pane's decal looks to is decided by the caller)
  let hand = null;
  if (handle) {
    const part = loadPart('87087'), free = hinge > 0 ? 0 : W - 1, jr = Math.max(4, Math.round(H * 0.45));
    // the part's side stud points to -z at r = 0; r = 2 turns it to +z. `outer` = +1 / -1: the leaf's outer side along z
    const r = leaf.outer > 0 ? 2 : 0, op = orient(part, r);
    if (!hole || free < hole.i0 || free > hole.i1) {
      for (let jj = 0; jj < op.h; jj++) { const c = idx(free, jr + jj, 0); label[c] = -1; claim[c] = 1; }
      hand = { part: '87087', r, i: free, j: jr, k: 0, g: 0, w: 1, d: 1, h: op.h };
      placements.push(hand);
    }
  }
  const bricks = packBricks(lv);
  const geo = emitSurface(lv, { studSides, studs: true, tileRadius: 0, placements, studFilter: (i, j) => j + 1 < H });
  return { vox: lv, placements, geo, bricks, info: { W, H, hole, hand: !!hand, origin: origin.map((v) => +v.toFixed(3)), world0: [x0, y0, z0] } };
}

// ---------------------------------------------------------------------------------------------------- door frames

const TILES = [[8, '4162'], [4, '2431'], [2, '3069b'], [1, '3070b']];
const PLATES1 = [[8, '3460'], [4, '3710'], [2, '3023'], [1, '3024']];

/**
 * Jambs, lintel and threshold of the openings the leaves hang in, as real 1 x N parts in the wall's colour: the opening is the empty rectangle around the leaf, bounded by the wall cells of the layers the
 * leaf stands in (the layer itself and its two neighbours); the threshold is a row of 1 x N tiles (smooth: nobody trips over studs) on the cells under the opening, the lintel a row of 1 x N plates on the cells
 * over it, the jambs stacks of 1 x 1 x 5 bricks (15 plates) + 1 x 1 bricks (3 plates) + plates on the cells beside it. Only cells that are wall now (one colour group each) become parts: the parts take
 * their place in the voxel model (claim), nothing is added or removed. Returns [{ part, r, i, j, k, g, w, d, h, frame: 'door' }].
 */
export function fitDoorFrames(vox, leaves, { log = null } = {}) {
  const [nx, ny, nz] = vox.dims, { label, idx, origin, pitch } = vox;
  vox.claim ??= new Int32Array(label.length);
  const claim = vox.claim, out = [];
  const inb = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz;
  const wall = (i, j, k) => inb(i, j, k) && label[idx(i, j, k)] >= 0 && claim[idx(i, j, k)] === 0;
  const take = (part, r, i, j, k, g) => {
    const op = orient(loadPart(part), r);
    for (let jj = 0; jj < op.h; jj++) for (let kk = 0; kk < op.d; kk++) for (let ii = 0; ii < op.w; ii++) if (!(inb(i + ii, j + jj, k + kk) && label[idx(i + ii, j + jj, k + kk)] === g && claim[idx(i + ii, j + jj, k + kk)] === 0)) return null;
    const id = 3000 + out.length;
    for (let jj = 0; jj < op.h; jj++) for (let kk = 0; kk < op.d; kk++) for (let ii = 0; ii < op.w; ii++) { label[idx(i + ii, j + jj, k + kk)] = -1; claim[idx(i + ii, j + jj, k + kk)] = id; }
    const pl = { part, r, i, j, k, g, w: op.w, d: op.d, h: op.h, frame: 'door' };
    out.push(pl);
    return pl;
  };
  /** a horizontal row (along x) of cells at (j, k) from i0 to i1 (inclusive) cut into runs of one colour group, each run covered by the largest parts first */
  const row = (list, i0, i1, j, k) => {
    let i = i0;
    while (i <= i1) {
      if (!wall(i, j, k)) { i++; continue; }
      const g = label[idx(i, j, k)];
      let e = i; while (e + 1 <= i1 && wall(e + 1, j, k) && label[idx(e + 1, j, k)] === g) e++;
      let c = i;
      while (c <= e) { const [len, part] = list.find(([l]) => c + l - 1 <= e); take(part, 0, c, j, k, g); c += len; }
      i = e + 1;
    }
  };
  // pass 1: every leaf's opening, measured before any part is placed (the parts are not wall for the next measurement); leaves in one opening (the garage's two doors) share it
  const openings = [];
  for (const lf of leaves) {
    const xc = (lf.box.lo[0] + lf.box.hi[0]) / 2, yc = (lf.box.lo[1] + lf.box.hi[1]) / 2, zc = (lf.box.lo[2] + lf.box.hi[2]) / 2;
    const ic = Math.floor((xc - origin[0]) / pitch[0]), jc = Math.floor((yc - origin[1]) / pitch[1]), kz = Math.floor((zc - origin[2]) / pitch[2]);
    const layers = [kz - 1, kz, kz + 1].filter((k) => k >= 0 && k < nz);
    const wallAt = (i, j) => layers.some((k) => wall(i, j, k));
    if (wallAt(ic, jc)) { log?.(`door ${lf.g}: its centre cell is a wall`); continue; }
    let i0 = ic, i1 = ic, j0 = jc, j1 = jc;
    while (i0 > ic - 60 && !wallAt(i0 - 1, jc)) i0--;
    while (i1 < ic + 60 && !wallAt(i1 + 1, jc)) i1++;
    while (j0 > jc - 80 && !wallAt(ic, j0 - 1)) j0--;
    while (j1 < jc + 80 && !wallAt(ic, j1 + 1)) j1++;
    if (i0 <= ic - 60 || i1 >= ic + 60 || j0 <= jc - 80 || j1 >= jc + 80) { log?.(`door ${lf.g}: no closed opening`); continue; }
    let dirty = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (wallAt(i, j)) dirty++;
    const x0 = origin[0] + i0 * pitch[0], x1 = origin[0] + (i1 + 1) * pitch[0], y0 = origin[1] + j0 * pitch[1], y1 = origin[1] + (j1 + 1) * pitch[1];
    if (dirty || x0 > lf.box.lo[0] + 1e-3 || x1 < lf.box.hi[0] - 1e-3 || y0 > lf.box.lo[1] + 1e-3 || y1 < lf.box.hi[1] - 1e-3) { log?.(`door ${lf.g}: opening ${i1 - i0 + 1} x ${j1 - j0 + 1} cells does not hold the leaf cleanly (${dirty} wall cells inside)`); continue; }
    lf.opening = { i0, i1, j0, j1, layers, kz, widthStuds: i1 - i0 + 1, heightPlates: j1 - j0 + 1 };
    if (!openings.some((o) => o.i0 === i0 && o.i1 === i1 && o.j0 === j0 && o.j1 === j1 && o.kz === kz)) openings.push(lf.opening);
  }
  // pass 2: the parts
  for (const op of openings) {
    const { i0, i1, j0, j1, layers } = op, n0 = out.length;
    for (const k of layers) {
      row(TILES, i0, i1, j0 - 1, k);          // threshold
      row(PLATES1, i0, i1, j1 + 1, k);        // lintel
      for (const i of [i0 - 1, i1 + 1]) {     // jambs: stacks of 1 x 1 x 5 / 1 x 1 bricks / plates up the opening's height
        let j = j0;
        while (j <= j1) {
          if (!wall(i, j, k)) { j++; continue; }
          const g = label[idx(i, j, k)];
          let e = j; while (e + 1 <= j1 && wall(i, e + 1, k) && label[idx(i, e + 1, k)] === g) e++;
          let c = j;
          while (c <= e) { const left = e - c + 1; const pl = left >= 15 ? take('2453b', 0, i, c, k, g) : left >= 3 ? take('3005', 0, i, c, k, g) : take('3024', 0, i, c, k, g); if (!pl) { c++; continue; } c += pl.h; }
          j = e + 1;
        }
      }
    }
    log?.(`opening ${op.widthStuds} studs x ${op.heightPlates} plates in layers ${layers.join(',')}: ${out.length - n0} frame parts`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- sloped roof windows

/** the slope bricks a frame is built from, by lateral width in studs (each 2 studs deep along the fall line: a sloped stud and the flat stud the next brick stands on) */
const FRAME_SLOPES = [[8, '4445'], [4, '3037'], [2, '3039'], [1, '3040b']];

/**
 * The sloped rectangular panes of a mesh (up-facing, 25 .. 70 degrees, a flat quad): { ax (0 | 2: the horizontal axis the pane falls along), sgn (+1: it falls towards +ax), a0 / a1 (coordinates along ax of the lower /
 * upper edge), b0 / b1 (lateral extent), y0 / y1 (heights of the lower / upper edge), slope (rise per unit run) }. `comps`: components() of the translucent groups.
 */
export function slopedPanes(comps) {
  const out = [];
  for (const c of comps) {
    const t = c.soup, n = [0, 0, 0];
    for (let o = 0; o < t.length; o += 9) {
      const u = [t[o + 3] - t[o], t[o + 4] - t[o + 1], t[o + 5] - t[o + 2]], v = [t[o + 6] - t[o], t[o + 7] - t[o + 1], t[o + 8] - t[o + 2]];
      const q = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      for (let a = 0; a < 3; a++) n[a] += q[a];
    }
    const l = Math.hypot(...n);
    if (l < 1e-9) continue;
    const nn = n.map((v) => v / l);
    if (nn[1] < 0.3 || nn[1] > 0.93 || c.n !== 2) continue;   // a tilted quad (2 triangles) facing up
    const ax = Math.abs(nn[2]) > Math.abs(nn[0]) ? 2 : 0;
    if (Math.abs(nn[ax === 2 ? 0 : 2]) > 0.05) continue;       // falls along one axis only
    const sgn = Math.sign(nn[ax]);
    const lat = ax === 2 ? 0 : 2;
    let y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < t.length; i += 3) { y0 = Math.min(y0, t[i + 1]); y1 = Math.max(y1, t[i + 1]); }
    // the lower edge's coordinate along ax (vertices at the lowest y), the upper edge's
    let a0 = 0, a1 = 0, n0 = 0, n1 = 0;
    for (let i = 0; i < t.length; i += 3) { if (t[i + 1] < y0 + 1e-3) { a0 += t[i + ax]; n0++; } else if (t[i + 1] > y1 - 1e-3) { a1 += t[i + ax]; n1++; } }
    if (!n0 || !n1) continue;
    a0 /= n0; a1 /= n1;
    out.push({ ax, lat, sgn, a0, a1, b0: c.lo[lat], b1: c.hi[lat], y0, y1, slope: (y1 - y0) / Math.abs(a1 - a0), n: nn, comp: c });
  }
  return out;
}

/** the orientation r (quarter turns) of a slope part whose 2-stud fall line runs along `ax` with the sloped stud on the side the pane falls to (sgn), and its lateral width: null when none fits */
function slopeTurn(id, ax, sgn, width) {
  const p0 = loadPart(id);
  for (let r = 0; r < 4; r++) {
    const op = orient(p0, r);
    const along = ax === 2 ? op.d : op.w, lateral = ax === 2 ? op.w : op.d;
    if (along !== 2 || lateral !== width) continue;
    const at = (a) => op.top[ax === 2 ? a * op.w : a], outer = sgn > 0 ? 1 : 0, inner = 1 - outer;
    if (at(outer) < at(inner) - 0.5) return r;
  }
  return null;
}

/**
 * Brick-built frames for the sloped panes: along the fall line a chain of slope bricks (each stands on the flat stud of the one below, one stud further in and one brick higher: the 50-degree roof of
 * the stacked 45-degree slopes), on the pane's side edges (rails; where two panes meet the two rails make a mullion two studs wide) and, as the lowest step, across the pane's whole width (the sill:
 * 4445 / 3037 / 3039 / 3040b as the width needs). The chain starts at the pane's lower edge on the wall's cell grid (its height from the pane's plane) and runs as many studs as the pane is long; the game's pane
 * stays behind it, 0.17 under the sloping top of the frame. A brick is placed only where its cells are free or wall of the frame's colour (one colour group); the wall cells it replaces leave the
 * voxel model and so do the cells of that colour inside the frame's zone above the sill (the stairs the game's thin frame ring made of the voxel model). `colour(pane)`: the mass slot the frame takes.
 * Returns [{ part, r, i, j, k, g, w, d, h, frame: 'roof' }].
 */
export function fitRoofWindows(vox, panes, colour, { log = null } = {}) {
  const [nx, ny, nz] = vox.dims, { label, idx, origin, pitch } = vox;
  vox.claim ??= new Int32Array(label.length);
  const claim = vox.claim, out = [];
  const inb = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz;
  const cellOf = (ax, v) => Math.floor((v - origin[ax]) / pitch[ax] + 1e-6);
  // rows: panes with the same fall line (axis, side, lower and upper edge) share a sill
  const rows = new Map();
  for (const p of panes) {
    const key = [p.ax, p.sgn, p.a0.toFixed(2), p.a1.toFixed(2), p.y0.toFixed(2)].join(',');
    if (!rows.has(key)) rows.set(key, { p, panes: [] });
    rows.get(key).panes.push(p);
  }
  let id = 5000;
  const place = (part, r, c, j, g) => {   // c: [i, k] of the min corner
    const op = orient(loadPart(part), r), cells = [];
    for (let jj = 0; jj < op.h; jj++) for (let kk = 0; kk < op.d; kk++) for (let ii = 0; ii < op.w; ii++) {
      const i = c[0] + ii, k = c[1] + kk, jc = j + jj;
      if (!inb(i, jc, k)) return null;
      const cell = idx(i, jc, k);
      if (claim[cell] > 0) return null;
      if (op.fill[(jj * op.d + kk) * op.w + ii]) { if (label[cell] >= 0 && label[cell] !== g) return null; cells.push(cell); }
      else if (label[cell] >= 0 && label[cell] !== g) return null;
    }
    id++;
    for (let jj = 0; jj < op.h; jj++) for (let kk = 0; kk < op.d; kk++) for (let ii = 0; ii < op.w; ii++) {
      const cell = idx(c[0] + ii, j + jj, c[1] + kk);
      if (op.fill[(jj * op.d + kk) * op.w + ii]) { label[cell] = -1; claim[cell] = id; } else if (label[cell] === g) label[cell] = -1;
    }
    const pl = { part, r, i: c[0], j, k: c[1], g, w: op.w, d: op.d, h: op.h, frame: 'roof' };
    out.push(pl);
    return pl;
  };
  for (const { p, panes: ps } of rows.values()) {
    const { ax, lat, sgn } = p;
    const g = colour(p);
    if (g === null || g === undefined) { log?.('roof window: no frame colour'); continue; }
    const run = Math.abs(p.a1 - p.a0), M = Math.max(1, Math.round(run / pitch[ax]));
    const kOuter = cellOf(ax, p.a0 - sgn * 1e-3);                       // the cell the lower edge lies in
    const zMid = origin[ax] + (kOuter + 0.5) * pitch[ax];
    const planeY = p.y0 + p.slope * (p.a0 - zMid) * sgn;   // the pane's plane at the outer cell's centre (it rises inwards)
    const j0 = Math.round((planeY - origin[1]) / pitch[1]);
    // lateral cells: the cell each pane's side edges lie in; the sill covers all cells from the first to the last of a run of panes
    const rails = new Set(), spans = [];
    for (const q of ps) {
      if (q.b1 - q.b0 < 4 * pitch[lat]) continue;   // a pane under 4 studs wide (the Res-Q skylight's 2-stud ends) would be covered by its own rails: left as the game has it
      const c0 = cellOf(lat, q.b0 + 1e-3), c1 = cellOf(lat, q.b1 - 1e-3);
      rails.add(c0); rails.add(c1); spans.push([c0, c1]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    const runs = [];
    for (const s of spans) { const last = runs[runs.length - 1]; if (last && s[0] <= last[1] + 1) last[1] = Math.max(last[1], s[1]); else runs.push([...s]); }
    const wantLat = (c0, c1, pickList) => {   // greedy cover of lateral cells c0..c1 by the part widths
      const list = []; let c = c0;
      while (c <= c1) { const [w, part] = pickList.find(([ww]) => c + ww - 1 <= c1) ?? FRAME_SLOPES[3]; list.push({ c, w, part }); c += w; }
      return list;
    };
    const before = out.length;
    for (const [c0, c1] of runs) {
      for (let m = 0; m < M; m++) {
        const jb = j0 + 3 * m, kSlope = kOuter - sgn * m;
        // level 0: the sill over the whole run; further levels: the rails (and mullions) only
        const lateral = [];
        if (m === 0) lateral.push(...wantLat(c0, c1, FRAME_SLOPES));
        else {
          const cells = [...rails].filter((c) => c >= c0 && c <= c1).sort((a, b) => a - b);
          let a = 0;
          while (a < cells.length) { let b = a; while (b + 1 < cells.length && cells[b + 1] === cells[b] + 1) b++; lateral.push(...wantLat(cells[a], cells[b], FRAME_SLOPES.filter(([w]) => w <= 2))); a = b + 1; }
        }
        for (const { c, w, part } of lateral) {
          const r = slopeTurn(part, ax, sgn, w);
          if (r === null) { log?.(`roof window: no turn for ${part} on axis ${ax}`); continue; }
          const kMin = Math.min(kSlope, kSlope - sgn);
          const pos = ax === 2 ? [c, kMin] : [kMin, c];
          if (!place(part, r, pos, jb, g)) log?.(`roof window: ${part} at level ${m} does not fit (cells taken or other colour)`);
        }
      }
    }
    // the frame's zone: voxel cells of the frame's colour above the sill level inside the lateral runs and along the chain's footprint are the game's thin ring turned into stairs: they go
    for (const [c0, c1] of runs) for (let m = 0; m < M; m++) {
      const kk = kOuter - sgn * m;
      for (let c = c0; c <= c1; c++) for (let j = j0 + 3 * m; j < j0 + 3 * m + 6; j++) {
        const i = ax === 2 ? c : kk, k = ax === 2 ? kk : c;
        if (inb(i, j, k) && claim[idx(i, j, k)] === 0 && label[idx(i, j, k)] === g) label[idx(i, j, k)] = -1;
      }
    }
    log?.(`roof windows (${ps.length}) axis ${ax} sgn ${sgn}: ${M} studs run, chain from plate row ${j0}, ${out.length - before} bricks`);
  }
  return out;
}
