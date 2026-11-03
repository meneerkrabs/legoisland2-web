// LDraw parts for the brick-built reconstructions (docs/re/lego3d.md section 16.6): slope bricks, window / door frames, plates and tiles as REAL part geometry on the buildings' brick grid (stud 0.4 x plate 0.16 x
// 0.4 = 0.02 per LDU). A part is flattened from the local LDraw library, put in the grid's frame (x, z in the studs' directions, y up, base at y = 0, min corner at the origin: the LDraw frame is
// right-handed with -Y up, the game's left-handed with +Y up, so the winding is reversed), its underside is closed by a flat cap (the hollow is never seen, like the game's own bricks), hidden faces are
// removed and the rest is decimated (coplanar merges only: the outline stays the part's). The studs are NOT in the mesh (the emitter puts its own prisms at `studs`).
//
//   const p = loadPart('3039');                    // { id, title, w (studs along x), d (studs along z), h (plates), tris, studs: [[x, z, y]], top (Float32 per column: height in plates), fill (Uint8 per cell) }
//   const q = orient(p, 1);                        // quarter turns about +Y (min corner stays at the origin), cached
import path from 'node:path';
import { LDrawLib } from './ldraw.mjs';
import { LDRAW } from './lib.mjs';
import { STUD_RE, closeBottom, simplify } from './brickmesh.mjs';
import { RayGrid, pruneHiddenCone } from './geomx.mjs';

export const PITCH = [0.4, 0.16, 0.4], S = 0.02, EPS = 1e-4;
/** convex plates whose geometry is the clean prism of the part's plan outline and height (the cut-corner plates of docs section 16.10: their LDraw underside detail is 100-860 triangles per part and never seen) */
/** the cut tiles are drawn 0.05 stud inside their box and 0.2 stud short at the tip: their outline snaps to the grid by up to 0.25 stud */
export const TILE_PRISM = new Set(['5091', '5092']);
export const PRISM = new Set(['30504', '6106', '30503', '2639', '2450', '26601', '5091', '5092']);
let lib = null;
const cache = new Map(), turned = new Map();

const ceilEps = (v) => Math.ceil(v - 1e-6);

/** the part in the grid's frame (see the header); `res`: LDraw primitive resolution ('low' keeps the cylinders cheap) */
export function loadPart(id, { res = 'low', maxCost = 4e-4 } = {}) {
  const key = `${id}:${res}:${maxCost}`;
  if (cache.has(key)) return cache.get(key);
  lib ??= new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
  const collect = { re: STUD_RE, out: [] };
  const f = lib.flatten(`${id}.dat`, { res, collect });
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, ymax = -1e9, ymin = 1e9;
  for (let i = 0; i < f.tris.length; i += 3) { x0 = Math.min(x0, f.tris[i]); x1 = Math.max(x1, f.tris[i]); ymin = Math.min(ymin, f.tris[i + 1]); ymax = Math.max(ymax, f.tris[i + 1]); z0 = Math.min(z0, f.tris[i + 2]); z1 = Math.max(z1, f.tris[i + 2]); }
  // the footprint is a whole number of studs: studs of the part sit at (x, z) of their placements; the footprint is the stud grid cell range that holds the body
  const gx0 = Math.round(x0 / 10) * 10, gz0 = Math.round(z0 / 10) * 10;   // part origin (LDU) of the min corner (parts are centred on stud centres: edges at multiples of 10)
  const w = Math.max(1, Math.round((x1 - gx0) / 20)), d = Math.max(1, Math.round((z1 - gz0) / 20)), hLdu = ymax;   // y = 0 is the stud base plane of every part, ymax its bottom
  const h = Math.max(1, Math.round(hLdu / 8));
  const g = new Float32Array(f.tris.length);   // game frame: x' = (x - gx0) S, y' = (ymax - y) S, z' = (z - gz0) S; winding reversed (reflection)
  for (let i = 0; i < f.tris.length; i += 9) for (let k = 0; k < 3; k++) {
    const j = k === 1 ? 2 : k === 2 ? 1 : k;
    g[i + j * 3] = (f.tris[i + k * 3] - gx0) * S; g[i + j * 3 + 1] = (ymax - f.tris[i + k * 3 + 1]) * S; g[i + j * 3 + 2] = (f.tris[i + k * 3 + 2] - gz0) * S;
  }
  const closed = closeBottom(g);
  const all = new Float32Array(closed.tris.length + closed.cap.length);
  all.set(closed.tris); all.set(closed.cap, closed.tris.length);
  const kept = pruneHiddenCone(closed.tris, new RayGrid(all), { maxT: 200 });
  const solid = new Float32Array(kept.length + closed.cap.length);
  solid.set(kept); solid.set(closed.cap, kept.length);
  const m = simplify(solid, { maxCost, crease: 35 });
  let tris = new Float32Array(m.idx.length * 3);
  for (let i = 0; i < m.idx.length; i++) { tris[i * 3] = m.pos[m.idx[i] * 3]; tris[i * 3 + 1] = m.pos[m.idx[i] * 3 + 1]; tris[i * 3 + 2] = m.pos[m.idx[i] * 3 + 2]; }
  if (PRISM.has(String(id))) tris = prismOf(g, TILE_PRISM.has(String(id)) ? 0.1 : 0.048);
  // [x, z, y, dir]: `dir` = the stud's axis in the grid frame ((0, 1, 0) for the usual upright stud; a side stud of 87087 / 4070 points along z): LDraw up is -y, the grid's y is flipped
  const studs = collect.out.map((s) => [(s.m[9] - gx0) * S, (s.m[11] - gz0) * S, (ymax - s.m[10]) * S, [-s.m[1], s.m[4], -s.m[7]].map((v) => Math.round(v * 1e3) / 1e3 + 0)]);
  const part = { id: String(id), title: f.info.title, w, d, h, tris, studs, infos: f.infos, raw: f.tris.length / 9 };
  heightfield(part);
  cache.set(key, part);
  return part;
}

/** the prism of the plan outline (convex hull of the soup's x / z, the outline's vertices on the 1/100 stud) and the soup's height: top, bottom and one quad per hull edge, wound outward ((b-a)x(c-a)) */
function prismOf(g, snapTol = 0.048) {
  const seen = new Set(), P = []; let y1 = -1e9;
  const snap = (v) => { const q = Math.round(v / 0.2) * 0.2; return Math.abs(v - q) < snapTol ? q : v; };   // tiles are drawn 0.05 stud inside their grid box: the outline goes on the grid
  for (let i = 0; i < g.length; i += 3) { y1 = Math.max(y1, g[i + 1]); const x = snap(g[i]), z = snap(g[i + 2]), k = `${Math.round(x * 1e4)},${Math.round(z * 1e4)}`; if (!seen.has(k)) { seen.add(k); P.push([x, z]); } }
  P.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const p of P) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 1e-9) lo.pop(); lo.push(p); }
  const up = []; for (const p of [...P].reverse()) { while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 1e-9) up.pop(); up.push(p); }
  const H = lo.slice(0, -1).concat(up.slice(0, -1)), out = [], n = H.length;   // counter-clockwise in (x, z)
  const tri = (a, b, c, want) => {   // keep the winding whose normal agrees with `want`
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const d = nn[0] * want[0] + nn[1] * want[1] + nn[2] * want[2];
    out.push(...(d >= 0 ? [...a, ...b, ...c] : [...a, ...c, ...b]));
  };
  for (let q = 1; q < n - 1; q++) { tri([H[0][0], y1, H[0][1]], [H[q][0], y1, H[q][1]], [H[q + 1][0], y1, H[q + 1][1]], [0, 1, 0]); tri([H[0][0], 0, H[0][1]], [H[q][0], 0, H[q][1]], [H[q + 1][0], 0, H[q + 1][1]], [0, -1, 0]); }
  for (let q = 0; q < n; q++) {
    const a = H[q], b = H[(q + 1) % n], nrm = [b[1] - a[1], 0, -(b[0] - a[0])];   // outward for a counter-clockwise outline
    tri([a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], y1, b[1]], nrm); tri([a[0], 0, a[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], nrm);
  }
  return Float32Array.from(out);
}

/** top surface height (in plates, at the column centre; up-facing triangles of the soup, studs excluded) and the cell fill (cell centre below the top surface, averaged over 4 x 4 samples per column) */
function heightfield(p) {
  const { w, d, h, tris } = p;
  const top = new Float32Array(w * d), fill = new Uint8Array(w * d * h), N = 4;
  const nt = tris.length / 9;
  const tn = [];
  for (let t = 0; t < nt; t++) {
    const o = t * 9, ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2], vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2];
    tn.push(uz * vx - ux * vz);   // y component of the normal
  }
  const hit = (x, z) => {   // highest up-facing surface at (x, z)
    let best = -1;
    for (let t = 0; t < nt; t++) {
      if (tn[t] <= 1e-9) continue;
      const o = t * 9, ax = tris[o], az = tris[o + 2], bx = tris[o + 3], bz = tris[o + 5], cx = tris[o + 6], cz = tris[o + 8];
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) < 1e-12) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den, l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      best = Math.max(best, l1 * tris[o + 1] + l2 * tris[o + 4] + l3 * tris[o + 7]);
    }
    return best;
  };
  for (let k = 0; k < d; k++) for (let i = 0; i < w; i++) {
    const hs = [];
    for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) hs.push(Math.max(0, hit((i + (a + 0.5) / N) * PITCH[0], (k + (b + 0.5) / N) * PITCH[2])) / PITCH[1]);
    top[k * w + i] = hs.reduce((s, v) => s + v, 0) / hs.length;
    for (let j = 0; j < h; j++) { const f = hs.reduce((s, v) => s + Math.min(1, Math.max(0, v - j)), 0) / hs.length; fill[(j * d + k) * w + i] = f >= 0.5 ? 1 : 0; }
  }
  p.top = top; p.fill = fill;
}

/** the part turned `r` quarter turns about +Y (x' = z, z' = W - x): same fields, min corner at the origin */
export function orient(p, r) {
  r = ((r % 4) + 4) % 4;
  if (r === 0) return p;
  const key = `${p.id}:${r}:${p.tris.length}`;
  if (turned.has(key)) return turned.get(key);
  let cur = p;
  for (let q = 0; q < r; q++) cur = quarter(cur);
  turned.set(key, cur);
  return cur;
}
function quarter(p) {
  const W = p.w * PITCH[0], w = p.d, d = p.w;
  const tris = new Float32Array(p.tris.length);
  for (let i = 0; i < tris.length; i += 3) { tris[i] = p.tris[i + 2]; tris[i + 1] = p.tris[i + 1]; tris[i + 2] = W - p.tris[i]; }
  const studs = p.studs.map(([x, z, y, d]) => [z, W - x, y, d ? [d[2], d[1], -d[0] + 0] : d]);
  const top = new Float32Array(w * d), fill = new Uint8Array(w * d * p.h);
  for (let k = 0; k < p.d; k++) for (let i = 0; i < p.w; i++) {
    const ni = k, nk = p.w - 1 - i;   // (x, z) -> (z, W - x)
    top[nk * w + ni] = p.top[k * p.w + i];
    for (let j = 0; j < p.h; j++) fill[(j * d + nk) * w + ni] = p.fill[(j * p.d + k) * p.w + i];
  }
  return { ...p, w, d, tris, studs, top, fill };
}

/** the volume (in cells) of the part's fill */
export const fillCount = (p) => p.fill.reduce((s, v) => s + v, 0);
