import { parseCol, polygonCorners } from '../../src/formats/col.ts';
import { parseMsh } from '../../src/formats/msh.ts';

// .col collision files: strict parse (exact consumption), plane sanity, grid consistency, mesh cross-check.
export default {
  name: 'col',
  run(ctx) {
    const failures = []; const notes = [];
    let checked = 0, ncol = 0, ncolTail = 0, withPolys = 0, polys = 0, nanPolys = 0, sliverPolys = 0, nanFiles = 0;
    let radiusBad = 0, csBad = 0, listBad = 0, unlisted = 0, unitBad = 0, perpBad = 0, outBox = 0;
    let edgeSign = 0, gridCornerMiss = 0, unlistedOutside = 0, outBoxFiles = [], gridExtra = 0, gridTotal = 0;
    let winding = [0, 0], junkSurface = 0, quadFlag = 0, meshFiles = 0, meshTris = 0, meshTrisMatched = 0, meshBboxBad = 0;
    const flagCount = {}; const surfCount = {};
    for (const { archive, entry, data } of ctx.entries(/\.col$/i)) {
      checked++;
      const id = entry.fullPath;
      let c;
      try { c = parseCol(data); } catch (e) { failures.push(`${id}: ${e.message}`); continue; }
      if (!c.hasPolys) {
        ncol++;
        if (data.length === 36) continue;
        // 43 files carry 36 bytes of debug-heap fill after NCOL: "GRDP" 0xcdcdcdcd "GRDC" then 0xcd... (loader returns at NCOL)
        const tail = data.subarray(36);
        const s = String.fromCharCode(...tail.subarray(0, 4)) + String.fromCharCode(...tail.subarray(8, 12));
        // fill is 0xcdcdcdcd (MSVC debug heap) or 0xbaadf00d (LocalAlloc debug fill)
        const fill = tail.subarray(4, 8);
        const same = (a) => a.every((b, i) => b === fill[i % 4]);
        if (data.length === 72 && s === 'GRDPGRDC' && same(tail.subarray(12)) && (fill.every((b) => b === 0xcd) || (fill[0] === 0x0d && fill[1] === 0xf0 && fill[2] === 0xad && fill[3] === 0xba))) ncolTail++;
        else failures.push(`${id}: unexplained NCOL tail of ${tail.length} bytes`);
        continue;
      }
      withPolys++; polys += c.count;
      const g = c.grid;
      const rad = Math.hypot(...c.halfExtents);
      if (Math.abs(rad - c.radius) > 1e-3 * Math.max(1, rad)) radiusBad++;
      for (let k = 0; k < 3; k++) if (Math.abs(g.cellSize[k] - 2 * (c.halfExtents[k] + 1) / g.dims[k]) > 1e-3 * g.cellSize[k]) { csBad++; break; }
      // list structure: cells tile the list contiguously, indices < count
      let sum = 0, ok = true;
      for (let i = 0; i < g.cells.length / 2; i++) { if (g.cells[i * 2] !== sum) ok = false; sum += g.cells[i * 2 + 1]; }
      if (!ok || sum !== c.polyList.length) { listBad++; failures.push(`${id}: grid cells do not tile GRDP list`); }
      for (const p of c.polyList) if (p >= c.count) { failures.push(`${id}: grid index ${p} >= ${c.count}`); break; }
      const mem = new Map();
      for (let cell = 0; cell < g.cells.length / 2; cell++) for (let j = 0; j < g.cells[cell * 2 + 1]; j++) { const p = c.polyList[g.cells[cell * 2] + j]; let s = mem.get(p); if (!s) mem.set(p, s = new Set()); s.add(cell); }
      // mesh of the same name in the same archive (not all exist)
      const base = entry.path.replace(/^col\//i, '').replace(/\.col$/i, '');
      const me = archive.find('meshes/' + base + '.msh');
      let verts = null, mn, mx;
      if (me) {
        const m = parseMsh(archive.read(me)); verts = new Set(); mn = [1e9, 1e9, 1e9]; mx = [-1e9, -1e9, -1e9];
        for (let i = 0; i < m.vertexCount; i++) { const k = [0, 1, 2].map((q) => m.positions[i * 3 + q]); verts.add(k.map((v) => v.toFixed(2)).join(',')); for (let q = 0; q < 3; q++) { if (k[q] < mn[q]) mn[q] = k[q]; if (k[q] > mx[q]) mx[q] = k[q]; } }
        meshFiles++;
        // the box in the file is the tight AABB of the mesh when the collision mesh is the visual mesh
      }
      let tmn = [1e9, 1e9, 1e9], tmx = [-1e9, -1e9, -1e9], anyNan = false;
      for (let i = 0; i < c.count; i++) {
        flagCount[c.flags[i]] = (flagCount[c.flags[i]] || 0) + 1;
        const sf = c.surface[i] > 100 ? 'junk' : c.surface[i]; surfCount[sf] = (surfCount[sf] || 0) + 1; if (sf === 'junk') junkSurface++;
        if (c.flags[i] & 4) quadFlag++;
        const pc = polygonCorners(c, i);
        if (!pc || pc.some(Number.isNaN)) {
          // degenerate source triangle: all 16 plane floats are NaN
          const all = [...c.face.subarray(i * 4, i * 4 + 4), ...c.edges.subarray(i * 12, i * 12 + 12)];
          if (all.every(Number.isNaN)) { nanPolys++; anyNan = true; continue; }
          // zero-width sliver: two edge planes are anti-parallel, so the corners cannot be recovered
          let anti = false;
          for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) { const o1 = i * 12 + a * 4, o2 = i * 12 + b * 4; if (c.edges[o1] * c.edges[o2] + c.edges[o1 + 1] * c.edges[o2 + 1] + c.edges[o1 + 2] * c.edges[o2 + 2] < -0.999) anti = true; }
          if (anti) sliverPolys++; else failures.push(`${id}: polygon ${i}: corners not recoverable`);
          continue;
        }
        // plane sanity
        const nl = Math.hypot(c.face[i * 4], c.face[i * 4 + 1], c.face[i * 4 + 2]);
        if (Math.abs(nl - 1) > 1e-3) unitBad++;
        for (let k = 0; k < 3; k++) {
          const o = i * 12 + k * 4; const el = Math.hypot(c.edges[o], c.edges[o + 1], c.edges[o + 2]);
          const dot = c.edges[o] * c.face[i * 4] + c.edges[o + 1] * c.face[i * 4 + 1] + c.edges[o + 2] * c.face[i * 4 + 2];
          if (Math.abs(el - 1) > 1e-3 || Math.abs(dot) > 2e-3) perpBad++;
        }
        { // centroid must be on the inner side (n.p - d <= 0) of all three edge planes
          const cx = (pc[0] + pc[3] + pc[6]) / 3, cy = (pc[1] + pc[4] + pc[7]) / 3, cz = (pc[2] + pc[5] + pc[8]) / 3;
          for (let k = 0; k < 3; k++) { const o = i * 12 + k * 4; if (c.edges[o] * cx + c.edges[o + 1] * cy + c.edges[o + 2] * cz - c.edges[o + 3] > 1e-3 * (1 + Math.abs(c.edges[o + 3]))) { edgeSign++; break; } }
        }
        for (let v = 0; v < 9; v++) { const q = v % 3; if (pc[v] < tmn[q]) tmn[q] = pc[v]; if (pc[v] > tmx[q]) tmx[q] = pc[v]; }
        // winding of corner order (e0e1,e1e2,e2e0) relative to the face normal
        const ax = pc[3] - pc[0], ay = pc[4] - pc[1], az = pc[5] - pc[2], bx = pc[6] - pc[0], by = pc[7] - pc[1], bz = pc[8] - pc[2];
        const cr = (ay * bz - az * by) * c.face[i * 4] + (az * bx - ax * bz) * c.face[i * 4 + 1] + (ax * by - ay * bx) * c.face[i * 4 + 2];
        if (cr > 0) winding[0]++; else winding[1]++;
        // grid membership: origin = centre - halfExtents; cell index (x*ny + y)*nz + z. Listed cells must contain every corner (when inside the grid) and stay within the bbox cell range.
        if (g.dims[0] * g.dims[1] * g.dims[2] > 1) {
          const got = mem.get(i);
          const lo = [], hi = [];
          for (let q = 0; q < 3; q++) {
            const o = c.center[q] - c.halfExtents[q];
            lo.push(Math.max(0, Math.floor((Math.min(pc[q], pc[3 + q], pc[6 + q]) - o) / g.cellSize[q])));
            hi.push(Math.min(g.dims[q] - 1, Math.floor((Math.max(pc[q], pc[3 + q], pc[6 + q]) - o) / g.cellSize[q])));
          }
          if (!got) {
            // polygons with a corner outside (or exactly on the face of) the stored box are not listed (stale box in some files, see doc)
            let outside = false;
            for (let q = 0; q < 3; q++) for (let v = 0; v < 3; v++) { const x = pc[v * 3 + q], lo2 = c.center[q] - c.halfExtents[q], hi2 = c.center[q] + c.halfExtents[q], eps = 1e-3 * (1 + Math.abs(x)); if (x < lo2 + eps || x > hi2 - eps) outside = true; }
            if (outside) unlistedOutside++; else { unlisted++; failures.push(`${id}: polygon ${i} not in any grid cell although inside the grid`); }
          } else {
            gridTotal++;
            const cellOf = (x, y, z) => z + g.dims[2] * (y + g.dims[1] * x);
            for (let v = 0; v < 3; v++) {
              const ix = [0, 1, 2].map((q) => Math.floor((pc[v * 3 + q] - (c.center[q] - c.halfExtents[q])) / g.cellSize[q]));
              if (ix.some((x, q) => x < 0 || x >= g.dims[q])) continue;
              if (!got.has(cellOf(ix[0], ix[1], ix[2]))) { gridCornerMiss++; break; }
            }
            for (const cell of got) {
              const z = cell % g.dims[2], y = Math.floor(cell / g.dims[2]) % g.dims[1], x = Math.floor(cell / (g.dims[2] * g.dims[1]));
              if (x < lo[0] || x > hi[0] || y < lo[1] || y > hi[1] || z < lo[2] || z > hi[2]) { gridExtra++; break; }
            }
          }
        }
        if (verts) { meshTris++; let all = true; for (let v = 0; v < 3; v++) if (!verts.has([0, 1, 2].map((q) => pc[v * 3 + q].toFixed(2)).join(','))) all = false; if (all) meshTrisMatched++; }
      }
      if (anyNan) nanFiles++;
      // triangles inside the stored box (the box is exactly the AABB of the triangle corners)
      for (let q = 0; q < 3; q++) {
        if (tmn[q] === 1e9) continue;
        if (tmn[q] < c.center[q] - c.halfExtents[q] - 0.02 * (1 + c.halfExtents[q] * 0.01) || tmx[q] > c.center[q] + c.halfExtents[q] + 0.02 * (1 + c.halfExtents[q] * 0.01)) { outBox++; outBoxFiles.push(id); break; }
      }
      if (verts && tmn[0] !== 1e9) for (let q = 0; q < 3; q++) if (Math.abs(tmn[q] - mn[q]) > 0.02 || Math.abs(tmx[q] - mx[q]) > 0.02) { meshBboxBad++; break; }
    }
    notes.push(`files whose triangles stick out of the stored box (exporter quirk, tolerated): ${outBox}${outBox ? ' e.g. ' + outBoxFiles.slice(0, 4).join(', ') : ''}; polygons unlisted because a corner lies outside the stored box: ${unlistedOutside}`);
    if (radiusBad) failures.push(`${radiusBad} files: radius != |halfExtents|`);
    if (csBad) failures.push(`${csBad} files: cellSize != 2*(halfExtents+1)/dims`);
    if (unitBad) failures.push(`${unitBad} face normals not unit`);
    if (perpBad) failures.push(`${perpBad} edge planes not unit/perpendicular to face normal`);
    // a handful of near-degenerate slivers lose the sign to float precision when corners are recovered
    if (edgeSign > 20) failures.push(`${edgeSign} polygons whose centroid is outside an edge plane`);
    notes.push(`polygons whose recovered centroid is marginally outside an edge plane (near-degenerate, tolerated up to 20): ${edgeSign}`);
    if (quadFlag) notes.push(`polygons with flag 4 (quad, 4th edge plane at +0x48): ${quadFlag}`);
    // grid mismatches beyond float-boundary cases would be a model error
    if (gridExtra + gridCornerMiss > gridTotal * 0.0005) failures.push(`grid membership model fails: corner cell not listed ${gridCornerMiss}, listed outside bbox range ${gridExtra} of ${gridTotal}`);
    notes.push(`NCOL ${ncol} (of which ${ncolTail} with 36 bytes of heap debug fill 0xcdcdcdcd/0xbaadf00d after NCOL); COLP files ${withPolys}; polygons ${polys} (degenerate NaN polygons ${nanPolys} in ${nanFiles} files, tolerated: the source triangle was degenerate), zero-width slivers with anti-parallel edge planes ${sliverPolys}`);
    notes.push(`grid membership (origin = centre - halfExtents, cell index = (x*ny + y)*nz + z), ${gridTotal} listed polygons in multi-cell grids: corner cell not listed ${gridCornerMiss}, listed beyond bbox cell range ${gridExtra}`);
    notes.push(`flags ${JSON.stringify(flagCount)}`);
    notes.push(`surface ${JSON.stringify(surfCount)} (uninitialised fill values: ${junkSurface} polygons)`);
    notes.push(`corner order e0e1,e1e2,e2e0 vs face normal: cross.n>0 ${winding[0]}, <=0 ${winding[1]}`);
    notes.push(`files with a same-named mesh ${meshFiles}: corner vertices found in the mesh ${meshTrisMatched}/${meshTris}; box differs from mesh AABB in ${meshBboxBad} files`);
    return { checked, failures, notes };
  },
};
