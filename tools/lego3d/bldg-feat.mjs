// Round 5 of the brick-built reconstructions (docs/re/lego3d.md section 16.7): features that are NOT in the game's massing as a surface to voxelise but that a builder would build from real parts: the doors
// (a brick-built leaf in the moving group's own frame, jambs / lintel / threshold in the wall), and the sloped roof windows / skylights (slope-brick frames around the game's translucent panes).
// Node only; reads the game's groups to MEASURE (leaf box, hinge, pane rectangle), the output is geometry made of LDraw part dimensions on the buildings' grid.
import path from 'node:path';
import { loadPart, orient } from './parts.mjs';
import { LDrawLib } from './ldraw.mjs';
import { LDRAW } from './lib.mjs';
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
/** the tilted flat quads of larger translucent pieces (a hipped skylight: two sloped ends + vertical sides): per normal the group of exactly 2 triangles that face up at 25 .. 70 degrees becomes a comp of its own */
export function tiltedQuads(comps) {
  const out = [];
  for (const c of comps) {
    if (c.n <= 2) { out.push(c); continue; }
    if (Math.max(...c.size) < 2.0) continue;   // small lamps (the beacon's 0.8 dome) are not windows
    const by = new Map(), t = c.soup;
    for (let o = 0; o < t.length; o += 9) {
      const u = [t[o + 3] - t[o], t[o + 4] - t[o + 1], t[o + 5] - t[o + 2]], v = [t[o + 6] - t[o], t[o + 7] - t[o + 1], t[o + 8] - t[o + 2]];
      const q = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...q);
      if (l < 1e-9) continue;
      const k = q.map((x) => (x / l).toFixed(2)).join(','), e = by.get(k) ?? by.set(k, { ny: q[1] / l, o: [] }).get(k);
      e.o.push(o);
    }
    for (const e of by.values()) {
      if (e.o.length !== 2 || e.ny < 0.3 || e.ny > 0.93) continue;
      const soup = new Float32Array(18), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      e.o.forEach((o, j) => { for (let k = 0; k < 9; k++) { soup[j * 9 + k] = t[o + k]; lo[k % 3] = Math.min(lo[k % 3], t[o + k]); hi[k % 3] = Math.max(hi[k % 3], t[o + k]); } });
      out.push({ ...c, soup, n: 2, lo, hi, size: hi.map((h, i) => h - lo[i]), part: true });
    }
  }
  return out;
}

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
function slopeTurn(id, ax, sgn, width, alongN = 2) {
  const p0 = loadPart(id);
  for (let r = 0; r < 4; r++) {
    const op = orient(p0, r);
    const along = ax === 2 ? op.d : op.w, lateral = ax === 2 ? op.w : op.d;
    if (along !== alongN || lateral !== width) continue;
    const at = (a) => op.top[ax === 2 ? a * op.w : a], outer = sgn > 0 ? alongN - 1 : 0, inner = alongN - 1 - outer;
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
export function fitRoofWindows(vox, panes, colour, { log = null, windowPart = null } = {}) {
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
  const place = (part, r, c, j, g, force = false) => {   // c: [i, k] of the min corner
    const op = orient(loadPart(part), r), cells = [];
    for (let jj = 0; jj < op.h; jj++) for (let kk = 0; kk < op.d; kk++) for (let ii = 0; ii < op.w; ii++) {
      const i = c[0] + ii, k = c[1] + kk, jc = j + jj;
      if (!inb(i, jc, k)) return null;
      const cell = idx(i, jc, k);
      if (claim[cell] > 0) return null;
      if (op.fill[(jj * op.d + kk) * op.w + ii]) { if (!force && label[cell] >= 0 && label[cell] !== g) return null; cells.push(cell); }
      else if (!force && label[cell] >= 0 && label[cell] !== g) return null;
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
    if (windowPart) {   // the 2 x 4447 comparison of section 16.8: rows of the roof window part (4 x 4 studs, 9 plates, the glass 4448 inside it is roofGlass), one on top of the other, side by side over the run
      let over = 0;
      for (const [c0, c1] of runs) for (let m = 0; m < windowPart.rows; m++) for (let c = c0; c + 3 <= c1 + 1; c += 4) {
        const r = slopeTurn(windowPart.id, ax, sgn, 4, 4);
        if (r === null) { log?.('roof window part: no turn'); continue; }
        const kStart = kOuter - sgn * 3 * m, kMin = sgn > 0 ? kStart - 3 : kStart;
        const pl = place(windowPart.id, r, ax === 2 ? [c, kMin] : [kMin, c], j0 + 9 * m, g, true);
        if (!pl) log?.('roof window part: does not fit'); else over++;
      }
      log?.(`roof window parts: ${over} x ${windowPart.id}`);
      continue;
    }
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

// ---------------------------------------------------------------------------------------------------- roof window glass

let glassLib = null, glassCache = null;
/**
 * The real LDraw glass 4448 ("Glass for Window 4 x 4 x 3 Roof") in its own slab frame, in grid units (0.02 per LDU): u across the width (centred), v up the slope (0 at the lower edge), t along the slab's up-facing
 * normal (0 at its underside). Returns { tris (9 floats per triangle, winding as LDraw's), width, length, thick } or the cached copy.
 */
export function loadGlass(id = '4448') {
  if (glassCache?.id === id) return glassCache;
  glassLib ??= new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
  const f = glassLib.flatten(`${id}.dat`, { res: 'low' }), t = f.tris;
  // the slab's up-facing big face: the largest-area triangle group whose normal points up (LDraw y is down)
  const groups = new Map();
  for (let o = 0; o < t.length; o += 9) {
    const e1 = [t[o + 3] - t[o], t[o + 4] - t[o + 1], t[o + 5] - t[o + 2]], e2 = [t[o + 6] - t[o], t[o + 7] - t[o + 1], t[o + 8] - t[o + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(...n);
    if (l < 1e-9) continue;
    const k = n.map((v) => (v / l).toFixed(2)).join(','), g = groups.get(k) ?? { a: 0, n: n.map((v) => v / l) };
    g.a += l / 2; groups.set(k, g);
  }
  let best = null;
  for (const g of groups.values()) if (g.n[1] < -0.3 && (!best || g.a > best.a)) best = g;
  const nrm = best.n;                                // LDraw frame, up-facing (y negative)
  let up = [0, nrm[2], -nrm[1]];                     // up the slope: perpendicular to the normal in the plane x = 0, pointing up (negative y)
  if (up[1] > 0) up = [0, -up[1], -up[2]];
  const ul = Math.hypot(...up); up = up.map((v) => v / ul);
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9, t0 = 1e9, t1 = -1e9;
  const P = (x, y, z) => [x, y * up[1] + z * up[2], y * nrm[1] + z * nrm[2]];
  for (let i = 0; i < t.length; i += 3) { const q = P(t[i], t[i + 1], t[i + 2]); u0 = Math.min(u0, q[0]); u1 = Math.max(u1, q[0]); v0 = Math.min(v0, q[1]); v1 = Math.max(v1, q[1]); t0 = Math.min(t0, q[2]); t1 = Math.max(t1, q[2]); }
  const out = new Float32Array(t.length), S = 0.02, uc = (u0 + u1) / 2;
  for (let i = 0; i < t.length; i += 3) { const q = P(t[i], t[i + 1], t[i + 2]); out[i] = (q[0] - uc) * S; out[i + 1] = (q[1] - v0) * S; out[i + 2] = (q[2] - t0) * S; }
  // the (u, v, t) frame is right-handed iff the LDraw triple (x, up, n) is: orientation sign of the frame, so the caller can fix the winding after mapping
  glassCache = { id, tris: out, width: (u1 - u0) * S, length: (v1 - v0) * S, thick: (t1 - t0) * S, infos: f.infos };
  return glassCache;
}

/** Sutherland-Hodgman: keep the part of a convex polygon (arrays of [u, v, t]) where f(p) >= 0 (f affine) */
function clipPoly(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const k = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]); }
  }
  return out;
}

/**
 * Real LDraw glass (4448) in the sloped panes of a mesh: per pane the glass slab tiled over its rectangle (the pane is 2 x 1.9 glasses: width / 1.48 across, length / 1.595 up the slope, the last piece of
 * each row / column cut to the pane's edge), lying `lift` above the pane's plane (the game's pane stays under it: the pane is nearly invisible in the game's flags, the glass has a body). Returns
 * { gi -> { pos, nrm (flat normals), idx } } in the mesh's frame, winding outward; `count`: the number of glass pieces.
 */
export function roofGlass(panes, { lift = 0.015, id = '4448' } = {}) {
  const gl = loadGlass(id), by = new Map();
  let count = 0;
  for (const p of panes) {
    if (p.comp.gi === undefined) continue;
    const lat = p.lat, ax = p.ax, d = Math.sign(p.a1 - p.a0) || 1, run = Math.abs(p.a1 - p.a0), rise = p.y1 - p.y0, L = Math.hypot(run, rise);
    const es = [0, 0, 0]; es[ax] = d * run / L; es[1] = rise / L;           // up the slope
    const el = [0, 0, 0]; el[lat] = 1;                                      // across
    const en = p.n;                                                         // up-facing normal
    const W = p.b1 - p.b0, nu = Math.max(1, Math.ceil(W / gl.width - 1e-6)), nv = Math.max(1, Math.ceil(L / gl.length - 1e-6));
    const o = [0, 0, 0]; o[ax] = p.a0; o[1] = p.y0; o[lat] = p.b0;           // the lower corner (b0 side) of the pane
    const buf = by.get(p.comp.gi) ?? by.set(p.comp.gi, { pos: [], nrm: [], idx: [] }).get(p.comp.gi);
    for (let iu = 0; iu < nu; iu++) for (let iv = 0; iv < nv; iv++) {
      const w = W / nu, uc = (iu + 0.5) * w, v0 = iv * gl.length, v1 = Math.min(L, (iv + 1) * gl.length);
      const polys = [], cuts = [[], [], []];   // cut points per clip plane: +u, -u, +v (the caps close the clipped slab)
      const planes = [(q) => w / 2 - q[0], (q) => q[0] + w / 2, (q) => (v1 - v0) - q[1]];
      for (let t = 0; t < gl.tris.length; t += 9) {
        let poly = [0, 1, 2].map((k) => [gl.tris[t + k * 3], gl.tris[t + k * 3 + 1], gl.tris[t + k * 3 + 2]]);
        for (let pi = 0; pi < 3 && poly.length >= 3; pi++) {
          poly = clipPoly(poly, planes[pi]);
          if (poly.length >= 3) for (const q of poly) if (Math.abs(planes[pi](q)) < 1e-7) cuts[pi].push(q);
        }
        if (poly.length >= 3) polys.push(poly);
      }
      // caps: the convex hull of the cut points of each plane (the slab's cross-section is a thin parallelogram), wound outward in the glass frame, reversed when the part's own winding is inward
      const outward = glassWinding(gl);
      const axes = [[1, 2], [1, 2], [0, 2]], dirs = [1, -1, 1], capAx = [0, 0, 1];
      cuts.forEach((pts, pi) => {
        if (pts.length < 3) return;
        const [ia, ib] = axes[pi], h = hull2(pts.map((q) => [q[ia], q[ib]]));
        if (h.length < 3) return;
        const ca = capAx[pi], mk = (pq) => { const q = [0, 0, 0]; q[ia] = pq[0]; q[ib] = pq[1]; q[ca] = pi === 0 ? w / 2 : pi === 1 ? -w / 2 : v1 - v0; return q; };
        for (let k = 1; k < h.length - 1; k++) {
          let tri = [mk(h[0]), mk(h[k]), mk(h[k + 1])];
          const e1 = [tri[1][0] - tri[0][0], tri[1][1] - tri[0][1], tri[1][2] - tri[0][2]], e2 = [tri[2][0] - tri[0][0], tri[2][1] - tri[0][1], tri[2][2] - tri[0][2]];
          const nc = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          const want = dirs[pi] * (outward ? 1 : -1);
          if (nc[ca] * want < 0) tri = [tri[0], tri[2], tri[1]];
          polys.push(tri);
        }
      });
      const start = buf.pos.length / 3, tris = [];
      for (const poly of polys) for (let k = 1; k < poly.length - 1; k++) tris.push([poly[0], poly[k], poly[k + 1]]);
      // (u, v, t) -> the pane: lateral from b0, up the slope, along the normal (+ lift above the plane)
      const map = (q) => [0, 1, 2].map((c) => o[c] + (c === lat ? 0 : 0) + el[c] * (uc + q[0]) + es[c] * (v0 + q[1]) + en[c] * (q[2] + lift));
      const mapped = tris.map((tr) => tr.map(map));
      let vol = 0;   // handedness of the mapping: the full (closed) glass decides whether the winding flips
      for (let t = 0; t < gl.tris.length; t += 9) { const [a, b, c] = [0, 1, 2].map((k) => map([gl.tris[t + k * 3], gl.tris[t + k * 3 + 1], gl.tris[t + k * 3 + 2]])); vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; }
      const flip = vol < 0;
      for (const m of mapped) {
        const [a, b, c] = flip ? [m[0], m[2], m[1]] : m;
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(...n);
        if (l < 1e-12) continue;
        const base = buf.pos.length / 3;
        for (const q of [a, b, c]) { buf.pos.push(q[0], q[1], q[2]); buf.nrm.push(n[0] / l, n[1] / l, n[2] / l); }
        buf.idx.push(base, base + 1, base + 2);
      }
      void start; count++;
    }
  }
  const out = new Map();
  for (const [gi, b] of by) out.set(gi, { pos: Float32Array.from(b.pos), nrm: Float32Array.from(b.nrm), idx: Uint32Array.from(b.idx) });
  return { groups: out, count };
}

/** convex hull (monotone chain) of 2D points, counter-clockwise, duplicates removed */
function hull2(pts) {
  const p = [...new Map(pts.map((q) => [`${q[0].toFixed(6)},${q[1].toFixed(6)}`, q])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-12) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 1e-12) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** is the glass part's own winding outward in its (u, v, t) frame (positive signed volume)? */
function glassWinding(gl) {
  let vol = 0;
  for (let t = 0; t < gl.tris.length; t += 9) { const a = [gl.tris[t], gl.tris[t + 1], gl.tris[t + 2]], b = [gl.tris[t + 3], gl.tris[t + 4], gl.tris[t + 5]], c = [gl.tris[t + 6], gl.tris[t + 7], gl.tris[t + 8]]; vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; }
  return vol > 0;
}

// ---------------------------------------------------------------------------------------------------- rotunda diagonals (round-cornered stairs)

/**
 * The 45-degree vertical walls of the rotunda are a staircase of one-stud steps on the integer grid. Try (docs section 16.8): the outer corner of every step becomes a 1 x 1 round brick (3062b, stacked, 6141
 * round plates for the remainder) so the stair reads as a row of rounded steps. The corner cells are found where the game's own surface is a vertical 45-degree wall (the cell centre within 0.35 of such a
 * triangle) and the cell has exactly two perpendicular open sides (+ the open diagonal). Parts take their cells (claim) like every other part. Returns [{ part, r, i, j, k, g, w, d, h, frame: 'round' }].
 */
export function fitRoundCorners(vox, massSoups, { log = null, brick = '3062b', plate = '6141', reach = 0.35 } = {}) {
  const [nx, ny, nz] = vox.dims, { label, filler, idx, origin, pitch } = vox;
  vox.claim ??= new Int32Array(label.length);
  const claim = vox.claim, out = [], tris = [];
  for (const soup of massSoups) for (let o = 0; o < soup.length; o += 9) {
    const a = [soup[o], soup[o + 1], soup[o + 2]], b = [soup[o + 3], soup[o + 4], soup[o + 5]], c = [soup[o + 6], soup[o + 7], soup[o + 8]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n);
    if (l < 1e-9) continue;
    const q = n.map((x) => x / l);
    if (Math.abs(q[1]) < 0.1 && Math.abs(Math.abs(q[0]) - 0.7071) < 0.12 && Math.abs(Math.abs(q[2]) - 0.7071) < 0.12) tris.push({ a, b, c });
  }
  const inb = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz;
  const air = (i, j, k) => !inb(i, j, k) || (label[idx(i, j, k)] < 0 && filler[idx(i, j, k)] === 0 && claim[idx(i, j, k)] === 0);
  const solid = (i, j, k) => inb(i, j, k) && label[idx(i, j, k)] >= 0 && claim[idx(i, j, k)] === 0;
  const corner = (i, j, k) => {
    if (!solid(i, j, k)) return false;
    const ax = [air(i - 1, j, k), air(i + 1, j, k)], az = [air(i, j, k - 1), air(i, j, k + 1)];
    if (ax[0] === ax[1] || az[0] === az[1]) return false;      // exactly one open side along each axis
    const di = ax[0] ? -1 : 1, dk = az[0] ? -1 : 1;
    return air(i + di, j, k + dk);
  };
  const near = (i, k) => {
    const p = [origin[0] + (i + 0.5) * pitch[0], 0, origin[2] + (k + 0.5) * pitch[2]];
    for (const t of tris) {
      // distance in plan: the triangles are vertical, so compare in x / z with the triangle's own y range ignored by taking the nearest point of its plan segment
      const seg = [[t.a, t.b], [t.b, t.c], [t.c, t.a]];
      for (const [s, e] of seg) { const d = [e[0] - s[0], e[2] - s[2]], L2 = d[0] * d[0] + d[1] * d[1]; if (L2 < 1e-9) continue; const w = Math.max(0, Math.min(1, ((p[0] - s[0]) * d[0] + (p[2] - s[2]) * d[1]) / L2)); if (Math.hypot(p[0] - (s[0] + d[0] * w), p[2] - (s[2] + d[1] * w)) <= reach) return true; }
    }
    return false;
  };
  const take = (part, i, j, k, g) => {
    const cell = idx(i, j, k);
    const op = loadPart(part);
    for (let jj = 0; jj < op.h; jj++) if (!(inb(i, j + jj, k) && label[idx(i, j + jj, k)] === g && claim[idx(i, j + jj, k)] === 0)) return null;
    const id = 7000 + out.length;
    for (let jj = 0; jj < op.h; jj++) { label[idx(i, j + jj, k)] = -1; claim[idx(i, j + jj, k)] = id; }
    void cell;
    const pl = { part, r: 0, i, j, k, g, w: 1, d: 1, h: op.h, frame: 'round' };
    out.push(pl);
    return pl;
  };
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    if (!tris.length) break;
    let j = 0;
    while (j < ny) {
      if (!corner(i, j, k)) { j++; continue; }
      const g = label[idx(i, j, k)];
      let e = j; while (e + 1 < ny && corner(i, e + 1, k) && label[idx(i, e + 1, k)] === g) e++;
      if (e - j + 1 >= 3 && near(i, k)) {
        let c = j;
        while (c <= e) { const left = e - c + 1; const pl = left >= 3 ? take(brick, i, c, k, g) : take(plate, i, c, k, g); if (!pl) { c++; continue; } c += pl.h; }
      }
      j = e + 1;
    }
  }
  log?.(`round corners: ${out.length} parts`);
  return out;
}
