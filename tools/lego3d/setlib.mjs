// Set models (LDraw OMR) -> game vehicle meshes, by measurement (docs/re/lego3d.md section 3.3). Node only; reads the player's game files to MEASURE (fits, which brick belongs to which group), the output is
// LDraw-derived geometry per game group.
//
//  omr instances   the set's model is a tree of sub-models and parts; every PART instance (part number, colour, world matrix) is kept: the game's groups are colour groups of exactly these bricks
//  fit             p_game = rot * (-S * p_ldraw) + shift, S = 0.04 (the game's models are the sets at 0.04), rotation (24 candidates) and shift by truncated chamfer against the game's LOD 0
//  groups          every instance goes to the game group (of the LOD mesh being replaced) whose surface (MATL applied) is nearest to it (votes of area samples); instances nowhere near the game's
//                  model (stretcher, minifigures, the set's extras) are left out; tiny planar groups (decals) and placeholder groups (1-3 triangles: carriers of a MATL translation) stay the game's
//  lod             hidden faces removed (cone visibility against the whole model), per group decimated to the budget, groups with a MATL matrix are re-expressed in their local frame (wheels, rotors, doors)
import fs from 'node:fs';
import path from 'node:path';
import { LDrawLib, splitMpd } from './ldraw.mjs';
import { LDRAW } from './lib.mjs';
import { bboxPts, rotations24, applyRot } from './geom.mjs';
import { TriGrid, areaSample, RayGrid, pruneHiddenCone } from './geomx.mjs';
import { groupMatrices } from '../../src/formats/msh.ts';
import { decimate, creaseNormals } from '../../src/mods/lego3d/geom/decimate.ts';
import { transformPoint } from '../../src/render/math.ts';
import { simplify, STUD_RE, placeStuds, key3, closeBottom } from './brickmesh.mjs';
import { shellGroups } from './setenv.mjs';

export const S = 0.04;

// ---------------------------------------------------------------------------------------------------- OMR instances

/** loads set `setId` (OMR .mpd): { lib, main (file name), instances: [{ id, part, col, M (9 rotation rows + 3 translation, LDraw world), path }] } */
export function loadOmr(setId, { skipFiles = /minifig|stretcher/i, entry = null } = {}) {
  const omr = path.join(LDRAW, 'omr');
  const mpd = fs.readdirSync(omr).find((f) => f.startsWith(`${setId}-`) && f.endsWith('.mpd'));
  if (!mpd) throw new Error(`no OMR model for ${setId}`);
  const dir = path.join(omr, `${setId}-1`);
  const main = splitMpd(path.join(omr, mpd), dir);
  const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
  lib.addDir(dir);
  const instances = [];
  const walk = (file, M, col, trail, depth) => {
    const parsed = lib.parse(file);
    parsed.lines.forEach((l, li) => {
      if (l.k !== 1) return;
      const sub = lib.resolve(l.file, 'std');
      if (!sub) return;
      const m = l.m, R = [m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11]], t = [m[0], m[1], m[2]];
      const Rn = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => M[r * 3] * R[c] + M[r * 3 + 1] * R[3 + c] + M[r * 3 + 2] * R[6 + c]));
      const tn = [0, 1, 2].map((r) => M[r * 3] * t[0] + M[r * 3 + 1] * t[1] + M[r * 3 + 2] * t[2] + M[9 + r]);
      const Mn = [...Rn, ...tn], cn = l.col === 16 || l.col === 24 ? col : l.col;
      const isSub = sub.includes(`${path.sep}${setId}-1${path.sep}`) || path.dirname(sub) === dir;
      const name = path.basename(sub);
      if (isSub) { if (!skipFiles.test(name) && depth < 12) walk(sub, Mn, cn, `${trail}/${name}`, depth + 1); }
      else instances.push({ id: instances.length, part: name.replace(/\.dat$/i, ''), col: cn, M: Mn, path: `${trail}#${li}` });
    });
  };
  const start = entry ? fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith(entry.toLowerCase())) : main;   // a sub-model of the set (the vehicle of a multi-model set)
  if (!start) throw new Error(`${setId}: no sub-model ${entry}`);
  walk(path.join(dir, start), [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 16, start, 0);
  return { lib, main, instances, dir };
}

/** flatten one instance in the LDraw world: { tris, colors, studs (placements with the stud primitive names collected) } */
export function instanceGeometry(lib, inst, res = 'std', collectStuds = true) {
  const collect = collectStuds ? { re: STUD_RE, out: [] } : null;
  const f = lib.flatten(`${inst.part}.dat`, { res, matrix: inst.M, color: inst.col, collect: collect ?? undefined });
  return { tris: f.tris, colors: f.colors, studs: collect ? collect.out : [], infos: f.infos };
}

// ---------------------------------------------------------------------------------------------------- the game's mesh

/**
 * A game mesh as groups in WORLD space (the MATL matrix of each group applied): [{ index, tris (soup), nTris, nVerts, flags, matrix (4x4 or null), local (positions as stored), kind }]. kind: 'decal' (<= 8 triangles and planar),
 * 'placeholder' (<= 3 triangles), 'colour' (the rest).
 */
const boxExtent = (a) => { let m = 0; const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < a.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], a[i + c]); hi[c] = Math.max(hi[c], a[i + c]); } for (let c = 0; c < 3; c++) m = Math.max(m, hi[c] - lo[c]); return m; };
export function gameGroups(msh) {
  const gm = groupMatrices(msh);
  return msh.groups.map((g, gi) => {
    const tris = [], local = [];
    for (let i = 0; i < g.indexCount; i++) {
      const v = msh.indices[g.firstIndex + i] + g.firstVertex, p = [msh.positions[v * 3], msh.positions[v * 3 + 1], msh.positions[v * 3 + 2]];
      local.push(...p);
      tris.push(...(gm[gi] ? transformPoint(gm[gi], p) : p));
    }
    const nT = g.indexCount / 3;
    let kind = 'colour';
    if (nT <= 3 && boxExtent(local) < 0.05) kind = 'placeholder';
    if (kind === 'colour' && nT <= 8) {
      // planar? all vertices within 0.02 of the plane of the first triangle
      const t = tris, a = [t[0], t[1], t[2]], b = [t[3], t[4], t[5]], c = [t[6], t[7], t[8]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1;
      let dev = 0;
      for (let i = 0; i < t.length; i += 3) dev = Math.max(dev, Math.abs(((t[i] - a[0]) * n[0] + (t[i + 1] - a[1]) * n[1] + (t[i + 2] - a[2]) * n[2]) / l));
      if (dev < 0.02) kind = 'decal';
    }
    return { index: gi, tris: Float32Array.from(tris), local: Float32Array.from(local), gtom: msh.gtom ? msh.gtom[gi] : null, nTris: nT, nVerts: g.vertexCount, flags: g.flags, matrix: gm[gi], kind };
  });
}

// ---------------------------------------------------------------------------------------------------- fit

export function inv4(m) {
  // general 4x4 inverse (row-vector convention: p' = p * m): Gauss-Jordan
  const a = Array.from({ length: 4 }, (_, r) => [...Array.from({ length: 4 }, (_, c) => m[r * 4 + c]), ...[0, 1, 2, 3].map((k) => (k === r ? 1 : 0))]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('singular matrix');
    for (let k = 0; k < 8; k++) a[c][k] /= d;
    for (let r = 0; r < 4; r++) if (r !== c) { const f = a[r][c]; for (let k = 0; k < 8; k++) a[r][k] -= f * a[c][k]; }
  }
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[r * 4 + c] = a[r][4 + c];
  return out;
}

/** LDraw world soup -> game frame (rot * (-S p) + shift), winding reversed (reflection) */
export function toGameFrame(tris, rot, shift, post = null) {
  const out = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 9) for (let k = 0; k < 3; k++) {
    const p = applyRot(rot, [-tris[i + k * 3] * S, -tris[i + k * 3 + 1] * S, -tris[i + k * 3 + 2] * S]), j = k === 1 ? 2 : k === 2 ? 1 : k;
    out[i + j * 3] = p[0] + shift[0]; out[i + j * 3 + 1] = p[1] + shift[1]; out[i + j * 3 + 2] = p[2] + shift[2];
    if (post) for (let c = 0; c < 3; c++) out[i + j * 3 + c] = post.c[c] + (out[i + j * 3 + c] - post.c[c]) * post.s[c];
  }
  return out;
}

/** truncated symmetric chamfer between two sample sets against their grids */
function truncChamfer(ptsA, gridB, ptsB, gridA, off, trunc = 0.5) {
  let s = 0, n = 0;
  for (let i = 0; i < ptsA.length; i += 3) { s += Math.min(gridB.dist([ptsA[i] + off[0], ptsA[i + 1] + off[1], ptsA[i + 2] + off[2]], trunc), trunc); n++; }
  const a = s / n;
  s = 0; n = 0;
  for (let i = 0; i < ptsB.length; i += 3) { s += Math.min(gridA.dist([ptsB[i] - off[0], ptsB[i + 1] - off[1], ptsB[i + 2] - off[2]], trunc), trunc); n++; }
  return (a + s / n) / 2;
}

/**
 * Rotation + shift of the set model (soup in LDraw units, world) onto the game's LOD 0 surface (soup in game units). Candidates: all 24 rotations whose box is within `slack` of the game's, shift by box centres,
 * then a translation search (coordinate descent, 0.2 -> 0.0125) on the truncated chamfer. Returns { rot, shift, score, size, cands }.
 */
export function fitSet(ldTris, gameTris, { rotations = null, slack = 0.25, samples = 1500 } = {}) {
  const neg = Float32Array.from(ldTris, (v) => -v * S), gb = bboxPts(gameTris), gc = gb.lo.map((l, i) => (l + gb.hi[i]) / 2);
  const gameGrid = new TriGrid(gameTris, 0.25), gamePts = areaSample(gameTris, samples);
  const cands = [];
  for (const sl of [slack, 9]) {   // a model whose rotor / wings lie otherwise than the game's has no rotation with a similar box: then the chamfer alone decides
    for (const rot of rotations ?? rotations24()) {
      const r = new Float32Array(neg.length);
      for (let i = 0; i < neg.length; i += 3) r.set(applyRot(rot, [neg[i], neg[i + 1], neg[i + 2]]), i);
      const b = bboxPts(r);
      if (b.size.some((v, i) => Math.abs(v - gb.size[i]) > sl * gb.size[i] + 0.4)) continue;
      const c = b.lo.map((l, i) => (l + b.hi[i]) / 2);
      cands.push({ rot, r, b, shift: [gc[0] - c[0], gc[1] - c[1], gc[2] - c[2]] });
    }
    if (cands.length) break;
  }
  let best = null;
  for (const c of cands) {
    // the model as triangles (game frame, before the shift): soup built once, grid in its own frame, shifts applied to the query points
    const soup = new Float32Array(c.r.length);
    for (let i = 0; i < c.r.length; i += 9) for (let k = 0; k < 3; k++) { const j = k === 1 ? 2 : k === 2 ? 1 : k; soup.set(c.r.subarray(i + k * 3, i + k * 3 + 3), i + j * 3); }
    const grid = new TriGrid(soup, 0.25), pts = areaSample(soup, samples);
    let off = [...c.shift], cur = truncChamfer(pts, gameGrid, gamePts, grid, off);
    for (const step of [0.2, 0.1, 0.05, 0.025, 0.0125]) {
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (let ax = 0; ax < 3; ax++) for (const sgn of [-1, 1]) {
          const o2 = [...off]; o2[ax] += sgn * step;
          const sc = truncChamfer(pts, gameGrid, gamePts, grid, o2);
          if (sc < cur - 1e-6) { cur = sc; off = o2; moved = true; }
        }
        if (!moved) break;
      }
    }
    c.score = cur; c.shiftFit = off;
    if (!best || cur < best.score) best = c;
  }
  if (!best) return null;
  return { rot: best.rot, shift: best.shiftFit, score: best.score, size: best.b.size, cands: cands.map((c) => ({ rot: c.rot.join(','), score: +c.score.toFixed(3) })).sort((a, b) => a.score - b.score).slice(0, 4) };
}

/**
 * Per-axis (or uniform) stretch of the set model about its centre, after fitSet, for the models the game made at another scale or proportion (the z22BIP seaplane 1.34x, the tender): coordinate descent on
 * the truncated chamfer to the game's LOD 0. Returns { c, s } (apply after rot + shift: p' = c + (p - c) * s) and the chamfer before / after.
 */
export function refineScale(ldTris, fit, gameTris, { uniform = false, samples = 1500, range = [0.6, 1.8] } = {}) {
  const base = toGameFrame(ldTris, fit.rot, fit.shift), b = bboxPts(base), c = b.lo.map((l, i) => (l + b.hi[i]) / 2);
  const gb = bboxPts(gameTris), gameGrid = new TriGrid(gameTris, 0.25), gamePts = areaSample(gameTris, samples), pts0 = areaSample(base, samples);
  const apply = (a, s) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) o[i + k] = c[k] + (a[i + k] - c[k]) * s[k]; return o; };
  const score = (s) => {
    const soup = apply(base, s), grid = new TriGrid(soup, 0.25), pts = apply(pts0, s);
    return truncChamfer(pts, gameGrid, gamePts, grid, [0, 0, 0]);
  };
  // start: the box ratio per axis (uniform: the mean)
  let s = [0, 1, 2].map((k) => Math.min(range[1], Math.max(range[0], gb.size[k] / b.size[k])));
  if (uniform) { const m = Math.cbrt(s[0] * s[1] * s[2]); s = [m, m, m]; }
  const s0 = score([1, 1, 1]);
  let cur = score(s);
  for (const step of [0.08, 0.04, 0.02, 0.01]) for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    const dirs = uniform ? [[1, 1, 1]] : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (const d of dirs) for (const sg of [-1, 1]) {
      const t = s.map((v, k) => Math.min(range[1], Math.max(range[0], v + sg * step * (d[k] ? v : 0))));
      const sc = score(t);
      if (sc < cur - 1e-6) { cur = sc; s = t; moved = true; }
    }
    if (!moved) break;
  }
  return { c, s, before: s0, after: cur };
}

// ---------------------------------------------------------------------------------------------------- group assignment

/**
 * Which game group does each instance belong to? `geoms`: per instance { tris (game frame) }; `groups`: gameGroups() of the LOD mesh being replaced. Votes: area samples of the instance, each to the nearest
 * group of kind 'colour'. Returns [{ instance, group (index or -1), dist (mean distance to that group), share (vote share) }].
 */
export function assignInstances(geoms, groups, { maxDist = 0.35, samples = 24 } = {}) {
  const cg = groups.filter((g) => g.kind === 'colour' && g.tris.length);
  const grids = cg.map((g) => new TriGrid(g.tris, 0.25));
  return geoms.map((g, ii) => {
    if (!g.tris.length) return { instance: ii, group: -1, dist: 9, share: 0 };
    const pts = areaSample(g.tris, Math.min(samples, Math.max(6, g.tris.length / 9)));
    const votes = new Array(cg.length).fill(0), dsum = new Array(cg.length).fill(0);
    for (let i = 0; i < pts.length; i += 3) {
      let best = -1, bd = 1e9;
      grids.forEach((gr, k) => { const d = gr.dist([pts[i], pts[i + 1], pts[i + 2]], bd); if (d < bd) { bd = d; best = k; } });
      if (best >= 0) { votes[best]++; dsum[best] += bd; }
    }
    let k = 0;
    for (let i = 1; i < cg.length; i++) if (votes[i] > votes[k]) k = i;
    const n = pts.length / 3, dist = votes[k] ? dsum[k] / votes[k] : 9;
    return { instance: ii, group: dist <= maxDist ? cg[k].index : -1, dist, share: votes[k] / n };
  });
}

// ---------------------------------------------------------------------------------------------------- building one game mesh from the set

/** the set's instances flattened once per resolution (LDraw world frame) */
export function prepareSet(om, res) {
  return om.instances.map((i) => ({ inst: i, ...instanceGeometry(om.lib, i, res, true) }));
}

/** inverse-transforms game-frame vertices of a group into its local frame (MATL matrix of the group): positions by inv(M), normals by the rotation part of inv(M) */
export function toLocal(M, pos, nrm) {
  if (!M) return { pos, nrm };
  const iv = inv4(M), p = new Float32Array(pos.length), n = new Float32Array(nrm.length);
  for (let i = 0; i < pos.length; i += 3) p.set(transformPoint(iv, [pos[i], pos[i + 1], pos[i + 2]]), i);
  for (let i = 0; i < nrm.length; i += 3) {
    const x = nrm[i], y = nrm[i + 1], z = nrm[i + 2];
    const v = [x * iv[0] + y * iv[4] + z * iv[8], x * iv[1] + y * iv[5] + z * iv[9], x * iv[2] + y * iv[6] + z * iv[10]], l = Math.hypot(...v) || 1;
    n.set([v[0] / l, v[1] / l, v[2] / l], i);
  }
  return { pos: p, nrm: n };
}

/** a triangle soup (game frame) from an indexed mesh */
export const soupOf = (m) => { const o = new Float32Array(m.idx.length * 3); for (let i = 0; i < m.idx.length; i++) { o[i * 3] = m.pos[m.idx[i] * 3]; o[i * 3 + 1] = m.pos[m.idx[i] * 3 + 1]; o[i * 3 + 2] = m.pos[m.idx[i] * 3 + 2]; } return o; };

/**
 * The visible part of every brick of the set, in the game frame: each instance's triangles that some ray (the face normal and 6 tilted ones, from the centroid and three corners) can leave the whole model
 * through. This is the expensive step (a ray grid over the full-detail model), done once per (set, resolution, fit) and shared by every game mesh. Returns [{ tris (soup), full (triangle count before) }].
 */
export function pruneInstances(prepared, fit, { skip = null } = {}) {
  // the hollow underside of bricks and plates (tubes, anti-studs) is closed by a flat cap over the outer loop of the rim, like the game's own solid bricks: seen from a low camera the plate is flat,
  // and the hollow behind the cap counts as hidden
  const full = prepared.map((p) => { const g = toGameFrame(p.tris, fit.rot, fit.shift, fit.post); if (!g.length) return g; const c = closeBottom(g); if (!c.cap.length) return g; const o = new Float32Array(c.tris.length + c.cap.length); o.set(c.tris); o.set(c.cap, c.tris.length); return o; });
  let n = 0;
  for (const t of full) n += t.length;
  const all = new Float32Array(n);
  let o = 0;
  for (const t of full) { all.set(t, o); o += t.length; }
  const grid = new RayGrid(all);
  return full.map((t) => {
    // blocky or round? the area of the faces on the 8 most common normal directions (cells of 0.125) as a share of all: bricks, plates and slopes ~ 90 %, tubes, tyres, handlebars, antennas < 60 %.
    // Round bricks are not merged with their neighbours by the group's decimation (a thin tube would collapse): they are decimated alone, with a cost relative to their own size.
    const cells = new Map();
    let A = 0, V = 0;
    for (let i = 0; i < t.length; i += 9) {
      const ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2], vx = t[i + 6] - t[i], vy = t[i + 7] - t[i + 1], vz = t[i + 8] - t[i + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
      if (l < 1e-12) continue;
      V += (t[i] * (t[i + 4] * t[i + 8] - t[i + 5] * t[i + 7]) + t[i + 1] * (t[i + 5] * t[i + 6] - t[i + 3] * t[i + 8]) + t[i + 2] * (t[i + 3] * t[i + 7] - t[i + 4] * t[i + 6])) / 6;
      const k = `${Math.round((nx / l) * 8)},${Math.round((ny / l) * 8)},${Math.round((nz / l) * 8)}`;
      cells.set(k, (cells.get(k) ?? 0) + l / 2); A += l / 2;
    }
    const top = [...cells.values()].sort((x, y) => y - x).slice(0, 8).reduce((x, y) => x + y, 0);
    const blocky = A ? top / A >= 0.75 : true;
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let i = 0; i < t.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], t[i + c]); hi[c] = Math.max(hi[c], t[i + c]); }
    const ext = [0, 1, 2].map((c) => hi[c] - lo[c]).sort((x, y) => x - y);
    return { tris: t.length ? pruneHiddenCone(t, grid, { maxT: 60 }) : t, full: t.length / 9, blocky, ext, fat: ext[0] * ext[1] * ext[2] > 0 ? Math.abs(V) / (ext[0] * ext[1] * ext[2]) : 0 };
  });
}

/**
 * Builds the replacement groups of one game mesh. `pruned` = pruneInstances(); opts: { studs (max sides of a stud prism, 0 = none), budget (triangles in total), instCost (squared deviation each brick's visible surface
 * may spend), maxDist (an instance further than this from every colour group of the mesh is not part of the game's model) }.
 * Returns { groups: [{ kind: 'g' | 'keep', index, pos, nrm, idx (u16 range, relative), assigned, tris, gkind }], report }.
 */
export function buildMeshGroups(om, prepared, fit, msh, opts = {}) {
  const pruned = opts.pruned;
  const groups = gameGroups(msh);
  const asg = assignInstances(pruned.map((p, i) => ({ tris: p.tris.length ? p.tris : prepared[i] && new Float32Array(0) })), groups, { maxDist: opts.maxDist ?? 0.35 });
  const per = new Map();   // group index -> { insts }
  asg.forEach((a, i) => { if (a.group >= 0 && opts.keepGroups?.has(a.group)) a.group = -1; if (a.group < 0) return; if (!per.has(a.group)) per.set(a.group, { insts: [] }); per.get(a.group).insts.push(i); });
  const origTris = msh.indices.length / 3, budget = opts.budget ?? Math.round(origTris * 1.0);
  const studSidesMax = opts.studs ?? 0;
  // studs: only those that can be seen (a ray from the stud top along its axis is not blocked by another part), the sides by what the budget allows (at most 45 % of it)
  const assignedTris = [];
  for (const info of per.values()) for (const i of info.insts) assignedTris.push(pruned[i].tris);
  const blockGrid = studSidesMax ? new RayGrid(Float32Array.from(assignedTris.flatMap((t) => [...t]))) : null;
  const visibleStuds = new Map();
  let studCount = 0;
  for (const [g, info] of per) {
    const list = [];
    for (const i of info.insts) for (const pl of prepared[i].studs) {
      if (!blockGrid) break;
      const M = pl.m, pt = (y) => { const q = [M[1] * y + M[9], M[4] * y + M[10], M[7] * y + M[11]]; const gp = applyRot(fit.rot, [-q[0] * S, -q[1] * S, -q[2] * S]); const r = [gp[0] + fit.shift[0], gp[1] + fit.shift[1], gp[2] + fit.shift[2]]; return fit.post ? r.map((v, c) => fit.post.c[c] + (v - fit.post.c[c]) * fit.post.s[c]) : r; };
      const top = pt(-4), base = pt(0), d = [top[0] - base[0], top[1] - base[1], top[2] - base[2]], l = Math.hypot(...d) || 1;
      const dn = [d[0] / l, d[1] / l, d[2] / l];
      if (!blockGrid.blocked([top[0] + dn[0] * 0.02, top[1] + dn[1] * 0.02, top[2] + dn[2] * 0.02], dn, 1.5)) list.push(pl);
    }
    visibleStuds.set(g, list);
    studCount += list.length;
  }
  let studSides = 0;
  for (const n of [12, 8, 6, 4]) if (n <= studSidesMax && studCount * (n * 3 - 2) <= budget * 0.45) { studSides = n; break; }
  const bodyBudget = budget - studCount * (studSides ? studSides * 3 - 2 : 0);
  // every brick's visible surface decimated on its own (an open patch of one manifold part), then the groups are the unions
  const bodies = new Map(), locks = new Map();
  let bodyTotal = 0;
  for (const [g, info] of per) {
    const parts = [], lockKeys = new Set();
    for (const i of info.insts) {
      const t = pruned[i].tris;
      if (!t.length) continue;
      // round bricks (tubes, tyres, handlebars) and tiny ones keep their shape: decimated alone (cost relative to their size), their vertices locked in the group's decimation
      const ex = pruned[i].ext;
      if (!pruned[i].blocky || ex[2] < 0.6) {
        // round or tiny bricks are decimated alone and their vertices locked in the group's decimation (merged with a neighbour the quadric turns a thin tube into shards): fat ones (tyres, rims, domes:
        // volume / box >= 0.3) with a cost relative to their size, thin ones (tubes, handlebars, bars, clips) not at all
        let sm = t;
        if (pruned[i].fat >= 0.3 && ex[0] >= 0.3) sm = soupOf(simplify(t, { maxCost: Math.min(opts.maxCost ?? 2e-2, (0.06 * ex[1]) ** 2) }));
        for (let k = 0; k < sm.length; k += 3) lockKeys.add(key3(sm[k], sm[k + 1], sm[k + 2], 1e-5));
        parts.push(sm);
        continue;
      }
      parts.push(t);
    }
    const body = Float32Array.from(parts.flatMap((t) => [...t]));
    bodies.set(g, body); locks.set(g, lockKeys);
    bodyTotal += body.length / 9;
  }
  const out = [];
  const report = { origTris, budget, studSides, studCount, bodyTotal, groups: [] };
  // far LODs that the per-brick decimation cannot bring down (opts.farShell = { target, maxCost }): the static groups become a closed outside shell of the whole model (voxelised visible surface, flood-
  // filled outside, surface nets), faces labelled by the game's groups, quadric-decimated to the target; moving groups (wheels, rotors) go the normal way
  let shell = null;
  if (opts.farShell) {
    const pieces = [];
    for (const [g] of per) if (isIdentity(groups[g].matrix)) pieces.push({ id: g, tris: bodies.get(g), matrix: null });
    const all = boxOf(Float32Array.from(pieces.flatMap((p) => [...p.tris])));
    const voxel = Math.max(0.06, Math.min(0.2, Math.hypot(...all.size) / 150));
    const nWheels = groups.filter((g) => !isIdentity(g.matrix) && per.has(g.index)).reduce((s, g) => s + Math.max(96, g.nTris * 3), 0);
    shell = shellGroups(pieces, { voxel, budget: Math.max(60, opts.farShell.target - nWheels), maxCost: opts.farShell.maxCost, skipMoving: true, nogroup: true });
    report.shellVoxel = voxel;
  }
  for (const gr of groups) {
    const info = per.get(gr.index), body = bodies.get(gr.index);
    if (shell && isIdentity(gr.matrix) && info && body?.length) {
      const sh = shell.get(gr.index);
      if (!sh) { out.push({ kind: 'keep', index: gr.index, gkind: gr.kind }); report.groups.push({ g: gr.index, kind: 'keep', why: 'no shell faces' }); continue; }
      out.push({ kind: 'g', index: gr.index, pos: sh.pos, nrm: sh.nrm, idx: sh.idx, assigned: info.insts, tris: sh.tris, gkind: gr.kind });
      report.groups.push({ g: gr.index, kind: 'g', orig: gr.nTris, tris: sh.tris, inst: info.insts.length, shell: true });
      continue;
    }
    if (!info || !body?.length) { out.push({ kind: 'keep', index: gr.index, gkind: gr.kind }); report.groups.push({ g: gr.index, kind: 'keep', why: gr.kind === 'colour' ? 'nothing assigned' : gr.kind }); continue; }
    // welds the instances' common vertices, merges the cuts the pruning left (collinear / coplanar) and decimates the group to its share of the budget (creases weigh little: the union of bricks has
    // open patch borders everywhere, they must be allowed to move)
    const share = body.length / 9 / bodyTotal, target = Math.max(8, Math.floor(bodyBudget * share));
    const lockKeys = locks.get(gr.index);
    let m = simplify(body, { maxCost: 4e-4, lockKeys });
    if (m.idx.length / 3 > target) m = simplify(body, { targetTris: target, maxCost: opts.maxCost ?? 2e-2, borderWeight: 2, lockKeys });
    let pos = Array.from(m.pos), nrm = Array.from(m.nrm), idx = Array.from(m.idx);
    if (studSides) {
      const pl = visibleStuds.get(gr.index) ?? [];
      if (pl.length) {
        const st = placeStuds(pl, studSides, fit.rot, fit.shift, false, fit.post);
        const base = pos.length / 3;
        for (const v of st.pos) pos.push(v); for (const v of st.nrm) nrm.push(v); for (const k of st.idx) idx.push(k + base);
      }
    }
    const loc = toLocal(gr.matrix, Float32Array.from(pos), Float32Array.from(nrm));
    out.push({ kind: 'g', index: gr.index, pos: loc.pos, nrm: loc.nrm, idx: Uint32Array.from(idx), assigned: info.insts, tris: idx.length / 3, gkind: gr.kind });
    report.groups.push({ g: gr.index, kind: 'g', orig: gr.nTris, tris: idx.length / 3, inst: info.insts.length });
  }
  fitMovingParts(out, groups, pruned, report, opts);
  report.assignment = asg;
  report.total = out.reduce((s, g) => s + (g.tris ?? 0), 0);
  return { groups: out, report };
}

const isIdentity = (M) => !M || M.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-4);
const boxOf = (a) => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < a.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], a[i + c]); hi[c] = Math.max(hi[c], a[i + c]); } return { lo, hi, size: [0, 1, 2].map((c) => hi[c] - lo[c]), ctr: [0, 1, 2].map((c) => (lo[c] + hi[c]) / 2) }; };
const FIT_RANGE = [0.6, 2.2];

/**
 * The parts the game moves (MATL matrix != identity: wheels, rotors, doors) are modelled around their own origin = the axle / hinge. The set's part sits somewhere near it after the global fit; here each part
 * is re-fitted per axis onto the box of the game's own part (the game's chunky tyres, the game's rotor span): translation to the game's box centre, scale where the ratio is within FIT_RANGE.
 * Wheels (a round part: two equal long axes) are rebuilt as a closed outside shell of the set's wheel (tread teeth, hollow insides gone), a few dozen triangles per ring.
 */
function fitMovingParts(out, groups, pruned, report, opts) {
  const byPart = new Map();
  for (const o of out) {
    if (o.kind !== 'g') continue;
    const gr = groups[o.index];
    if (isIdentity(gr.matrix) || !(gr.local?.length)) continue;
    const k = gr.gtom ?? -1;
    if (!byPart.has(k)) byPart.set(k, []);
    byPart.get(k).push(o);
  }
  for (const [part, list] of byPart) {
    const gbox = boxOf(Float32Array.from(list.flatMap((o) => [...groups[o.index].local])));
    const M = groups[list[0].index].matrix, iv = inv4(M);
    // the set's part in its local frame (visible faces of the assigned bricks)
    const setSoup = list.map((o) => {
      const t = Float32Array.from(o.assigned.flatMap((i) => [...pruned[i].tris])), l = new Float32Array(t.length);
      for (let i = 0; i < t.length; i += 3) l.set(transformPoint(iv, [t[i], t[i + 1], t[i + 2]]), i);
      return l;
    });
    const sbox = boxOf(Float32Array.from(setSoup.flatMap((t) => [...t])));
    const sc = [1, 1, 1], tr = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const r = sbox.size[c] > 0.05 ? gbox.size[c] / sbox.size[c] : 1;
      if (r >= FIT_RANGE[0] && r <= FIT_RANGE[1]) sc[c] = r;
      const d = gbox.ctr[c] - sbox.ctr[c] * sc[c];
      if (Math.abs(d) < 1.5) tr[c] = d;
    }
    const map = (a) => { const b = new Float32Array(a.length); for (let i = 0; i < a.length; i += 3) for (let c = 0; c < 3; c++) b[i + c] = a[i + c] * sc[c] + tr[c]; return b; };
    const gs = [...gbox.size].sort((a, b) => a - b), wheel = gs[2] > 0.5 && gs[1] / gs[2] > 0.85 && gs[0] >= 0.25 * gs[2] && gs[0] <= 0.8 * gs[2];
    // a wheel: ONE lathe body (the tyre profile of the set's wheel revolved round the axle, outer silhouette per axial slice) in the group of the game's biggest part (the tyre); the game's hub groups stay
    // the player's own (a flat disc with the game's spoke picture): treads, hollow insides and spokes of the LDraw wheel (hundreds of triangles that shatter when decimated) are gone
    let tyre = -1;
    if (wheel) {
      const axis = gbox.size.indexOf(Math.min(...gbox.size)), A = [0, 1, 2].filter((k) => k !== axis);
      const pts = areaSample(Float32Array.from(setSoup.flatMap((t) => [...map(t)])), 4000);
      const sides = 20, bins = 12, lo = gbox.lo[axis], hi = gbox.hi[axis], rmax = new Float32Array(bins);
      for (let i = 0; i < pts.length; i += 3) {
        const bi = Math.min(bins - 1, Math.max(0, Math.floor(((pts[i + axis] - lo) / (hi - lo)) * bins))), r = Math.hypot(pts[i + A[0]] - gbox.ctr[A[0]], pts[i + A[1]] - gbox.ctr[A[1]]);
        if (r > rmax[bi]) rmax[bi] = r;
      }
      if (process.env.WHEEL_DEBUG) console.log('wheel part', part, 'axis', axis, 'gbox', gbox.size.map((v) => v.toFixed(2)).join('x'), 'rmax', Array.from(rmax).map((v) => v.toFixed(2)).join(' '));
      // the game's radius is the ceiling (the set's wheel was fitted to it); empty slices take their neighbours
      const R = Math.max(gbox.size[A[0]], gbox.size[A[1]]) / 2;
      let prev = R;
      const prof = [];
      for (let q = 0; q < bins; q++) { const r = rmax[q] > 0.05 ? Math.min(R * 1.02, rmax[q]) : prev; prev = r; prof.push([lo + ((q + 0.5) / bins) * (hi - lo), r]); }
      // simplify the profile: drop points that lie within 0.04 of the line between their neighbours
      const keep = prof.map((_, i) => i);
      for (let pass = 0; pass < 8; pass++) for (let i = 1; i < keep.length - 1; i++) { const a0 = prof[keep[i - 1]], b0 = prof[keep[i]], c0 = prof[keep[i + 1]], t = (b0[0] - a0[0]) / (c0[0] - a0[0] || 1); if (Math.abs(b0[1] - (a0[1] + (c0[1] - a0[1]) * t)) < 0.04) { keep.splice(i, 1); i--; } }
      const dd = Math.min(0.04, (hi - lo) * 0.08);   // the caps sit a little inside: the game's flat hub disc (a picture) stays in front of them
      const P = [[lo + dd, 0], [lo + dd + 1e-3, prof[0][1]], ...keep.map((i) => prof[i]), [hi - dd - 1e-3, prof[prof.length - 1][1]], [hi - dd, 0]];
      // revolve: ring j at P[j] (axial, radius); first / last ring radius 0 = the cap centres
      const pos = [], idx = [];
      const ring = (ax, r, k) => { const c = Math.cos((k / sides) * 2 * Math.PI), sn = Math.sin((k / sides) * 2 * Math.PI), v = [0, 0, 0]; v[axis] = ax; v[A[0]] = gbox.ctr[A[0]] + r * c; v[A[1]] = gbox.ctr[A[1]] + r * sn; return v; };
      const id = [];
      for (let j = 0; j < P.length; j++) { id.push(pos.length / 3); if (P[j][1] === 0) pos.push(...ring(P[j][0], 0, 0)); else for (let k = 0; k < sides; k++) pos.push(...ring(P[j][0], P[j][1], k)); }
      const at = (j, k) => (P[j][1] === 0 ? id[j] : id[j] + (k % sides));
      for (let j = 0; j < P.length - 1; j++) for (let k = 0; k < sides; k++) {
        const a0 = at(j, k), a1 = at(j, k + 1), b0 = at(j + 1, k), b1 = at(j + 1, k + 1);
        if (a0 !== a1) idx.push(a0, a1, b1);
        if (b0 !== b1) idx.push(a0, b1, b0);
      }
      // outward winding of the game: checked by the signed volume below (flipped when negative)
      let vol = 0;
      for (let t = 0; t < idx.length; t += 3) { const a0 = idx[t] * 3, b0 = idx[t + 1] * 3, c0 = idx[t + 2] * 3; vol += (pos[a0] * (pos[b0 + 1] * pos[c0 + 2] - pos[b0 + 2] * pos[c0 + 1]) - pos[a0 + 1] * (pos[b0] * pos[c0 + 2] - pos[b0 + 2] * pos[c0]) + pos[a0 + 2] * (pos[b0] * pos[c0 + 1] - pos[b0 + 1] * pos[c0])) / 6; }
      // the game's outward triangles have (b - a) x (c - a) along the outward normal = a POSITIVE signed volume about an interior point (the wheel's centre)
      const cx = gbox.ctr; vol = 0;
      for (let t = 0; t < idx.length; t += 3) { const q = [0, 1, 2].map((k) => [pos[idx[t + k] * 3] - cx[0], pos[idx[t + k] * 3 + 1] - cx[1], pos[idx[t + k] * 3 + 2] - cx[2]]); vol += (q[0][0] * (q[1][1] * q[2][2] - q[1][2] * q[2][1]) - q[0][1] * (q[1][0] * q[2][2] - q[1][2] * q[2][0]) + q[0][2] * (q[1][0] * q[2][1] - q[1][1] * q[2][0])) / 6; }
      if (vol < 0) for (let t = 0; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
      const n = creaseNormals(pos, idx, 35);
      tyre = list.reduce((bi, o, i) => (groups[o.index].nTris > groups[list[bi].index].nTris ? i : bi), 0);
      list[tyre].pos = n.pos; list[tyre].nrm = n.nrm; list[tyre].idx = n.idx; list[tyre].tris = n.idx.length / 3; list[tyre].shell = true;
    }
    list.forEach((o, li) => {
      if (wheel) {
        if (li !== tyre) { o.kind = 'keep'; o.gkind = groups[o.index].kind; delete o.pos; delete o.nrm; delete o.idx; o.tris = 0; }
      } else {
        const p = map(o.pos), n = new Float32Array(o.nrm.length);
        for (let i = 0; i < n.length; i += 3) { const v = [o.nrm[i] / sc[0], o.nrm[i + 1] / sc[1], o.nrm[i + 2] / sc[2]], l = Math.hypot(...v) || 1; n[i] = v[0] / l; n[i + 1] = v[1] / l; n[i + 2] = v[2] / l; }
        o.pos = p; o.nrm = n;
      }
      o.fit = { part, sc, tr, wheel };
    });
    (report.parts ??= []).push({ part, scale: sc.map((v) => +v.toFixed(2)), shift: tr.map((v) => +v.toFixed(2)), wheel, groups: list.map((o) => o.index), tris: list.map((o) => o.tris) });
  }
}
function weldSoup(t) {
  const pos = [], idx = [], map = new Map();
  for (let i = 0; i < t.length; i += 3) { const k = key3(t[i], t[i + 1], t[i + 2], 1e-4); let id = map.get(k); if (id === undefined) { id = pos.length / 3; map.set(k, id); pos.push(t[i], t[i + 1], t[i + 2]); } idx.push(id); }
  const ix = [];
  for (let q = 0; q < idx.length; q += 3) if (idx[q] !== idx[q + 1] && idx[q + 1] !== idx[q + 2] && idx[q] !== idx[q + 2]) ix.push(idx[q], idx[q + 1], idx[q + 2]);
  return { pos, idx: ix };
}
