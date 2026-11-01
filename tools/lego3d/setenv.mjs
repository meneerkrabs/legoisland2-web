// Far LODs of the set models: a closed OUTSIDE SHELL (voxelise the visible surface of the bricks, flood-fill the outside, surface nets) of the vehicle, labelled with the game's colour groups, then
// quadric decimation to the triangle count of the game's LOD. Hollow bricks, inner walls, overlapping parts and cracks (the reasons why the bricks' own surface cannot be decimated that far) vanish.
// Groups with a MATL matrix (wheels, rotors, doors) get a shell of their own in their local frame (they move). Builder only (node).
import { envelope } from './pack/chars-gear-env.mjs';
import { TriGrid } from './geomx.mjs';
import { decimate, creaseNormals } from '../../src/mods/lego3d/geom/decimate.ts';
import { edgeReport, signedVolume } from '../../src/mods/lego3d/geom/measure.ts';
import { inv4 } from './setlib.mjs';
import { transformPoint } from '../../src/render/math.ts';

const key3 = (x, y, z, e = 1e-5) => `${Math.round(x / e)},${Math.round(y / e)},${Math.round(z / e)}`;

/** indexed mesh of a soup with one group id per triangle */
function weld(tri, gid) {
  const pos = [], idx = [], map = new Map();
  for (let i = 0; i < tri.length; i += 3) {
    const k = key3(tri[i], tri[i + 1], tri[i + 2], 1e-4);
    let id = map.get(k); if (id === undefined) { id = pos.length / 3; map.set(k, id); pos.push(tri[i], tri[i + 1], tri[i + 2]); }
    idx.push(id);
  }
  // drop degenerate faces
  const ix = [], gr = [];
  for (let t = 0; t < idx.length / 3; t++) { const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2]; if (a === b || b === c || a === c) continue; ix.push(a, b, c); gr.push(gid ? gid[t] : 0); }
  return { pos, idx: ix, group: gr };
}

/**
 * pieces: [{ id (group index), tris (soup, game frame), matrix (MATL or null) }]; the static ones share one shell, every moving one has its own.
 * Returns Map(id -> { pos, nrm, idx, tris }) in the group's own frame.
 */
const isId = (M) => !M || M.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-4);
export function shellGroups(pieces, { voxel, budget, minMoving = 14, crease = 35, maxCost = 1e9, blur = 1, bw = 20, nogroup = true, skipMoving = false, dbg = null, movingBudget = null }) {
  const out = new Map();
  const stat = pieces.filter((p) => isId(p.matrix) && p.tris.length), mov = pieces.filter((p) => !isId(p.matrix) && p.tris.length);
  const nMov = mov.reduce((s, p) => s + (movingBudget?.get(p.id) ?? minMoving), 0);
  const gridOf = new Map(stat.map((p) => [p.id, new TriGrid(p.tris, 0.25)]));
  if (stat.length) {
    const all = Float32Array.from(stat.flatMap((p) => [...p.tris]));
    const env = envelope(all, { voxel, blur });
    // label every shell face by the nearest group surface
    const gid = new Uint32Array(env.tris.length / 9);
    for (let t = 0; t < gid.length; t++) {
      const o = t * 9, c = [(env.tris[o] + env.tris[o + 3] + env.tris[o + 6]) / 3, (env.tris[o + 1] + env.tris[o + 4] + env.tris[o + 7]) / 3, (env.tris[o + 2] + env.tris[o + 5] + env.tris[o + 8]) / 3];
      let best = 1e9, bi = stat[0].id;
      for (const p of stat) { const d = gridOf.get(p.id).dist(c, best); if (d < best) { best = d; bi = p.id; } }
      gid[t] = bi;
    }
    const w = weld(env.tris, gid);
    dbg?.('shell', w.idx.length / 3, JSON.stringify(edgeReport(w.pos, w.idx)), 'vol', signedVolume(w.pos, w.idx).toFixed(2));
    // pass 1: coplanar / collinear merges only (cost ~ 0), pass 2: down to the budget
    const d0 = decimate({ pos: w.pos, idx: w.idx, group: nogroup ? null : w.group }, { targetTris: 8, maxCost: 2e-4, crease, borderWeight: bw });
    dbg?.('merged', d0.idx.length / 3);
    const d = decimate({ pos: d0.pos, idx: d0.idx, group: nogroup ? null : d0.group }, { targetTris: Math.max(8, budget - nMov), maxCost, crease, borderWeight: bw });
    dbg?.('decimated', d.idx.length / 3, JSON.stringify(edgeReport(d.pos, d.idx)), 'vol', signedVolume(d.pos, d.idx).toFixed(2), JSON.stringify(d.stats));
    let dgroup = d.group;
    if (nogroup) {   // labels after the decimation: every face takes the group whose surface is nearest to its centroid
      dgroup = new Uint32Array(d.idx.length / 3);
      for (let t = 0; t < dgroup.length; t++) {
        // 10 sample points over the face (corners, edge midpoints, centroid): each votes for the group whose surface is nearest, the majority wins (a big decimated face has a centroid inside the model)
        const P = [0, 1, 2].map((k) => [d.pos[d.idx[t * 3 + k] * 3], d.pos[d.idx[t * 3 + k] * 3 + 1], d.pos[d.idx[t * 3 + k] * 3 + 2]]);
        const pts = [];
        for (const [u, v] of [[1, 0], [0, 1], [0, 0], [0.5, 0.5], [0.5, 0], [0, 0.5], [0.34, 0.33], [0.7, 0.15], [0.15, 0.7], [0.25, 0.25]]) pts.push([0, 1, 2].map((c) => P[0][c] * (1 - u - v) + P[1][c] * u + P[2][c] * v));
        const votes = new Map();
        for (const c of pts) {
          let best = 1e9, bi = stat[0].id;
          for (const p of stat) { const dd = gridOf.get(p.id).dist(c, best); if (dd < best) { best = dd; bi = p.id; } }
          votes.set(bi, (votes.get(bi) ?? 0) + 1);
        }
        let bv = -1, bg = stat[0].id;
        for (const [g, n] of votes) if (n > bv) { bv = n; bg = g; }
        dgroup[t] = bg;
      }
    }
    for (const p of stat) {
      const idx = [];
      for (let t = 0; t < dgroup.length; t++) if (dgroup[t] === p.id) idx.push(d.idx[t * 3], d.idx[t * 3 + 1], d.idx[t * 3 + 2]);
      if (!idx.length) continue;
      const n = creaseNormals(d.pos, idx, crease);
      out.set(p.id, { pos: n.pos, nrm: n.nrm, idx: n.idx, tris: n.idx.length / 3 });
    }
  }
  for (const p of skipMoving ? [] : mov) {
    const iv = inv4(p.matrix), loc = new Float32Array(p.tris.length);
    for (let i = 0; i < loc.length; i += 3) loc.set(transformPoint(iv, [p.tris[i], p.tris[i + 1], p.tris[i + 2]]), i);
    const env = envelope(loc, { voxel: voxel * 0.8, blur });
    if (!env.tris.length) continue;
    const w = weld(env.tris, null);
    const d = decimate({ pos: w.pos, idx: w.idx }, { targetTris: movingBudget?.get(p.id) ?? minMoving, maxCost, crease, borderWeight: 20 });
    const n = creaseNormals(d.pos, d.idx, crease);
    out.set(p.id, { pos: n.pos, nrm: n.nrm, idx: n.idx, tris: n.idx.length / 3 });
  }
  return out;
}
