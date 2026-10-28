import { extractTriangles } from '../../src/formats/col.ts';
import { ColObject, CollisionWorld } from '../../src/game/collision.ts';
import { GameRecord } from '../../src/game/record.ts';
import { loadZone } from '../lib/engine-load.mjs';

// Collision queries (src/game/collision.ts = FUN_00441270 / FUN_00441b10 / FUN_0043cd62) against the real .col data of the island:
//  * ground height (terrain ray: radius 1.0, skin 0.1, mask 3) against a brute-force triangle raycast of the land mesh
//  * no tunnelling: every segment that crosses a land triangle is reported (with the skin the hit comes at or before the geometric crossing)
//  * the grid walk gives the same result as testing every polygon
//  * box shapes (trees), probe mode, surface ids

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** Moeller-Trumbore, segment p + t d, t in [0,1] */
function segTri(p, d, a, b, c) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
  if (Math.abs(det) < 1e-12) return -1;
  const f = 1 / det, s = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
  if (u < 0 || u > 1) return -1;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const v = f * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]);
  if (v < 0 || u + v > 1) return -1;
  const t = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
  return t >= 0 && t <= 1 ? t : -1;
}

export default {
  name: 'engine-collision',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const L = loadZone(ctx, 'z02LGI');
    const w = L.world, col = w.col;
    const land = col.groundRec;
    if (!land) { failures.push('no ground record (LAND)'); return { checked, failures }; }
    const tris = extractTriangles(land.colObj.col);
    const T = tris.positions, nt = T.length / 9;
    notes.push(`LAND: ${land.colObj.col.count} polygons, ${nt} triangles, grid ${land.colObj.col.grid.dims.join('x')}`);
    // bounding box of the land
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < T.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], T[i + k]); mx[k] = Math.max(mx[k], T[i + k]); }
    const R = rng(12345);
    const tri = (i) => [[T[i * 9], T[i * 9 + 1], T[i * 9 + 2]], [T[i * 9 + 3], T[i * 9 + 4], T[i * 9 + 5]], [T[i * 9 + 6], T[i * 9 + 7], T[i * 9 + 8]]];
    // --- ground height vs brute force (highest triangle below the ray start; start 4 above the probe point like FUN_0043cd62(pos, 4))
    // distance in the XZ plane from a point to a triangle
    const dist2d = (x, z, a, b, c) => {
      const seg = (p, q) => { const dx = q[0] - p[0], dz = q[2] - p[2], l = dx * dx + dz * dz; let t = l ? ((x - p[0]) * dx + (z - p[2]) * dz) / l : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - p[0] - t * dx, z - p[2] - t * dz); };
      return Math.min(seg(a, b), seg(b, c), seg(c, a));
    };
    const triOfPoly = new Map(); for (let i = 0; i < nt; i++) triOfPoly.set(tris.polygon[i], i);
    let eq = 0, below = 0, n = 0, maxAbove = 0, farGhost = 0, maxGhost = 0;
    for (let it = 0; it < 400; it++) {
      const x = mn[0] + R() * (mx[0] - mn[0]), z = mn[2] + R() * (mx[2] - mn[2]);
      const y0 = mx[1] + 5;
      let best = -1e9;
      for (let i = 0; i < nt; i++) {
        const [a, b, c] = tri(i);
        const t = segTri([x, y0, z], [0, -500, 0], a, b, c);
        if (t >= 0) best = Math.max(best, y0 - 500 * t);
      }
      if (best < -1e8) continue; // outside the land
      const g = col.terrainHeight(x, y0 - 4, z, 4);
      n++;
      checked++;
      // FUN_004425f0 returns the contact height of the sphere centre (surface + skin 0.1) minus 0.1 = the surface itself
      if (g < best - 0.05) { below++; if (failures.length < 6) failures.push(`ground ray at ${x.toFixed(1)},${z.toFixed(1)}: ${g.toFixed(3)} below the triangle surface ${best.toFixed(3)}`); }
      else if (Math.abs(g - best) < 0.05) eq++;
      else {
        maxAbove = Math.max(maxAbove, g - best);
        // a higher hit must come from a polygon whose triangle lies within the 1.0 edge radius of the ray (in the plane of the polygon, so at most ~1 horizontally)
        const hh = col.rayRecord(land, [x, y0, z], [0, -500, 0], 3, 1.0, 0.1);
        const ti = hh ? triOfPoly.get(hh.polygon) : undefined;
        // (the widened prism is the triangle with each edge plane pushed out by 1.0, so its corners are mitred: sharp triangles reach further than 1.0)
        const dd = ti === undefined ? 1e9 : dist2d(x, z, ...tri(ti));
        maxGhost = Math.max(maxGhost, dd);
        if (dd > 8) { farGhost++; if (failures.length < 6) failures.push(`ground ray at ${x.toFixed(1)},${z.toFixed(1)} hit a polygon ${dd.toFixed(1)} away from the point`); }
      }
    }
    notes.push(`ground ray: ${n} land points, ${eq} equal to the triangle surface (+-0.05), ${n - eq - below} higher (the 1.0 edge radius lets a neighbouring polygon win, max ${maxAbove.toFixed(2)}), ${below} lower`);
    if (n < 100) failures.push(`only ${n} land points tested`);
    if (eq < n * 0.7) failures.push(`ground ray equals the triangle surface at only ${eq}/${n} points`);
    notes.push(`ground ray: the farthest polygon that won through the edge radius was ${maxGhost.toFixed(2)} away`);
    if (farGhost) failures.push(`${farGhost} ground ray hits on polygons far outside the edge radius`);
    // --- no tunnelling (against the land record alone: other records may be hit earlier)
    const landOnly = new CollisionWorld([land]);
    let cross = 0, hitCross = 0, earlyBad = 0;
    for (let it = 0; it < 600; it++) {
      const p = [mn[0] + R() * (mx[0] - mn[0]), mn[1] + R() * (mx[1] - mn[1]), mn[2] + R() * (mx[2] - mn[2])];
      const ang = R() * Math.PI * 2, len = 3 + R() * 25, pitch = (R() - 0.5) * 2;
      const d = [Math.cos(ang) * len, pitch * len * 0.6, Math.sin(ang) * len];
      let tb = 2;
      for (let i = 0; i < nt; i++) { const [a, b, c] = tri(i); const t = segTri(p, d, a, b, c); if (t >= 0 && t < tb) tb = t; }
      if (tb > 1) continue;
      cross++; checked++;
      const h = landOnly.sweep(null, p, d, 3, 0.6, 0.2);
      if (h && h.rec === land) { hitCross++; if (h.t > tb + 1e-6) earlyBad++; }
      else if (failures.length < 12) failures.push(`segment from ${p.map((v) => v.toFixed(1))} by ${d.map((v) => v.toFixed(1))} crosses the land at t=${tb.toFixed(3)} but the sweep reports ${h ? h.rec.name : 'nothing'}`);
    }
    notes.push(`sweeps: ${cross} random segments cross the land mesh, ${hitCross} reported as land hits, ${earlyBad} reported later than the geometric crossing`);
    if (hitCross !== cross) failures.push(`${cross - hitCross} of ${cross} crossing segments tunnelled through`);
    if (earlyBad) failures.push(`${earlyBad} hits later than the geometric crossing`);
    // --- free air never hits
    let air = 0;
    for (let it = 0; it < 200; it++) {
      const p = [mn[0] + R() * (mx[0] - mn[0]), mx[1] + 40 + R() * 20, mn[2] + R() * (mx[2] - mn[2])];
      const h = col.sweep(null, p, [R() * 20 - 10, R() * 4, R() * 20 - 10], 3, 0.6, 0.2);
      air++; checked++;
      if (h && h.rec.name !== 'SSKY' && h.rec.name !== 'PTER') { failures.push(`phantom hit in free air at ${p.map((v) => v.toFixed(1))}: ${h.rec.name}`); break; }
    }
    // --- the grid walk agrees with testing every polygon (the engine walks cells from centre - h - 1.0, the file lists use centre - h)
    {
      const obj = land.colObj;
      const full = new ColObject({ ...obj.col, grid: { ...obj.col.grid, dims: [1, 1, 1], cells: new Uint32Array([0, 0]) } }, 'full');
      const rec2 = new GameRecord('LAN2'); rec2.colObj = full; rec2.m.set(land.m); rec2.flags = 2;
      const w2 = new CollisionWorld([rec2]);
      let same = 0, tDiff = 0, bothNone = 0, gridMiss = 0, gridExtra = 0;
      for (let it = 0; it < 600; it++) {
        const px = mn[0] + R() * (mx[0] - mn[0]), pz = mn[2] + R() * (mx[2] - mn[2]);
        let gy = col.terrainHeight(px, mx[1], pz, 0); if (gy < -1e6) gy = 20;
        const p = [px, gy + 1 + R() * 6, pz];
        const d = [R() * 12 - 6, -R() * 10, R() * 12 - 6];
        const a = col.sweep(null, p, d, 3, 0.6, 0.2);
        const b = w2.sweep(null, p, d, 3, 0.6, 0.2);
        checked++;
        const ah = a && a.rec === land ? a : null;
        if (!ah && !b) bothNone++;
        else if (ah && b) { if (Math.abs(ah.t - b.t) < 1e-6) same++; else tDiff++; }
        else if (b) gridMiss++;
        else gridExtra++;
      }
      notes.push(`grid walk vs full polygon scan: ${same} equal, ${bothNone} both miss, ${gridMiss} only the full scan hits (polygons the file's cell lists do not cover), ${gridExtra} only the grid walk hits, ${tDiff} different t`);
      if (same < 100) failures.push(`only ${same} grid-vs-scan comparisons with a hit`);
      if (gridExtra || tDiff) failures.push(`grid walk disagrees with the full scan where it hits (${gridExtra} extra hits, ${tDiff} different t)`);
      if (gridMiss > (same + gridMiss) * 0.06) failures.push(`the cell lists miss ${gridMiss} of ${same + gridMiss} hits (more than 6%)`);
    }
    // --- sphere / skin semantics on a flat piece: a downward segment that ends 0.1 above a floor hits it when skin = 0.2, not when skin = 0
    {
      const floor = col.sweep(null, [-39.49, 40, 87.7], [0, -40, 0], 3, 0.01, 0);
      checked++;
      if (!floor) failures.push('no floor below the start');
      else {
        const gy = floor.point[1];
        const near = [floor.point[0], gy + 0.3, floor.point[2]];
        const skinned = col.sweep(null, near, [0, -0.2, 0], 3, 0.01, 0.2);
        const plain = col.sweep(null, near, [0, -0.2, 0], 3, 0.01, 0.0);
        checked += 2;
        if (!skinned) failures.push('skin 0.2: a segment ending 0.1 above the floor must hit');
        if (plain) failures.push('skin 0: a segment ending 0.1 above the floor must not hit');
        if (floor.normal[1] < 0.5) failures.push(`floor normal ${floor.normal} not pointing up`);
      }
    }
    // --- footstep surface ids: the island's roads report surface 1 (road), the grass 0
    {
      const rs = new Set();
      for (let it = 0; it < 400; it++) {
        const x = mn[0] + R() * (mx[0] - mn[0]), z = mn[2] + R() * (mx[2] - mn[2]);
        const h = col.sweep(null, [x, mx[1] + 5, z], [0, -200, 0], 3, 0.01, 0);
        if (h && h.rec === land) rs.add(h.surface);
      }
      checked++;
      notes.push(`land surface ids seen: ${[...rs].sort().join(',')}`);
      if (!rs.has(0) || !rs.has(1)) failures.push(`expected grass (0) and road (1) surfaces on the island, saw ${[...rs]}`);
    }
    // --- box shape: a tree trunk (TREE: box radius 4, height 16) blocks a horizontal sweep from outside, with a horizontal normal
    {
      const trees = w.records.filter((r) => r.name === 'TREE' && r.colObj && r.colObj.shape === 3);
      checked++;
      if (!trees.length) failures.push('no box-shaped TREE record');
      else {
        let ok = 0, bad = 0;
        for (const tr of trees) {
          const o = tr.colObj, y = tr.y + 3;
          const from = [tr.x - o.box[0] - 6, y, tr.z], to = [12, 0, 0];
          const h = col.sweep(null, from, to, 1, 0.6, 0.2);
          if (h && h.rec === tr) { if (Math.abs(h.normal[1]) < 0.01 && h.point[0] < tr.x) ok++; else bad++; }
          const miss = col.sweep(null, [tr.x - o.box[0] - 6, tr.y + 100, tr.z], [12, 0, 0], 1, 0.6, 0.2);
          if (miss && miss.rec === tr) bad++;
        }
        notes.push(`box shapes: ${ok} of ${trees.length} trees hit from the side with a horizontal normal`);
        checked += trees.length;
        if (bad) failures.push(`${bad} wrong box-shape results`);
        if (ok < trees.length * 0.8) failures.push(`only ${ok} of ${trees.length} box-shaped trees were hit by a sweep straight at them`);
      }
    }
    // --- probe mode skips the ground record
    {
      const g = col.sweep(null, [-39.49, 40, 87.7], [0, -40, 0], 3, 0.01, 0);
      const p = col.probe(null, [-39.49, 40, 87.7], [0, -40, 0], 3);
      checked++;
      if (!g || g.rec !== land) failures.push('normal sweep did not find the land');
      if (p && p.rec === land) failures.push('probe hit the ground record');
    }
    notes.push(`${air} free-air sweeps; ${col.stats.sweeps} sweeps, ${col.stats.polygonTests} polygon tests in total`);
    return { checked, failures, notes };
  },
};
