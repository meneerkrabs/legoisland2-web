// Brick meshes from LDraw parts, in the game's frame: (1) the part body without its studs, hidden faces removed, the underside CLOSED by a flat cap (like the game's bricks: the hollow underside and the
// tubes are never seen, but bricks tumble in the effects, so there must be a bottom), real decimation (quadric: coplanar / collinear merges first), crease-welded normals; (2) the studs as cheap procedural
// prisms placed at the part's own stud.dat placements (N sides: 16 / 8 at LOD 0, 4 at LOD 1 like the game's 10-triangle stud, smooth radial normals). Output: { pos, nrm, idx (u16 range), split }.
import fs from 'node:fs';
import path from 'node:path';
import { LDRAW } from './lib.mjs';
import { decimate, creaseNormals } from '../../src/mods/lego3d/geom/decimate.ts';
import { RayGrid, TriGrid, pruneHiddenCone } from './geomx.mjs';
import { toGame, pointToGame, S } from './brickfit.mjs';
import { applyRot } from './geom.mjs';

/** LDraw colour codes that are transparent (ALPHA < 200 in LDConfig.ldr, glow-in-the-dark excluded): the glass of windows, windscreens and doors */
export const TRANS = (() => {
  const set = new Set();
  try {
    for (const l of fs.readFileSync(path.join(LDRAW, 'lib/ldraw/LDConfig.ldr'), 'utf8').split(/\r?\n/)) {
      const m = l.match(/!COLOUR\s+\S+\s+CODE\s+(\d+)\b.*\bALPHA\s+(\d+)/);
      if (m && +m[2] < 200 && !/GLOW/i.test(l) && !/MATERIAL/i.test(l)) set.add(+m[1]);
    }
  } catch { for (const c of [33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 52, 54, 57]) set.add(c); }
  return set;
})();

// the top-stud primitives: solid, open (hollow), open without base edges, the logo variants, without logo; the hollow ones are built solid (the game's studs are solid)
export const STUD_RE = /^(stud|stud2|stud2a|stud26|stud-logo[2-5]?|stud2-logo[2-5]?)\.dat$/;

/** the stud prism in the part's own frame (LDU, stud axis -Y, radius 6, height 4): ring vertices at y 0 / -4 with radial normals, a cap with the up normal. Returns { pos, nrm, idx } (outward CCW in LDraw's frame) */
export function studLocal(n) {
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a); pos.push(6 * c, 0, 6 * s); nrm.push(c, 0, s); }       // 0..n-1 bottom ring
  for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a); pos.push(6 * c, -4, 6 * s); nrm.push(c, 0, s); }      // n..2n-1 top ring (side)
  for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; pos.push(6 * Math.cos(a), -4, 6 * Math.sin(a)); nrm.push(0, -1, 0); }                      // 2n..3n-1 top ring (cap)
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(i, n + j, n + i, i, j, n + j); }                                                            // side quads
  for (let i = 1; i < n - 1; i++) idx.push(2 * n, 2 * n + i, 2 * n + i + 1);                                                                               // cap fan
  return { pos, nrm, idx };
}

/** triangle orientation sign of the stud prism in LDraw's frame, checked against the outward normal of the first side quad (kept for the test) */
export function studWindingOk(n = 8) {
  const { pos, idx } = studLocal(n);
  let vol = 0;   // signed volume of the closed prism (cap + sides + a virtual bottom): sum of tetra volumes from the origin of the side + cap triangles is enough to see the sign
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx.slice(t, t + 3).map((i) => pos.slice(i * 3, i * 3 + 3)), cr = [a[1][1] * a[2][2] - a[1][2] * a[2][1], a[1][2] * a[2][0] - a[1][0] * a[2][2], a[1][0] * a[2][1] - a[1][1] * a[2][0]];
    vol += a[0][0] * cr[0] + a[0][1] * cr[1] + a[0][2] * cr[2];
  }
  return vol;
}

/** stud placements (matrix 3x3 rows + translation in the part's frame) -> game-frame vertices: { pos, nrm, idx } with `sides` sides each */
export function placeStuds(placements, sides, rot, shift, flipWinding, post = null, follow = null) {
  const L = studLocal(sides), nv = L.pos.length / 3;
  const pos = [], nrm = [], idx = [];
  for (const pl of placements) {
    const M = pl.m, base = pos.length / 3;
    // follow = { c, s }: the body was scaled per axis about c; the stud keeps its shape and its x / z (the stud grid), only its base height follows the scaled body
    let fy = 0;
    if (follow) { const b0 = applyRot(rot, [-M[9] * S, -M[10] * S, -M[11] * S]); fy = (follow.c[1] + (b0[1] + shift[1] - follow.c[1]) * follow.s[1]) - (b0[1] + shift[1]); }
    for (let v = 0; v < nv; v++) {
      const x = L.pos[v * 3], y = L.pos[v * 3 + 1], z = L.pos[v * 3 + 2];
      const q = [M[0] * x + M[1] * y + M[2] * z + M[9], M[3] * x + M[4] * y + M[5] * z + M[10], M[6] * x + M[7] * y + M[8] * z + M[11]];
      const g = applyRot(rot, [-q[0] * S, -q[1] * S, -q[2] * S]);
      const gx = g[0] + shift[0], gy = g[1] + shift[1] + fy, gz = g[2] + shift[2];
      if (post) pos.push(post.c[0] + (gx - post.c[0]) * post.s[0], post.c[1] + (gy - post.c[1]) * post.s[1], post.c[2] + (gz - post.c[2]) * post.s[2]); else pos.push(gx, gy, gz);
      const nx = L.nrm[v * 3], ny = L.nrm[v * 3 + 1], nz = L.nrm[v * 3 + 2];
      const w = [M[0] * nx + M[1] * ny + M[2] * nz, M[3] * nx + M[4] * ny + M[5] * nz, M[6] * nx + M[7] * ny + M[8] * nz];
      const gn = applyRot(rot, [-w[0], -w[1], -w[2]]), l = Math.hypot(gn[0], gn[1], gn[2]) || 1;
      nrm.push(gn[0] / l, gn[1] / l, gn[2] / l);
    }
    const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
    // the part-to-game map is a reflection (p -> -p): winding is reversed, unless the placement itself mirrors
    const rev = det > 0;
    for (let t = 0; t < L.idx.length; t += 3) { const a = L.idx[t] + base, b = L.idx[t + 1] + base, c = L.idx[t + 2] + base; if (rev) idx.push(a, c, b); else idx.push(a, b, c); }
  }
  return { pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), idx: Uint32Array.from(idx) };
}

// ---------------------------------------------------------------------------------------------------- closing the underside

export const key3 = (x, y, z, e = 1e-4) => `${Math.round(x / e)},${Math.round(y / e)},${Math.round(z / e)}`;

/** ear-clipping triangulation of a simple polygon given as [[x, z], ...] (orientation either way); returns triples of indices into the polygon */
function earClip(P) {
  const n = P.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const sgn = area > 0 ? 1 : -1;
  const idx = [...Array(n).keys()], out = [];
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  let guard = n * n + 10;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = P[ia], b = P[ib], c = P[ic];
      if (cross(a, b, c) * sgn <= 1e-12) continue;
      let inside = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        const p = P[j];
        if (cross(a, b, p) * sgn >= -1e-12 && cross(b, c, p) * sgn >= -1e-12 && cross(c, a, p) * sgn >= -1e-12) { inside = true; break; }
      }
      if (inside) continue;
      out.push([ia, ib, ic]); idx.splice(i, 1); clipped = true; break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

/**
 * The underside of a part in the game's frame: the downward-facing faces in the bottom plane (the rim of the hollow, the tube ends) are replaced by flat caps over their OUTER loops, so that the
 * hollow behind them counts as hidden (and the part is closed from below, like the game's bricks). Returns { tris (without the rim), cap (flat cap triangles), ymin }.
 */
export function closeBottom(tris, eps = 2e-3) {
  let ymin = 1e9;
  for (let i = 1; i < tris.length; i += 3) ymin = Math.min(ymin, tris[i]);
  const rim = [], rest = [];
  for (let i = 0; i < tris.length; i += 9) {
    const t = tris.subarray(i, i + 9);
    const flat = Math.abs(t[1] - ymin) < eps && Math.abs(t[4] - ymin) < eps && Math.abs(t[7] - ymin) < eps;
    const nx = (t[4] - t[1]) * (t[8] - t[2]) - (t[5] - t[2]) * (t[7] - t[1]), ny = (t[5] - t[2]) * (t[6] - t[0]) - (t[3] - t[0]) * (t[8] - t[2]), nz = (t[3] - t[0]) * (t[7] - t[1]) - (t[4] - t[1]) * (t[6] - t[0]);
    if (flat && ny < -0.9 * Math.hypot(nx, ny, nz)) rim.push(t); else rest.push(t);
  }
  if (!rim.length) return { tris, cap: new Float32Array(0), ymin };
  // boundary edges of the rim triangles
  const pts = new Map(), edges = new Map();
  const vk = (t, k) => { const x = t[k * 3], z = t[k * 3 + 2], kk = key3(x, 0, z); if (!pts.has(kk)) pts.set(kk, [x, z]); return kk; };
  let tsign = 0;
  for (const t of rim) {
    const a = vk(t, 0), b = vk(t, 1), c = vk(t, 2);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) edges.set(`${u}>${v}`, [u, v]);
    tsign += (t[3] - t[0]) * (t[8] - t[2]) - (t[6] - t[0]) * (t[5] - t[2]);
  }
  const bnd = [...edges.values()].filter(([u, v]) => !edges.has(`${v}>${u}`));
  const next = new Map();
  for (const [u, v] of bnd) { const l = next.get(u); if (l) l.push(v); else next.set(u, [v]); }
  const loops = [], used = new Set();
  for (const [u0] of bnd) {
    if (used.has(u0)) continue;
    const loop = [u0]; used.add(u0);
    let cur = u0;
    for (let g = 0; g < 10000; g++) {
      const nx = (next.get(cur) ?? []).find((v) => !used.has(v) || v === u0);
      if (nx === undefined || nx === u0) break;
      loop.push(nx); used.add(nx); cur = nx;
    }
    if (loop.length >= 3) loops.push(loop.map((k) => pts.get(k)));
  }
  const loopArea = (L) => { let a = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  // the rim triangles' orientation decides which loops are outer ones (same sign) and which are holes
  const outer = loops.filter((L) => Math.sign(loopArea(L)) === Math.sign(tsign));
  const inside = (p, L) => { let c = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) if ((L[i][1] > p[1]) !== (L[j][1] > p[1]) && p[0] < ((L[j][0] - L[i][0]) * (p[1] - L[i][1])) / (L[j][1] - L[i][1]) + L[i][0]) c = !c; return c; };
  const keep = outer.filter((L, i) => !outer.some((M, j) => j !== i && Math.abs(loopArea(M)) > Math.abs(loopArea(L)) && inside(L[0], M)));
  const cap = [];
  for (const L0 of keep) {
    // drop collinear vertices
    let L = L0.slice();
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 0; i < L.length && L.length > 3; i++) {
        const a = L[(i + L.length - 1) % L.length], b = L[i], c = L[(i + 1) % L.length];
        if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-9) { L.splice(i, 1); changed = true; break; }
      }
    }
    for (const [a, b, c] of earClip(L)) { cap.push(L[a][0], ymin, L[a][1], L[b][0], ymin, L[b][1], L[c][0], ymin, L[c][1]); }
  }
  // orient the cap like the rim triangles (normal -y)
  for (let i = 0; i < cap.length; i += 9) {
    const ny = (cap[i + 5] - cap[i + 2]) * (cap[i + 6] - cap[i]) - (cap[i + 3] - cap[i]) * (cap[i + 8] - cap[i + 2]);
    if (ny > 0) for (let k = 0; k < 3; k++) { const a = cap[i + 3 + k], b = cap[i + 6 + k]; cap[i + 3 + k] = b; cap[i + 6 + k] = a; }
  }
  const out = new Float32Array(rest.length * 9);
  rest.forEach((t, i) => out.set(t, i * 9));
  return { tris: out, cap: Float32Array.from(cap), ymin };
}

// ---------------------------------------------------------------------------------------------------- body

/** decimate a triangle soup (game frame) and give it crease-welded normals: { pos, nrm, idx } */
export function simplify(tris, { targetTris = 4, maxCost = 4e-4, crease = 35, borderWeight = 50, lockKeys = null } = {}) {
  if (!tris.length) return { pos: new Float32Array(0), nrm: new Float32Array(0), idx: new Uint32Array(0) };
  const pos = [], idx = [], map = new Map(), lock = [];
  for (let i = 0; i < tris.length; i += 3) {
    const k = key3(tris[i], tris[i + 1], tris[i + 2], 1e-5);
    let id = map.get(k);
    if (id === undefined) { id = pos.length / 3; map.set(k, id); pos.push(tris[i], tris[i + 1], tris[i + 2]); lock.push(lockKeys && lockKeys.has(k) ? 1 : 0); }
    idx.push(id);
  }
  const d = decimate({ pos, idx, lock: lockKeys ? lock : null }, { targetTris, maxCost, crease, borderWeight });
  const n = creaseNormals(d.pos, d.idx, crease);
  return { pos: n.pos, nrm: n.nrm, idx: n.idx, stats: d.stats };
}

/**
 * One LOD of a brick. parts: [{ tris (LDU soup, LDraw frame, studs NOT included), studs: [placements], second }]; rot / shift from the fit.
 * Options: studSides (0 = no studs), maxCost (squared deviation the coplanar / collinear merging may spend), budget (triangles in total, studs included: when the first pass is over it the bodies
 * are decimated further, down to budget, never costing more than budgetCost per collapse), scale / scaleAbout (per-axis fit of the BODY).
 * Returns { pos, nrm, idx, split, tris }: first-colour parts first, then the second-colour parts; the vertex order inside a part is body then studs; split = first-colour vertex count.
 */
export function buildLod(parts, rot, shift, { studSides = 16, maxCost = 4e-4, crease = 35, scale = null, scaleAbout = null, budget = 0, budgetCost = 4e-3 } = {}) {
  const order = [...parts.filter((p) => !p.second), ...parts.filter((p) => p.second)];
  const prep = order.map((p) => {
    const g = toGame(p.tris, rot, shift);
    if (scale) for (let i = 0; i < g.length; i += 3) for (let c = 0; c < 3; c++) g[i + c] = scaleAbout[c] + (g[i + c] - scaleAbout[c]) * scale[c];   // per-axis fit of the BODY to the game's box (studs keep their LDraw positions on the stud grid)
    const studs = !p.second && studSides >= 3 && p.studs?.length ? placeStuds(p.studs, studSides, rot, shift, false, null, scale ? { c: scaleAbout, s: scale } : null) : null;
    let solid = g;
    if (!p.second) {   // panes are thin sheets: nothing to close or prune
      const closed = closeBottom(g);
      const all = new Float32Array(closed.tris.length + closed.cap.length);
      all.set(closed.tris); all.set(closed.cap, closed.tris.length);
      // blockers: the body, the cap and the studs (a face under a stud, inside its footprint, is hidden by it; the stud sits on top of it)
      let blockers = all;
      if (studs) {
        const st = new Float32Array(studs.idx.length * 3);
        for (let i = 0; i < studs.idx.length; i++) { st[i * 3] = studs.pos[studs.idx[i] * 3]; st[i * 3 + 1] = studs.pos[studs.idx[i] * 3 + 1]; st[i * 3 + 2] = studs.pos[studs.idx[i] * 3 + 2]; }
        blockers = new Float32Array(all.length + st.length); blockers.set(all); blockers.set(st, all.length);
      }
      const kept = pruneHiddenCone(closed.tris, new RayGrid(blockers), { maxT: 200 });
      solid = new Float32Array(kept.length + closed.cap.length);
      solid.set(kept); solid.set(closed.cap, kept.length);
    }
    return { p, solid, studs };
  });
  let res = prep.map((x) => simplify(x.solid, { maxCost, crease }));
  if (budget) {
    const studTris = prep.reduce((s, x) => s + (x.studs ? x.studs.idx.length / 3 : 0), 0), body = res.reduce((s, m) => s + m.idx.length / 3, 0);
    if (body + studTris > budget) {
      const room = Math.max(6 * prep.length, budget - studTris);
      res = prep.map((x, i) => simplify(x.solid, { targetTris: Math.max(6, Math.floor((room * res[i].idx.length / 3) / body)), maxCost: budgetCost, crease, borderWeight: 1 }));   // over budget: creases only weigh a little, the cheapest collapses go first
    }
  }
  const pos = [], nrm = [], idx = [];
  let split = 0;
  const add = (a) => { const base = pos.length / 3; for (const v of a.pos) pos.push(v); for (const v of a.nrm) nrm.push(v); for (const i of a.idx) idx.push(i + base); };
  prep.forEach((x, i) => {
    add(res[i]);
    if (x.studs) add(x.studs);
    if (!x.p.second) split = pos.length / 3;
  });
  if (!order.some((p) => p.second)) split = pos.length / 3;
  const raw = prep.reduce((t, x) => t + x.solid.length / 9 + (x.studs ? x.studs.idx.length / 3 : 0), 0);   // triangles before any decimation (hidden faces removed, underside closed)
  return { pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), idx: Uint32Array.from(idx), split, tris: idx.length / 3, raw };
}

/** flatten a part for a LOD: { tris (without studs), studs: [placements] } */
export function flattenPart(lib, part, res) {
  const collect = { re: STUD_RE, out: [] };
  const f = lib.flatten(`${part}.dat`, { res, collect });
  return { tris: f.tris, colors: f.colors, studs: collect.out, info: f.info, infos: f.infos, flat: f };
}

/**
 * Two-colour bricks: which LDraw colour belongs to the game's second colour? Every LDraw colour votes with its triangles: each triangle's centroid (in the game frame) goes to the game's first or
 * second-colour surface, whichever is nearer. Returns { map: Map(colour -> 0 | 1), votes } or null when the game's brick has one colour only.
 */
export function colourClasses(flat, studs, ref, rot, shift, second = null) {
  if (!ref.secondTris?.length || !ref.firstTris?.length) return null;
  if (second) {   // explicit: 'trans' = every transparent LDraw colour (glass), or a list of LDraw colour codes
    const set = second === 'trans' ? TRANS : new Set(second), votes = new Map(), map = new Map();
    for (const c of flat.colors) { if (!map.has(c)) map.set(c, set.has(c) ? 1 : 0); }
    for (const s of studs) if (!map.has(s.col)) map.set(s.col, set.has(s.col) ? 1 : 0);
    if (![...map.values()].includes(1)) return colourClasses(flat, studs, ref, rot, shift, null);   // this part has no such colour (e.g. a frame without its glass): fall back to the vote
    for (const [c, v] of map) votes.set(c, v ? [0, 1] : [1, 0]);
    return { map, votes };
  }
  const g1 = new TriGrid(ref.firstTris), g2 = new TriGrid(ref.secondTris);
  const t = toGame(flat.tris, rot, shift), votes = new Map();
  const vote = (col, p) => { const v = votes.get(col) ?? [0, 0]; v[g2.dist(p) < g1.dist(p) ? 1 : 0]++; votes.set(col, v); };
  for (let i = 0; i < t.length; i += 9) vote(flat.colors[i / 9], [(t[i] + t[i + 3] + t[i + 6]) / 3, (t[i + 1] + t[i + 4] + t[i + 7]) / 3, (t[i + 2] + t[i + 5] + t[i + 8]) / 3]);
  for (const s of studs) vote(s.col, pointToGame(rot, shift, [s.m[9], s.m[10], s.m[11]]));
  const map = new Map();
  for (const [c, v] of votes) map.set(c, v[1] > v[0] ? 1 : 0);
  return { map, votes };
}
/** a flattened part split by the colour classes: [{ tris, studs, second }] (class 0 first) */
export function splitByClass(flat, studs, map, studsFirst = false) {
  const out = [0, 1].map((k) => ({ tris: [], studs: [], second: k === 1 }));
  for (let i = 0; i < flat.tris.length; i += 9) out[map.get(flat.colors[i / 9]) ?? 0].tris.push(...flat.tris.subarray(i, i + 9));
  for (const s of studs) out[studsFirst ? 0 : map.get(s.col) ?? 0].studs.push(s);
  return out.filter((p) => p.tris.length || p.studs.length).map((p) => ({ ...p, tris: Float32Array.from(p.tris) }));
}
