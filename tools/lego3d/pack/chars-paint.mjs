// "Painted" decals (builder only): the game's body meshes carry their prints (torso print, shin fronts, thigh fronts, shoe fronts, leg backs, sleeve bands) as opaque textured quads / strips laid over
// the solid parts. Laid over the rebuilt LDraw parts such a quad has to follow the skinned surface in every pose; it did not (prints vanished behind the surface when bones bent; the original's own
// decals are not hidden because its solid has vertices at the same places). The decal textures are fully opaque (no alpha: the background colour is part of the picture), so the print can
// simply BE the surface: the triangles of the rebuilt parts inside the footprint of the original decal are tagged with the decal's group (the assembler then gives them the decal's texture, and
// UVs read off the original decal like for every other solid group), the host triangles are cut along the footprint edges. No second layer = nothing can hide, no z fight, same skin as the part.
//
// A footprint = the triangles of the original decal group (bind pose, world axes) of a print that faces front (+z) or back (-z).
// A host triangle belongs to it when its centroid projects perpendicularly into a footprint triangle whose surface is within ZTOL there and whose normal agrees with the host's. Bands around
// an arm and soles stay overlays (body.ts decalGroup: the vertices ride their host triangle exactly). Where footprints overlap the one of the higher group (drawn later = on top) wins.
export const ZTOL = 0.14;
const AGREE = 0.35;
const FACING = 0.5;

const cross3 = (u, w) => [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (n) => { const l = Math.hypot(...n) || 1; return [n[0] / l, n[1] / l, n[2] / l]; };
const faceN = (P) => unit(cross3(sub3(P[1], P[0]), sub3(P[2], P[0])));

/** classify the decal groups of an original body (loadBody result `B`): [{ g, kind: 'front' | 'back' | 'wrap' | 'other', tris: [[p0, p1, p2]], ns: [face normals] }] for the groups whose role is 'D' */
export function footprints(B, roles, wraps = false) {
  const out = [];
  roles.split('').forEach((r, gi) => {
    if (r !== 'D') return;
    const g = B.msh.groups[gi], tris = [], ns = [];
    for (let t = 0; t < g.indexCount; t += 3) {
      const P = [0, 1, 2].map((k) => { const v = B.msh.indices[g.firstIndex + t + k] + g.firstVertex; return [B.world[v * 3], B.world[v * 3 + 1], B.world[v * 3 + 2]]; });
      tris.push(P); ns.push(faceN(P));
    }
    let front = 0, back = 0, up = 0;
    for (const n of ns) { if (n[2] > FACING) front++; else if (n[2] < -FACING) back++; if (Math.abs(n[1]) > 0.7) up++; }
    // a print faces front or back (within 60 degrees of z). A band that wraps around an arm is painted only when `wraps` (the coarse LODs: its overlay would cost a quarter of their budget; at HR its ragged
    // edges cost more triangles than the overlay); a sole (faces down) always stays an overlay (body.ts decalGroup)
    const kind = front === tris.length ? 'front' : back === tris.length ? 'back' : wraps && !up ? 'wrap' : 'other';
    out.push({ g: gi, kind, tris, ns });
  });
  return out;
}

/**
 * The cut planes of a footprint. Its boundary edges (used by exactly one triangle, matched to 1e-4) are chained into loops. A loop that goes AROUND the surface (a band on an arm: its plane contains the
 * surface normals) is cut by ONE plane (a least-squares fit through the loop: its segments would give one slightly different plane each); the edges of any other loop (a print: the loop lies in the
 * surface) give one plane each, through the edge and containing the surface normal there = the side wall of the footprint. Equal planes (within 0.005) once.
 */
function boundaryPlanes(tris, ns, loose = false) {
  const key = (p) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
  const m = new Map();
  tris.forEach((t, ti) => {
    for (let k = 0; k < 3; k++) {
      const a = t[k], b = t[(k + 1) % 3];
      if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-5) continue;
      const ka = key(a), kb = key(b), id = ka < kb ? ka + '|' + kb : kb + '|' + ka, e = m.get(id);
      if (e) e.n++; else m.set(id, { n: 1, a, b, ka, kb, nrm: ns[ti] });
    }
  });
  const edges = [...m.values()].filter((e) => e.n === 1);
  // chain into loops
  const at = new Map(); edges.forEach((e, i) => { for (const k of [e.ka, e.kb]) (at.get(k) ?? at.set(k, []).get(k)).push(i); });
  const used = new Set(), loops = [];
  for (let i = 0; i < edges.length; i++) {
    if (used.has(i)) continue;
    const loop = [i]; used.add(i);
    let end = edges[i].kb, grew = true;
    while (grew) {
      grew = false;
      for (const j of at.get(end) ?? []) if (!used.has(j)) { used.add(j); loop.push(j); end = edges[j].ka === end ? edges[j].kb : edges[j].ka; grew = true; break; }
    }
    loops.push(loop.map((j) => edges[j]));
  }
  const planes = [];
  const push = (pn, off) => {
    if (pn[0] < -1e-6 || (Math.abs(pn[0]) <= 1e-6 && (pn[1] < -1e-6 || (Math.abs(pn[1]) <= 1e-6 && pn[2] < 0)))) { pn = [-pn[0], -pn[1], -pn[2]]; off = -off; }
    const dotMin = loose ? 0.97 : 0.9995, offTol = loose ? 0.06 : 0.005;   // a wrap decal's edges are ragged (every segment its own plane): merge near planes
    if (!planes.some((q) => q.n[0] * pn[0] + q.n[1] * pn[1] + q.n[2] * pn[2] > dotMin && Math.abs(q.off - off) < offTol)) planes.push({ n: pn, off });
  };
  for (const loop of loops) {
    const pts = []; for (const e of loop) pts.push(e.a, e.b);
    const c = [0, 1, 2].map((d) => pts.reduce((s, p) => s + p[d], 0) / pts.length);
    // Newell normal of the loop in chain order
    let nm = [0, 0, 0];
    for (let k = 0; k < loop.length; k++) { const a = loop[k].a, b = loop[k].b; nm = [nm[0] + (a[1] - b[1]) * (a[2] + b[2]), nm[1] + (a[2] - b[2]) * (a[0] + b[0]), nm[2] + (a[0] - b[0]) * (a[1] + b[1])]; }
    const ln = Math.hypot(...nm);
    let ring = false, pn = null;
    if (loop.length >= 6 && ln > 1e-9) {
      pn = unit(nm);
      const dev = Math.max(...pts.map((p) => Math.abs((p[0] - c[0]) * pn[0] + (p[1] - c[1]) * pn[1] + (p[2] - c[2]) * pn[2])));
      const along = loop.reduce((s, e) => s + Math.abs(e.nrm[0] * pn[0] + e.nrm[1] * pn[1] + e.nrm[2] * pn[2]), 0) / loop.length;
      ring = dev < 0.1 && along < 0.4;
    }
    if (ring) { push(pn, pn[0] * c[0] + pn[1] * c[1] + pn[2] * c[2]); continue; }
    for (const e of loop) {
      const q = unit(cross3(sub3(e.b, e.a), e.nrm));
      if (Math.hypot(...q) < 0.5) continue;
      push(q, q[0] * e.a[0] + q[1] * e.a[1] + q[2] * e.a[2]);
    }
  }
  return planes;
}
/** splits a convex polygon (3D points) by a plane { n, off }: [part on the + side, part on the - side] (null = nothing on that side) */
function splitPoly(poly, pl) {
  const d = poly.map((p) => p[0] * pl.n[0] + p[1] * pl.n[1] + p[2] * pl.n[2] - pl.off);
  if (d.every((x) => x >= -1e-5)) return [poly, null];
  if (d.every((x) => x <= 1e-5)) return [null, poly];
  const L = [], R = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length], da = d[k], db = d[(k + 1) % poly.length];
    if (da >= -1e-5) L.push(a);
    if (da <= 1e-5) R.push(a);
    if ((da > 1e-5 && db < -1e-5) || (da < -1e-5 && db > 1e-5)) { const s = da / (da - db), p = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s]; L.push(p); R.push(p); }
  }
  return [L.length >= 3 ? L : null, R.length >= 3 ? R : null];
}

/** footprints prepared for cutting / tagging: highest group first, with their cut planes and a bounding box padded by ZTOL */
export function prepFootprints(fps) {
  return fps.filter((f) => f.kind !== 'other').sort((a, b) => b.g - a.g).map((f) => {
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const t of f.tris) for (const p of t) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], p[c] - ZTOL); hi[c] = Math.max(hi[c], p[c] + ZTOL); }
    const area = f.tris.reduce((s, P) => s + Math.hypot(...cross3(sub3(P[1], P[0]), sub3(P[2], P[0]))) / 2, 0);
    return { ...f, planes: boundaryPlanes(f.tris, f.ns, f.kind === 'wrap'), box: { lo, hi }, area };
  });
}
const triBox = (P) => ({ lo: [0, 1, 2].map((c) => Math.min(P[0][c], P[1][c], P[2][c])), hi: [0, 1, 2].map((c) => Math.max(P[0][c], P[1][c], P[2][c])) });
const overlaps = (b, f) => [0, 1, 2].every((c) => b.hi[c] >= f.box.lo[c] && b.lo[c] <= f.box.hi[c]);

/** Cuts the triangles of a soup (9 floats per triangle) along the side walls of the footprints: every fragment lies wholly inside or wholly outside. `use` = prepFootprints() */
export function cutSoup(soup, use) {
  const out = [];
  for (let i = 0; i < soup.length; i += 9) {
    const P = [0, 1, 2].map((k) => [soup[i + k * 3], soup[i + k * 3 + 1], soup[i + k * 3 + 2]]);
    let polys = [P];
    for (const f of use) {
      // EVERY triangle is cut by every plane that crosses it (a plane splits both neighbours of an edge at the same point: no T junctions; pruning by distance would leave some)
      for (const pl of f.planes) {
        const next = [];
        for (const q of polys) { const [l, r] = splitPoly(q, pl); if (l && r) next.push(l, r); else next.push(q); }
        polys = next;
      }
    }
    for (const q of polys) for (let k = 1; k + 1 < q.length; k++) out.push(...q[0], ...q[k], ...q[k + 1]);
  }
  return Float32Array.from(out);
}
/**
 * the decal group a (cut) triangle belongs to, else -1: its centroid projects PERPENDICULARLY into a footprint triangle (the footprint seen from the surface, so that the faces of an arm band that look
 * sideways count too), at most ZTOL from that triangle's plane, and its normal agrees with the footprint triangle's (a front print is not painted on the back of its part)
 */
export function tagTri(P, use) {
  const n = faceN(P), c = [(P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][1] + P[1][1] + P[2][1]) / 3, (P[0][2] + P[1][2] + P[2][2]) / 3];
  for (const f of use) {
    for (let k = 0; k < f.tris.length; k++) {
      const fn = f.ns[k];
      if (n[0] * fn[0] + n[1] * fn[1] + n[2] * fn[2] <= AGREE) continue;
      const [a, b, d] = f.tris[k], h = (c[0] - a[0]) * fn[0] + (c[1] - a[1]) * fn[1] + (c[2] - a[2]) * fn[2];
      if (Math.abs(h) > ZTOL) continue;
      const p = [c[0] - fn[0] * h, c[1] - fn[1] * h, c[2] - fn[2] * h];
      // barycentric of p in the triangle (3D, by areas along the normal)
      const A = (q0, q1, q2) => { const cr = cross3(sub3(q1, q0), sub3(q2, q0)); return cr[0] * fn[0] + cr[1] * fn[1] + cr[2] * fn[2]; };
      const tot = A(a, b, d);
      if (Math.abs(tot) < 1e-12) continue;
      const u = A(p, b, d) / tot, v = A(a, p, d) / tot, w = 1 - u - v;
      if (u >= -1e-3 && v >= -1e-3 && w >= -1e-3) return f.g;
    }
  }
  return -1;
}

/** the area of a triangle given by 3 points */
export const triArea = (P) => Math.hypot(...cross3(sub3(P[1], P[0]), sub3(P[2], P[0]))) / 2;
